import Foundation
import CryptoKit

/** Native owner of draft identities, Keychain profiles and live connections.
 * Construction is offline. No connection is restored or enabled automatically. */
final class RemoteService: @unchecked Sendable {
  private struct Draft {
    let bootstrap: RemoteBootstrap
    let key: Curve25519.Signing.PrivateKey
    let nonce: String
    let requestedScopes: [String]
    let body: String
    var attempts = 0
    var inFlight = false
  }
  private struct Live {
    let profile: String
    let stream: Bool
    let connection: PinnedConnection
    var pendingFrames: [Int] = []
  }
  private let lock = NSRecursiveLock()
  private let vault: RemoteVault
  private var drafts: [String: Draft] = [:]
  private var enabled = Set<String>()
  private var live: [String: Live] = [:]
  var event: (String, [String: String]) -> Void = { _, _ in }
  init(vault: RemoteVault = RemoteKeychainVault()) { self.vault = vault }
  private func synced<T>(_ work: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try work() }
  private func profile(_ handle: String) throws -> RemoteProfile {
    try requireRemote(enabled.contains(handle), .disabled)
    return try RemoteProfile(data: vault.get(handle))
  }
  func prepare(_ raw: String, name: String, scopesJSON: String) throws -> String {
    try synced {
      let bootstrap = try RemoteBootstrap(raw)
      try requireRemote(!name.isEmpty && name.utf16.count <= 48 && !name.unicodeScalars.contains { $0.value < 32 || $0.value == 127 })
      guard let scopesData = scopesJSON.data(using: .utf8) else { throw RemoteFault.invalid_request }
      let requested = try scopes(JSONSerialization.jsonObject(with: scopesData))
      drafts = drafts.filter { $0.value.bootstrap.expires > Date() }
      try requireRemote(drafts.count < 8 && (try vault.count()) < 8, .capacity_exceeded)
      let key = Curve25519.Signing.PrivateKey()
      let nonce = b64url(try secureBytes(32))
      let publicKey = b64url(key.publicKey.rawRepresentation)
      let proof = ["remote-v1-pair", bootstrap.sessionId, bootstrap.pairCode, name, publicKey, nonce, bootstrap.fingerprint, try canonical(requested)].joined(separator: "\n")
      let body: [String: Any] = ["pairingSessionId": bootstrap.sessionId, "pairCode": bootstrap.pairCode, "deviceName": name,
        "devicePublicKey": publicKey, "clientNonce": nonce, "serviceFingerprint": bootstrap.fingerprint,
        "requestedScopes": requested, "proofSignature": b64url(try key.signature(for: Data(proof.utf8)))]
      let handle = UUID().uuidString.lowercased()
      drafts[handle] = Draft(bootstrap: bootstrap, key: key, nonce: nonce, requestedScopes: requested, body: try canonical(body))
      let date = ISO8601DateFormatter().string(from: bootstrap.expires)
      return try canonical(["handle": handle, "devicePublicKey": publicKey, "expiresAt": date])
    }
  }
  func exchange(_ handle: String) async throws -> String {
    let draft: Draft = try synced {
      guard var draft = drafts[handle] else { throw RemoteFault.pairing_required }
      try requireRemote(draft.bootstrap.expires > Date(), .pairing_expired)
      try requireRemote(!draft.inFlight && draft.attempts < 5, .rate_limited)
      try reserve(handle, stream: false)
      draft.attempts += 1; draft.inFlight = true; drafts[handle] = draft
      return draft
    }
    do {
      let response = try await request(handle: handle, endpoint: draft.bootstrap.endpoint, pin: draft.bootstrap.fingerprint, request: RemoteRequest(pairBody: draft.body))
      return try synced {
        guard let current = drafts[handle], current.nonce == draft.nonce, current.bootstrap.expires > Date() else { throw RemoteFault.pairing_expired }
        if response.status != 200 {
          var retryable = false
          if let raw = response.body.data(using: .utf8), let wire = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
             let error = wire["error"] as? [String: Any], error["code"] as? String == "pairing_rejected" { retryable = true }
          drafts[handle]?.inFlight = false
          return try canonical(["ok": false, "code": response.status == 429 ? "rate_limited" : "pairing_rejected", "retryable": retryable])
        }
        guard let bytes = response.body.data(using: .utf8), let result = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              exact(result, ["deviceId", "serverNonce", "grantedScopes", "expiresAt", "serverSignature", "replayEpoch"]),
              let deviceId = result["deviceId"] as? String, let serverNonce = result["serverNonce"] as? String,
              let signature = result["serverSignature"] as? String, let epoch = integer(result["replayEpoch"]) else { throw RemoteFault.pairing_rejected }
        try requireRemote(matches(deviceId, "^[A-Za-z0-9_-]{8,128}$") && epoch >= 1, .pairing_rejected)
        _ = try unb64(serverNonce, 32); _ = try instant(result["expiresAt"])
        try requireRemote(try scopes(result["grantedScopes"]) == current.requestedScopes, .pairing_rejected)
        var unsigned = result; unsigned.removeValue(forKey: "serverSignature")
        let message = ["remote-v1-pair-response", current.nonce, try canonical(unsigned)].joined(separator: "\n")
        try requireRemote(verifyEd25519(current.bootstrap.publicKey, signature: signature, message: message), .pairing_rejected)
        let credentials: [String: Any] = ["deviceId": deviceId, "devicePublicKey": b64url(current.key.publicKey.rawRepresentation),
          "grantedScopes": current.requestedScopes, "replayEpoch": epoch, "expiresAt": result["expiresAt"]!,
          "serviceFingerprint": current.bootstrap.fingerprint, "serviceId": "svc-" + String(current.bootstrap.fingerprint.prefix(16)),
          "servicePublicKey": current.bootstrap.publicKey]
        let profile = try RemoteProfile(key: current.key, endpoint: current.bootstrap.endpoint, credentials: credentials)
        // One item commits key+pin+credentials atomically. A draft can win once;
        // forgetting it while HTTP is in flight makes this transaction fail.
        try vault.put(handle, data: profile.data())
        drafts.removeValue(forKey: handle)
        return try canonical(["ok": true, "credentials": credentials])
      }
    } catch {
      synced { drafts[handle]?.inFlight = false }
      throw (error as? RemoteFault) ?? .transport_unavailable
    }
  }
  func activate(_ handle: String) throws -> String {
    try synced {
      let p = try RemoteProfile(data: vault.get(handle))
      enabled.insert(handle)
      return try canonical(p.credentials)
    }
  }
  func deactivate(_ handle: String) {
    let connections: [PinnedConnection] = synced {
      enabled.remove(handle)
      return live.values.filter { $0.profile == handle }.map { $0.connection }
    }
    for c in connections { c.cancel() }
  }
  func forget(_ handle: String) throws {
    try synced {
      enabled.remove(handle); drafts.removeValue(forKey: handle)
      for c in live.values where c.profile == handle { c.connection.cancel() }
      try vault.remove(handle)
    }
  }
  func stop() {
    let connections = synced { () -> [PinnedConnection] in
      enabled.removeAll(); drafts.removeAll()
      return live.values.map { $0.connection }
    }
    for connection in connections { connection.cancel() }
  }
  func sign(_ handle: String, message: String) throws -> String {
    try synced {
      let p = try profile(handle)
      let parts = message.components(separatedBy: "\n")
      try requireRemote(message.utf8.count <= 8192 && parts.count == 11 && parts[0] == "1" && parts[1] == p.deviceId
        && parts[2] == p.serviceId && parts[3] == String(integer(p.credentials["replayEpoch"])!))
      return b64url(try p.key.signature(for: Data(message.utf8)))
    }
  }
  private func validate(_ request: RemoteRequest, profile: RemoteProfile) throws {
    let h = request.headers
    try requireRemote(h["x-pi-remote-device"] == profile.deviceId && h["x-pi-remote-epoch"] == String(integer(profile.credentials["replayEpoch"])!))
    let message = ["1", profile.deviceId, profile.serviceId, h["x-pi-remote-epoch"]!, h["x-pi-remote-request-id"]!, request.method,
      request.target, h["x-pi-remote-timestamp"]!, h["x-pi-remote-nonce"]!, h["x-pi-remote-body-sha256"]!].joined(separator: "\n")
    try requireRemote(verifyEd25519(b64url(profile.key.publicKey.rawRepresentation), signature: h["x-pi-remote-signature"]!, message: message))
  }
  private func reserve(_ handle: String, stream: Bool) throws {
    try requireRemote(live.count < 16 && live.values.filter { $0.profile == handle }.count < 4, .capacity_exceeded)
    if stream { try requireRemote(live.values.filter { $0.profile == handle && $0.stream }.count < 2, .capacity_exceeded) }
  }
  func send(_ handle: String, raw: String) async throws -> String {
    let (p, r) = try synced { () -> (RemoteProfile, RemoteRequest) in
      let p = try profile(handle); let r = try RemoteRequest(raw, stream: false)
      try validate(r, profile: p); try reserve(handle, stream: false); return (p, r)
    }
    let out = try await request(handle: handle, endpoint: p.endpoint, pin: p.fingerprint, request: r)
    _ = try synced { try profile(handle) } // A concurrent local disable cannot return a successful result.
    return try canonical(["status": out.status, "body": out.body])
  }
  private func request(handle: String, endpoint: RemoteEndpoint, pin: String, request: RemoteRequest) async throws -> RemoteWireResponse {
    try await withCheckedThrowingContinuation { continuation in
      let id = UUID().uuidString
      let c = PinnedConnection(endpoint: endpoint, pin: pin, request: request, stream: false) { [weak self] result in
        self?.synced { self?.live.removeValue(forKey: id) }
        continuation.resume(with: result.mapError { $0 as Error })
      }
      let accepted = synced { () -> Bool in
        guard live.count < 16, live.values.filter({ $0.profile == handle }).count < 4,
              enabled.contains(handle) || drafts[handle]?.inFlight == true else { return false }
        live[id] = Live(profile: handle, stream: false, connection: c); return true
      }
      if accepted { c.start() } else { continuation.resume(throwing: RemoteFault.disabled) }
    }
  }
  func subscribe(_ handle: String, id: String, raw: String) throws {
    try synced {
      _ = try unb64(id, 24)
      try requireRemote(live[id] == nil)
      let p = try profile(handle); let r = try RemoteRequest(raw, stream: true)
      try validate(r, profile: p); try reserve(handle, stream: true)
      let c = PinnedConnection(endpoint: p.endpoint, pin: p.fingerprint, request: r, stream: true,
        onOpen: { [weak self] in self?.emitIfActive(id, event: "remoteOpened") },
        onFrame: { [weak self] frame in self?.deliver(id, frame: frame) },
        complete: { [weak self] _ in
          guard let self else { return }
          let existed = self.synced { self.live.removeValue(forKey: id) != nil }
          if existed { self.event("remoteClosed", ["subscriptionId": id, "code": "stream_closed"]) }
        })
      live[id] = Live(profile: handle, stream: true, connection: c); c.start()
    }
  }
  private func emitIfActive(_ id: String, event name: String) {
    synced {
      guard let entry = live[id], enabled.contains(entry.profile), (try? profile(entry.profile)) != nil else { live[id]?.connection.cancel(); return }
      event(name, ["subscriptionId": id])
    }
  }
  private func deliver(_ id: String, frame: String) {
    synced {
      guard var entry = live[id], enabled.contains(entry.profile), (try? profile(entry.profile)) != nil else { live[id]?.connection.cancel(); return }
      let bytes = frame.utf8.count
      guard entry.pendingFrames.count < 32, entry.pendingFrames.reduce(0, +) + bytes <= 1_048_576 else { entry.connection.cancel(); return }
      entry.pendingFrames.append(bytes); live[id] = entry
      event("remoteFrame", ["subscriptionId": id, "frame": frame])
    }
  }
  func acknowledge(_ id: String) {
    synced { if live[id]?.pendingFrames.isEmpty == false { live[id]?.pendingFrames.removeFirst() } }
  }
  func closeStream(_ id: String) { synced { live[id]?.connection.cancel() } }
}

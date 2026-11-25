import Foundation
import Security
import CryptoKit

protocol RemoteVault {
  func put(_ handle: String, data: Data) throws
  func get(_ handle: String) throws -> Data
  func remove(_ handle: String) throws
  func count() throws -> Int
}

/** One atomic private-key+metadata item, app-scoped and excluded from migration. */
final class RemoteKeychainVault: RemoteVault {
  private let service: String
  init() { service = (Bundle.main.bundleIdentifier ?? "io.github.hyj1817.piguimobile") + ".remote-v1" }
  private func query(_ handle: String? = nil) -> [String: Any] {
    var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrSynchronizable as String: false]
    if let handle { q[kSecAttrAccount as String] = handle }
    return q
  }
  func put(_ handle: String, data: Data) throws {
    try requireRemote(UUID(uuidString: handle) != nil && data.count <= 16384)
    let values: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let status = SecItemUpdate(query(handle) as CFDictionary, values as CFDictionary)
    if status == errSecItemNotFound {
      var q = query(handle); values.forEach { q[$0.key] = $0.value }
      try requireRemote(SecItemAdd(q as CFDictionary, nil) == errSecSuccess, .pairing_required)
    } else { try requireRemote(status == errSecSuccess, .pairing_required) }
  }
  func get(_ handle: String) throws -> Data {
    try requireRemote(UUID(uuidString: handle) != nil)
    var q = query(handle); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data, data.count <= 16384 else { throw RemoteFault.pairing_required }
    return data
  }
  func remove(_ handle: String) throws {
    try requireRemote(UUID(uuidString: handle) != nil)
    let status = SecItemDelete(query(handle) as CFDictionary)
    try requireRemote(status == errSecSuccess || status == errSecItemNotFound, .pairing_required)
  }
  func count() throws -> Int {
    var q = query(); q[kSecReturnAttributes as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitAll
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return 0 }
    guard status == errSecSuccess, let items = result as? [[String: Any]] else { throw RemoteFault.pairing_required }
    return items.count
  }
}

func secureBytes(_ count: Int) throws -> Data {
  try requireRemote((1...64).contains(count))
  var data = Data(count: count)
  let status = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
  try requireRemote(status == errSecSuccess, .transport_unavailable)
  return data
}
func verifyEd25519(_ publicKey: String, signature: String, message: String) -> Bool {
  guard message.utf8.count <= 1_048_576, let raw = try? unb64(publicKey, 32), let sig = try? unb64(signature, 64),
        let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { return false }
  return key.isValidSignature(sig, for: Data(message.utf8))
}

struct RemoteProfile {
  let key: Curve25519.Signing.PrivateKey
  let endpoint: RemoteEndpoint
  let credentials: [String: Any]
  var deviceId: String { credentials["deviceId"] as! String }
  var fingerprint: String { credentials["serviceFingerprint"] as! String }
  var serviceId: String { "svc-" + fingerprint.prefix(16) }
  init(key: Curve25519.Signing.PrivateKey, endpoint: RemoteEndpoint, credentials: [String: Any]) throws {
    try requireRemote(exact(credentials, ["deviceId", "devicePublicKey", "grantedScopes", "replayEpoch", "expiresAt", "serviceFingerprint", "serviceId", "servicePublicKey"]))
    guard let deviceId = credentials["deviceId"] as? String, let fp = credentials["serviceFingerprint"] as? String,
          let pub = credentials["servicePublicKey"] as? String, let epoch = integer(credentials["replayEpoch"]) else { throw RemoteFault.pairing_required }
    try requireRemote(matches(deviceId, "^[A-Za-z0-9_-]{8,128}$") && matches(fp, "^[0-9a-f]{64}$") && epoch >= 1
      && credentials["serviceId"] as? String == "svc-" + fp.prefix(16)
      && credentials["devicePublicKey"] as? String == b64url(key.publicKey.rawRepresentation), .pairing_required)
    _ = try unb64(pub, 32); _ = try scopes(credentials["grantedScopes"]); _ = try instant(credentials["expiresAt"])
    self.key = key; self.endpoint = endpoint; self.credentials = credentials
  }
  init(data: Data) throws {
    guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any], exact(value, ["key", "endpoint", "credentials"]),
          let encoded = value["key"] as? String, let origin = value["endpoint"] as? String, let credentials = value["credentials"] as? [String: Any] else { throw RemoteFault.pairing_required }
    try self.init(key: Curve25519.Signing.PrivateKey(rawRepresentation: unb64(encoded, 32)), endpoint: RemoteEndpoint(origin), credentials: credentials)
  }
  func data() throws -> Data {
    Data(try canonical(["key": b64url(key.rawRepresentation), "endpoint": endpoint.origin, "credentials": credentials]).utf8)
  }
}

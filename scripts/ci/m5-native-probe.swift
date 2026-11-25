import Foundation
import CryptoKit

final class MemoryRemoteVault: RemoteVault {
  var entries: [String: Data] = [:]
  func put(_ handle: String, data: Data) throws { entries[handle] = data }
  func get(_ handle: String) throws -> Data { guard let out = entries[handle] else { throw RemoteFault.pairing_required }; return out }
  func remove(_ handle: String) throws { entries.removeValue(forKey: handle) }
  func count() throws -> Int { entries.count }
}

@main struct NativeProbe {
  static func main() async {
    var count = 0
    do {
      func check(_ condition: Bool) throws { try requireRemote(condition) }
      func rejects(_ work: () throws -> Void) throws {
        var rejected = false
        do { try work() } catch { rejected = true }
        try check(rejected)
      }
      for value in ["https://100.64.0.1:7789", "https://100.127.255.255", "https://[fd7a:115c:a1e0::1]", "https://desktop.tail-example.ts.net"] {
        _ = try RemoteEndpoint(value); count += 1
      }
      for value in ["http://100.64.0.1", "https://127.0.0.1.invalid", "https://example.com", "https://100.63.1.1", "https://100.128.0.1", "https://u:p@desktop.tail.ts.net", "https://desktop.tail.ts.net/api", "https://desktop.tail.ts.net?x", "https://desktop.tail.ts.net#x", "https://[fd7a:115c:a1e0:::1]", "https://100.064.0.1"] {
        try rejects { _ = try RemoteEndpoint(value) }; count += 1
      }
      try rejects { _ = try object("{\"a\":1,\"a\":2}") }; count += 1
      try rejects { _ = try instant("2099-02-30T00:00:00Z") }; count += 1
      try check(integer(true) == nil && integer(1.5) == nil && integer(1) == 1); count += 1
      _ = try instant("2099-01-01T00:00:00.12Z"); count += 1
      let key = Curve25519.Signing.PrivateKey()
      let signature = b64url(try key.signature(for: Data("synthetic native probe".utf8)))
      try check(verifyEd25519(b64url(key.publicKey.rawRepresentation), signature: signature, message: "synthetic native probe")); count += 1
      try check(!verifyEd25519(b64url(key.publicKey.rawRepresentation), signature: signature, message: "tampered")); count += 1
      try check(try secureBytes(32) != secureBytes(32)); count += 1
      let vault = MemoryRemoteVault(); let service = RemoteService(vault: vault)
      try rejects { _ = try service.activate(UUID().uuidString) }; count += 1
      try rejects { _ = try service.sign(UUID().uuidString, message: "secret") }; count += 1
      try check(try vault.count() == 0); count += 1
      let handle = UUID().uuidString.lowercased()
      let fingerprint = sha256(Data("synthetic native service".utf8))
      let credentials: [String: Any] = ["deviceId": "device-native-probe", "devicePublicKey": b64url(key.publicKey.rawRepresentation),
        "grantedScopes": ["projects.read", "sessions.read"], "replayEpoch": 1, "expiresAt": "2099-01-01T00:00:00Z",
        "serviceFingerprint": fingerprint, "serviceId": "svc-" + fingerprint.prefix(16), "servicePublicKey": b64url(key.publicKey.rawRepresentation)]
      let profile = try RemoteProfile(key: key, endpoint: RemoteEndpoint("https://desktop.tail-example.ts.net"), credentials: credentials)
      try vault.put(handle, data: profile.data()); _ = try service.activate(handle)
      let signingMessage = ["1", "device-native-probe", "svc-" + fingerprint.prefix(16), "1", UUID().uuidString.lowercased(), "GET",
        "/remote/v1/projects", "1800000000000", b64url(try secureBytes(32)), sha256(Data())].joined(separator: "\n")
      try check(verifyEd25519(b64url(key.publicKey.rawRepresentation), signature: service.sign(handle, message: signingMessage), message: signingMessage)); count += 1
      try rejects { _ = try service.sign(handle, message: signingMessage + "\nextra") }; count += 1
      service.deactivate(handle)
      try rejects { _ = try service.sign(handle, message: signingMessage) }; count += 1
      _ = try service.activate(handle); service.stop()
      try rejects { _ = try service.sign(handle, message: signingMessage) }; count += 1
      // Every possible one-byte split, including UTF-8 multibyte and chunk framing.
      let frame = "{\"event\":\"message.append\",\"payload\":{\"text\":\"你好😀\"}}"
      let payload = Data(("event: message.append\ndata: " + frame + "\n\n:keepalive\n\n").utf8)
      var wire = Data("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n".utf8)
      wire.append(Data((String(payload.count, radix: 16) + "\r\n").utf8)); wire.append(payload); wire.append(Data("\r\n".utf8))
      let decoder = RemoteHTTPDecoder(stream: true); var frames: [String] = []; var opened = 0
      decoder.opened = { opened += 1 }; decoder.frame = { frames.append($0) }
      for byte in wire { try decoder.feed(Data([byte])) }
      try check(opened == 1 && frames == [frame]); count += 1
      // The frozen frame budget applies to JSON bytes, with bounded SSE
      // framing overhead allowed separately (including CRLF).
      func boundaryFrame(_ size: Int) throws -> String {
        let base: [String: Any] = ["event": "snapshot", "padding": ""]
        let empty = try canonical(base)
        return try canonical(["event": "snapshot", "padding": String(repeating: "x", count: size - empty.utf8.count)])
      }
      for size in [65535, 65536, 65537] {
        let raw = try boundaryFrame(size)
        let payload = Data(("event: snapshot\r\ndata: " + raw + "\r\n\r\n").utf8)
        var data = Data("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n".utf8)
        data.append(Data((String(payload.count, radix: 16) + "\r\n").utf8)); data.append(payload); data.append(Data("\r\n".utf8))
        let decoder = RemoteHTTPDecoder(stream: true); var received: [String] = []
        decoder.frame = { received.append($0) }
        if size <= 65536 { try decoder.feed(data); try check(received == [raw]) }
        else { try rejects { try decoder.feed(data) }; try check(received.isEmpty) }
        count += 1
      }
      let json = RemoteHTTPDecoder(stream: false); var response: RemoteWireResponse?
      json.response = { response = $0 }
      for byte in Data("HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 2\r\n\r\n{}".utf8) { try json.feed(Data([byte])) }
      try check(response?.status == 200 && response?.body == "{}"); count += 1
      for text in [
        "HTTP/1.1 302 Found\r\nLocation: https://example.com\r\n\r\n",
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n{}",
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 1048577\r\n\r\n",
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n2;foo=bar\r\n{}\r\n0\r\n\r\n"
      ] { try rejects { try RemoteHTTPDecoder(stream: false).feed(Data(text.utf8)) }; count += 1 }
      for payload in [Data("data: {}\ndata: {}\n\n".utf8), Data([100,97,116,97,58,32,255,10]), Data(("data: " + String(repeating: "a", count: 65539)).utf8)] {
        var data = Data("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n".utf8)
        data.append(Data((String(payload.count, radix: 16) + "\r\n").utf8)); data.append(payload); data.append(Data("\r\n".utf8))
        try rejects { try RemoteHTTPDecoder(stream: true).feed(data) }; count += 1
      }
      print("NATIVE_M5_CORE_PASSED count=\(count)")
    } catch {
      print("NATIVE_M5_CORE_FAILED after=\(count)")
      exit(1)
    }
  }
}

import Foundation
import CryptoKit
import CoreFoundation
import Darwin

enum RemoteFault: String, Error {
  case disabled, pairing_required, pairing_expired, pairing_rejected, rate_limited
  case invalid_request, pin_mismatch, transport_unavailable, stream_closed, frame_invalid, capacity_exceeded
}

func requireRemote(_ condition: Bool, _ fault: RemoteFault = .invalid_request) throws {
  if !condition { throw fault }
}
func matches(_ value: String, _ pattern: String) -> Bool {
  value.range(of: pattern, options: .regularExpression) != nil
}
func b64url(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
func unb64(_ value: String, _ count: Int) throws -> Data {
  try requireRemote(matches(value, "^[A-Za-z0-9_-]+$"))
  let padded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - value.count % 4) % 4)
  guard let data = Data(base64Encoded: padded), data.count == count, b64url(data) == value else { throw RemoteFault.invalid_request }
  return data
}
func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func canonical(_ value: Any) throws -> String {
  let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes])
  guard let out = String(data: data, encoding: .utf8) else { throw RemoteFault.invalid_request }
  return out
}
func object(_ raw: String, max: Int = 262144) throws -> [String: Any] {
  try requireRemote(raw.utf8.count <= max)
  guard let data = raw.data(using: .utf8), let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw RemoteFault.invalid_request }
  // This also rejects duplicate JSON keys, alternate escapes and lossy re-encoding.
  try requireRemote(try canonical(value) == raw)
  return value
}
func integer(_ value: Any?) -> Int? {
  guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite,
        n.doubleValue.rounded() == n.doubleValue, abs(n.doubleValue) <= 9007199254740991 else { return nil }
  return n.intValue
}
func exact(_ object: [String: Any], _ keys: [String]) -> Bool { Set(object.keys) == Set(keys) }
let remoteScopes: Set<String> = ["projects.read", "sessions.read", "sessions.create", "approvals.read", "chat.send", "chat.stop", "approvals.respond"]
func scopes(_ value: Any?) throws -> [String] {
  guard let list = value as? [String] else { throw RemoteFault.invalid_request }
  try requireRemote(list.count >= 2 && list.count <= 7 && Set(list).count == list.count && Set(list).isSubset(of: remoteScopes)
    && list.contains("projects.read") && list.contains("sessions.read"))
  return list.sorted()
}
func instant(_ value: Any?, now: Date = Date()) throws -> Date {
  guard let text = value as? String, matches(text, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$") else { throw RemoteFault.invalid_request }
  let split = text.dropLast().split(separator: ".", omittingEmptySubsequences: false)
  let normal = String(split[0]) + "." + (split.count == 1 ? "000" : String(split[1]).padding(toLength: 3, withPad: "0", startingAt: 0)) + "Z"
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX"); f.calendar = Calendar(identifier: .gregorian)
  f.timeZone = TimeZone(secondsFromGMT: 0); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"; f.isLenient = false
  guard let date = f.date(from: normal), f.string(from: date) == normal, date > now else { throw RemoteFault.pairing_expired }
  return date
}

struct RemoteEndpoint {
  let origin: String
  let host: String
  let port: UInt16
  let authority: String
  init(_ text: String) throws {
    try requireRemote(text.utf8.count <= 320 && matches(text, "^https://[a-z0-9.:\\[\\]-]+/?$"))
    guard let u = URLComponents(string: text), u.scheme == "https", u.user == nil, u.password == nil,
          u.query == nil, u.fragment == nil, u.path == "" || u.path == "/", let originalHost = u.host else { throw RemoteFault.invalid_request }
    let host = originalHost.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    let parts = host.split(separator: ".", omittingEmptySubsequences: false)
    let v4 = parts.count == 4 && parts[0] == "100" && parts.allSatisfy { part in
      guard let n = Int(part) else { return false }
      return String(n) == String(part) && (0...255).contains(n)
    }
    let second = parts.count == 4 ? Int(parts[1]) ?? -1 : -1
    let dns = host.count <= 253 && matches(host, "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){2,}ts\\.net$")
    var address6 = in6_addr()
    let v6 = matches(host, "^fd7a:115c:a1e0:[0-9a-f:]+$") && host.withCString { inet_pton(AF_INET6, $0, &address6) } == 1
    var allowed = (v4 && (64...127).contains(second)) || dns || v6
    #if REMOTE_TRANSPORT_TESTS
    allowed = allowed || host == "127.0.0.1"
    #endif
    let port = u.port ?? 443
    try requireRemote(allowed && (1...65535).contains(port))
    self.host = host; self.port = UInt16(port)
    let wireHost = host.contains(":") ? "[\(host)]" : host
    self.authority = wireHost + (port == 443 ? "" : ":\(port)")
    self.origin = "https://" + authority
  }
}
struct RemoteBootstrap {
  let endpoint: RemoteEndpoint
  let fingerprint: String
  let publicKey: String
  let sessionId: String
  let pairCode: String
  let expires: Date
  init(_ raw: String, now: Date = Date()) throws {
    let b = try object(raw, max: 4096)
    try requireRemote(exact(b, ["protocolVersion", "endpoint", "serviceFingerprint", "servicePublicKey", "pairingSessionId", "pairCode", "expiresAt"]) && integer(b["protocolVersion"]) == 1)
    guard let endpoint = b["endpoint"] as? String, let fp = b["serviceFingerprint"] as? String, let pub = b["servicePublicKey"] as? String,
          let session = b["pairingSessionId"] as? String, let code = b["pairCode"] as? String else { throw RemoteFault.invalid_request }
    try requireRemote(matches(fp, "^[0-9a-f]{64}$") && matches(code, "^[0-9]{6}$"))
    _ = try unb64(pub, 32); _ = try unb64(session, 16)
    let expiry = try instant(b["expiresAt"], now: now)
    try requireRemote(expiry.timeIntervalSince(now) <= 120)
    self.endpoint = try RemoteEndpoint(endpoint); fingerprint = fp; publicKey = pub; sessionId = session; pairCode = code; expires = expiry
  }
}

struct RemoteRequest {
  let target: String
  let method: String
  let headers: [String: String]
  let body: Data
  init(_ raw: String, stream: Bool) throws {
    let r = try object(raw, max: 1_600_000)
    try requireRemote(Set(r.keys).isSubset(of: ["method", "path", "query", "headers", "rawBody"]))
    guard let method = r["method"] as? String, let path = r["path"] as? String, let headers = r["headers"] as? [String: String],
          let body = r["rawBody"] as? String, let data = body.data(using: .utf8) else { throw RemoteFault.invalid_request }
    try requireRemote(data.count <= 262144)
    var target = path
    if stream {
      try requireRemote(method == "GET" && path == "/remote/v1/events")
      if let query = r["query"] {
        guard let q = query as? [String: String], Set(q.keys) == ["cursor"], let cursor = q["cursor"], matches(cursor, "^[A-Za-z0-9_-]{1,128}$") else { throw RemoteFault.invalid_request }
        target += "?cursor=" + cursor
      }
    } else {
      try requireRemote(r["query"] == nil)
      let id = "([A-Za-z0-9_-]{8,128})"
      let routes = [
        "GET": ["/remote/v1/projects", "/remote/v1/projects/" + id + "/sessions", "/remote/v1/conversations/" + id + "/snapshot", "/remote/v1/conversations/" + id + "/approvals"],
        "POST": ["/remote/v1/projects/" + id + "/conversations", "/remote/v1/conversations/" + id + "/messages", "/remote/v1/conversations/" + id + "/stop", "/remote/v1/conversations/" + id + "/approvals/" + id + "/respond"]
      ]
      try requireRemote((routes[method] ?? []).contains { matches(path, "^" + $0 + "$") } && !path.split(separator: "/").contains("stream-reset"))
    }
    var expected: Set<String> = ["x-pi-remote-device", "x-pi-remote-epoch", "x-pi-remote-request-id", "x-pi-remote-timestamp", "x-pi-remote-nonce", "x-pi-remote-body-sha256", "x-pi-remote-signature", "accept"]
    if method == "POST" { expected.insert("content-type") }
    try requireRemote(Set(headers.keys) == expected && headers.values.allSatisfy { !$0.contains("\r") && !$0.contains("\n") && !$0.contains("\0") })
    try requireRemote(matches(headers["x-pi-remote-device"] ?? "", "^[A-Za-z0-9_-]{8,128}$")
      && UUID(uuidString: headers["x-pi-remote-request-id"] ?? "") != nil
      && matches(headers["x-pi-remote-epoch"] ?? "", "^[1-9][0-9]{0,15}$")
      && matches(headers["x-pi-remote-timestamp"] ?? "", "^[0-9]{1,16}$")
      && headers["x-pi-remote-body-sha256"] == sha256(data)
      && headers["accept"] == (stream ? "text/event-stream" : "application/json"))
    _ = try unb64(headers["x-pi-remote-nonce"] ?? "", 32); _ = try unb64(headers["x-pi-remote-signature"] ?? "", 64)
    if method == "GET" { try requireRemote(data.isEmpty) }
    else { try requireRemote(headers["content-type"] == "application/json; charset=utf-8"); _ = try object(body) }
    self.method = method; self.target = target; self.headers = headers; self.body = data
  }
  init(pairBody: String) {
    method = "POST"; target = "/remote/v1/pair/exchange"; headers = ["accept": "application/json", "content-type": "application/json; charset=utf-8"]; body = Data(pairBody.utf8)
  }
  func bytes(endpoint: RemoteEndpoint) -> Data {
    var raw = method + " " + target + " HTTP/1.1\r\nHost: " + endpoint.authority + "\r\nConnection: close\r\nContent-Length: \(body.count)\r\n"
    for name in headers.keys.sorted() { raw += name + ": " + headers[name]! + "\r\n" }
    var out = Data((raw + "\r\n").utf8); out.append(body); return out
  }
}

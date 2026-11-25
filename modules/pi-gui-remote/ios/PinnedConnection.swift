import Foundation
import Network
import Security

struct RemoteWireResponse { let status: Int; let body: String }

/** Deliberately bounded HTTP/1.1 response decoder for the fixed remote-v1 peer.
 * No redirects, cookies, auth negotiation, compression, proxying or trailers.
 * TCP packet boundaries never become SSE frame boundaries. */
final class RemoteHTTPDecoder {
  enum State { case headers, fixed(Int), chunkSize, chunk(Int), chunkEnd, trailers, done }
  private var state: State = .headers
  private var buffer = Data()
  private var body = Data()
  private var lineBuffer = Data()
  private var frameBytes = 0
  private var eventName: String?
  private var eventData: String?
  private var status = 0
  let stream: Bool
  var opened: () -> Void = {}
  var frame: (String) -> Void = { _ in }
  var response: (RemoteWireResponse) -> Void = { _ in }
  init(stream: Bool) { self.stream = stream }

  func feed(_ data: Data) throws {
    try requireRemote(buffer.count + data.count <= 1_064_960, .capacity_exceeded)
    buffer.append(data)
    while true {
      switch state {
      case .headers:
        guard let range = buffer.range(of: Data("\r\n\r\n".utf8)) else {
          try requireRemote(buffer.count <= 16384, .capacity_exceeded); return
        }
        try requireRemote(range.lowerBound <= 16384, .capacity_exceeded)
        let header = Data(buffer[..<range.lowerBound]); buffer.removeSubrange(..<range.upperBound)
        guard let text = String(data: header, encoding: .ascii) else { throw RemoteFault.invalid_request }
        let lines = text.components(separatedBy: "\r\n")
        guard let first = lines.first, matches(first, "^HTTP/1\\.[01] [2-5][0-9]{2}(?: [\\x20-\\x7e]*)?$") else { throw RemoteFault.invalid_request }
        status = Int(first.split(separator: " ")[1]) ?? 0
        try requireRemote(!(300...399).contains(status), .transport_unavailable)
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
          guard let colon = line.firstIndex(of: ":") else { throw RemoteFault.invalid_request }
          let name = String(line[..<colon]).lowercased()
          let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
          try requireRemote(matches(name, "^[a-z0-9-]+$") && headers[name] == nil && !value.contains("\0"))
          headers[name] = value
        }
        try requireRemote(headers["set-cookie"] == nil && headers["location"] == nil && headers["content-encoding"] == nil)
        let type = headers["content-type"]?.lowercased()
        try requireRemote(type == (stream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8"))
        if stream { try requireRemote(status == 200, .stream_closed) }
        if let length = headers["content-length"] {
          try requireRemote(headers["transfer-encoding"] == nil && matches(length, "^(0|[1-9][0-9]{0,7})$"))
          guard let size = Int(length), size <= 1_048_576, !stream else { throw RemoteFault.capacity_exceeded }
          state = .fixed(size)
        } else {
          try requireRemote(headers["transfer-encoding"]?.lowercased() == "chunked")
          state = .chunkSize
        }
        if stream { opened() }
      case .fixed(let left):
        let count = min(left, buffer.count)
        try payload(Data(buffer.prefix(count))); buffer.removeFirst(count)
        if left == count { try finish(); return }
        state = .fixed(left - count); return
      case .chunkSize:
        guard let range = buffer.range(of: Data("\r\n".utf8)) else { try requireRemote(buffer.count <= 16); return }
        guard let sizeText = String(data: buffer[..<range.lowerBound], encoding: .ascii), matches(sizeText, "^[0-9a-fA-F]{1,6}$"),
              let size = Int(sizeText, radix: 16), size <= 1_048_576 else { throw RemoteFault.capacity_exceeded }
        buffer.removeSubrange(..<range.upperBound)
        state = size == 0 ? .trailers : .chunk(size)
      case .chunk(let left):
        guard !buffer.isEmpty else { return }
        let count = min(left, buffer.count)
        try payload(Data(buffer.prefix(count))); buffer.removeFirst(count)
        state = left == count ? .chunkEnd : .chunk(left - count)
      case .chunkEnd:
        guard buffer.count >= 2 else { return }
        try requireRemote(buffer.prefix(2) == Data("\r\n".utf8)); buffer.removeFirst(2); state = .chunkSize
      case .trailers:
        guard buffer.count >= 2 else { return }
        try requireRemote(buffer.prefix(2) == Data("\r\n".utf8)); buffer.removeFirst(2)
        try finish(); return
      case .done:
        try requireRemote(buffer.isEmpty); return
      }
    }
  }
  private func payload(_ data: Data) throws {
    if !stream {
      try requireRemote(body.count + data.count <= 1_048_576, .capacity_exceeded); body.append(data); return
    }
    // Bound every line and whole SSE event, including comments/unknown fields.
    for byte in data {
      lineBuffer.append(byte)
      try requireRemote(lineBuffer.count <= 65536 + 8, .capacity_exceeded)
      if byte != 10 { continue }
      var line = lineBuffer; lineBuffer.removeAll(keepingCapacity: true)
      line.removeLast(); if line.last == 13 { line.removeLast() }
      guard let text = String(data: line, encoding: .utf8) else { throw RemoteFault.frame_invalid }
      if text.hasPrefix(":") { try requireRemote(line.count <= 1024, .capacity_exceeded); continue }
      if text.isEmpty {
        if let data = eventData {
          guard let raw = data.data(using: .utf8), raw.count <= 65536,
                let value = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
                let event = value["event"] as? String, eventName == nil || eventName == event else { throw RemoteFault.frame_invalid }
          frame(data)
        } else { try requireRemote(eventName == nil, .frame_invalid) }
        eventName = nil; eventData = nil; frameBytes = 0
      } else {
        frameBytes += line.count + 1
        try requireRemote(frameBytes <= 65536 + 128, .capacity_exceeded)
        if text.hasPrefix("event: ") {
          try requireRemote(eventName == nil, .frame_invalid)
          let event = String(text.dropFirst(7))
          try requireRemote(["snapshot", "message.append", "conversation.status", "approval.pending", "approval.settled", "reset"].contains(event), .frame_invalid)
          eventName = event
        } else if text.hasPrefix("data: ") {
          try requireRemote(eventData == nil, .frame_invalid); eventData = String(text.dropFirst(6))
        } else { throw RemoteFault.frame_invalid }
      }
    }
  }
  private func finish() throws {
    try requireRemote(buffer.isEmpty)
    state = .done
    if stream { throw RemoteFault.stream_closed }
    guard let text = String(data: body, encoding: .utf8) else { throw RemoteFault.invalid_request }
    response(RemoteWireResponse(status: status, body: text))
  }
  func end() throws {
    if case .done = state { return }
    throw RemoteFault.stream_closed
  }
}

/** Each connection performs a fresh pinned TLS handshake before HTTP bytes. */
final class PinnedConnection: @unchecked Sendable {
  private let queue = DispatchQueue(label: "pi-gui.remote.connection")
  private let connection: NWConnection
  private let decoder: RemoteHTTPDecoder
  private let requestBytes: Data
  private let stream: Bool
  private let complete: (Result<RemoteWireResponse, RemoteFault>) -> Void
  private let admit: (@escaping () -> Void) -> Bool
  private var ended = false
  private var timer: DispatchWorkItem?

  init(endpoint: RemoteEndpoint, pin: String, request: RemoteRequest, stream: Bool,
       onOpen: @escaping () -> Void = {}, onFrame: @escaping (String) -> Void = { _ in },
       admit: @escaping (@escaping () -> Void) -> Bool = { effect in effect(); return true },
       complete: @escaping (Result<RemoteWireResponse, RemoteFault>) -> Void) {
    self.stream = stream; self.complete = complete; self.admit = admit; requestBytes = request.bytes(endpoint: endpoint)
    decoder = RemoteHTTPDecoder(stream: stream)
    let tls = NWProtocolTLS.Options()
    sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
    sec_protocol_options_set_tls_resumption_enabled(tls.securityProtocolOptions, false)
    sec_protocol_options_set_tls_false_start_enabled(tls.securityProtocolOptions, false)
    sec_protocol_options_set_tls_renegotiation_enabled(tls.securityProtocolOptions, false)
    sec_protocol_options_add_tls_application_protocol(tls.securityProtocolOptions, "http/1.1")
    sec_protocol_options_set_tls_server_name(tls.securityProtocolOptions, endpoint.host)
    sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, secTrust, verified in
      let trust = sec_trust_copy_ref(secTrust).takeRetainedValue()
      guard let certificate = SecTrustGetCertificateAtIndex(trust, 0) else { verified(false); return }
      let bytes = SecCertificateCopyData(certificate) as Data
      guard sha256(bytes) == pin else { verified(false); return }
      // The exact pin is the identity. A private self-signed leaf is its own
      // explicit trust anchor; normal X.509 time/algorithm checks still run.
      guard SecTrustSetAnchorCertificates(trust, [certificate] as CFArray) == errSecSuccess,
            SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
            SecTrustSetPolicies(trust, SecPolicyCreateBasicX509()) == errSecSuccess else { verified(false); return }
      verified(SecTrustEvaluateWithError(trust, nil))
    }, queue)
    let tcp = NWProtocolTCP.Options(); tcp.connectionTimeout = 15
    connection = NWConnection(host: NWEndpoint.Host(endpoint.host), port: NWEndpoint.Port(rawValue: endpoint.port)!, using: NWParameters(tls: tls, tcp: tcp))
    decoder.opened = onOpen; decoder.frame = onFrame
    decoder.response = { [weak self] response in self?.finish(.success(response)) }
  }
  func start() {
    queue.async {
      guard !self.ended else { return }
      self.armTimer()
      self.connection.stateUpdateHandler = { [weak self] state in
        guard let self, !self.ended else { return }
        switch state {
        case .ready:
          let admitted = self.admit {
            self.connection.send(content: self.requestBytes, completion: .contentProcessed { [weak self] error in
              guard let self, !self.ended else { return }
              if error != nil { self.finish(.failure(.transport_unavailable)); return }
              self.receive()
            })
          }
          if !admitted { self.finish(.failure(.disabled)) }
        case .failed, .cancelled: self.finish(.failure(.transport_unavailable))
        default: break
        }
      }
      self.connection.start(queue: self.queue)
    }
  }
  func cancel() { queue.async { self.finish(.failure(.stream_closed)) } }
  private func armTimer() {
    timer?.cancel()
    let item = DispatchWorkItem { [weak self] in self?.finish(.failure(.transport_unavailable)) }
    timer = item; queue.asyncAfter(deadline: .now() + (stream ? 45 : 30), execute: item)
  }
  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, eof, error in
      guard let self, !self.ended else { return }
      do {
        if let data, !data.isEmpty { if self.stream { self.armTimer() }; try self.decoder.feed(data) }
        if self.ended { return }
        if eof || error != nil { try self.decoder.end(); return }
        self.receive()
      } catch let fault as RemoteFault { self.finish(.failure(fault)) }
      catch { self.finish(.failure(.frame_invalid)) }
    }
  }
  private func finish(_ result: Result<RemoteWireResponse, RemoteFault>) {
    if ended { return }; ended = true
    timer?.cancel(); connection.stateUpdateHandler = nil; connection.cancel(); complete(result)
  }
}

import ExpoModulesCore

private func boundary<T>(_ work: () throws -> T) throws -> T {
  do { return try work() }
  catch { throw Exception(name: "RemoteConnectionError", description: (error as? RemoteFault ?? .transport_unavailable).rawValue, code: (error as? RemoteFault ?? .transport_unavailable).rawValue) }
}

public final class PiGuiRemoteModule: Module {
  private let remote = RemoteService()
  public func definition() -> ModuleDefinition {
    Name("PiGuiRemote")
    Events("remoteFrame", "remoteClosed", "remoteOpened")
    OnCreate {
      self.remote.event = { [weak self] name, payload in self?.sendEvent(name, payload.mapValues { $0 as Any? }) }
    }
    OnDestroy { self.remote.stop() }
    Function("preparePairing") { (bootstrap: String, name: String, scopes: String) throws -> String in
      try boundary { try self.remote.prepare(bootstrap, name: name, scopesJSON: scopes) }
    }
    AsyncFunction("exchangePairing") { (handle: String) async throws -> String in
      do { return try await self.remote.exchange(handle) }
      catch { throw Exception(name: "RemoteConnectionError", description: (error as? RemoteFault ?? .transport_unavailable).rawValue) }
    }
    Function("activate") { (handle: String) throws -> String in try boundary { try self.remote.activate(handle) } }
    Function("deactivate") { (handle: String) in self.remote.deactivate(handle) }
    Function("forget") { (handle: String) throws in try boundary { try self.remote.forget(handle) } }
    Function("sign") { (handle: String, message: String) throws -> String in try boundary { try self.remote.sign(handle, message: message) } }
    Function("verify") { (publicKey: String, signature: String, message: String) -> Bool in verifyEd25519(publicKey, signature: signature, message: message) }
    Function("randomBytes") { (length: Int) throws -> String in try boundary { b64url(try secureBytes(length)) } }
    AsyncFunction("send") { (handle: String, raw: String) async throws -> String in
      do { return try await self.remote.send(handle, raw: raw) }
      catch { throw Exception(name: "RemoteConnectionError", description: (error as? RemoteFault ?? .transport_unavailable).rawValue) }
    }
    Function("subscribe") { (handle: String, id: String, raw: String) throws in try boundary { try self.remote.subscribe(handle, id: id, raw: raw) } }
    Function("closeStream") { (id: String) in self.remote.closeStream(id) }
    Function("acknowledgeFrame") { (id: String) in self.remote.acknowledge(id) }
  }
}

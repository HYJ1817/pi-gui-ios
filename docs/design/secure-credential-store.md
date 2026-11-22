# M0 设计 · 移动凭据与密钥存储（proposal / 未冻结）

状态：**design-only**，不授权实现。权威安全边界见 `docs/contracts/remote-v1.json` 与 `docs/security.md`。本文拟定移动端持有/不持有的秘密及其存储。

## 持有的秘密（仅这些）

| 秘密 | 生成 | 存储 | 用途 |
|---|---|---|---|
| 设备 Ed25519 私钥（32B seed / PKCS8） | 配对时设备本地生成 | **iOS Keychain / Expo SecureStore**（`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`） | 签名 `signedRequest` 每个操作 + 配对 proof |
| 配对后的 `deviceId` | 桌面下发 | SecureStore（非秘密元数据也可放偏好，但与私钥一致便于原子清理） | 签名头 `x-pi-remote-device` |
| pin 的 `serviceFingerprint`（64-hex SHA-256） | 配对引导信道带内 pin | SecureStore | 钉住桌面服务身份，`canonicalServiceId = 'svc-'+fp[0:16]` |
| `grantedScopes` / `replayEpoch` / `expiresAt` | 配对响应 | 本地持久化（ReplayStore） | scope 提示、签名 epoch 单调、过期后强制重新配对 |
| 桌面服务 Ed25519 公钥 | 配对响应 | SecureStore | 校验事件帧 `frameAuthentication` |

## 明确不持有

- `PI_GUI_TOKEN`、桌面本地 `Origin` token、桌面内部 session id/凭据。
- 任何模型 API Key、OAuth access/refresh token、Pi 进程环境变量。
- 桌面项目绝对路径、会话文件路径、原始日志。
- 长效桌面凭据（设备凭据本身即唯一长效物，且可单独撤销）。

## 派生与非秘密缓存

- `serviceId = 'svc-' + serviceFingerprint[0:16]`：纯派生，非秘密，可放普通缓存。
- 事件 `cursor`、最后 `streamGeneration`/`sequence`：`AsyncStorage`/内存，非秘密；`events.subscribe` 时用，stale/foreign 由服务端 reset。
- 幂等 `(deviceId, requestId)` 本地去重缓存：内存+有界持久化，非秘密。

## 生命周期与失败姿态

- **生成**：配对窗口内本地 `crypto.getRandomValues`/`ed25519` keygen；公钥进 `pair.exchange` proof（绑定 `pairCode/displayName/deviceKey/clientNonce/serviceFp`）。
- **吊销**：`replayEpoch`/`grantedScopes` 失效或 `unauthorized`/`device_inactive` 持续 → 清本地凭据并回配对入口；不做静默重试或降级到弱通道。
- **SideStore 重签风险**：iOS Keychain 在重新签名/换 TeamID 后可能不可读 → 视设备为未配对，触发重新配对流程；不能退化为把私钥写磁盘/备份。**待实测**（最终真机清单）。
- **备份**：凭据 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`（非 iCloud 备份）；禁止 secret 进 `NSUserDefaults`/文件/`AsyncStorage`。
- **内存**：签名私钥尽量短驻留；SecureStore 每次取用而非长期缓存明文（M1 性能权衡待评）。

## 威胁对应

- 窃取设备 → Keychain 保护 + 桌面吊销 + `replayEpoch`/`expiresAt` 上限。
- 私钥泄露 → 单设备凭据 + per-device nonce/`acceptedTimestampFloor` + scope/授权白名单限制爆炸半径。
- 伪造 service → pin 的 `serviceFingerprint` + Ed25519 帧校验，不信任 PKI/域名。
- 重放 → nonce + timestamp skew `signatureClockSkewSeconds=60` + `acceptedTimestampFloor` + `replayEpoch` 单调。

## 待验证

- Expo SecureStore ↔ iOS Keychain 在 SideStore/无 Apple Developer 账户下的可用性与持久性。
- 是否使用 `expo-secure-store` 的 `keychainService`/`accessGroup` 隔离多设备条目。
- 大消息签名性能（Ed25519 over ≤262144B body digest，M1 实测）。

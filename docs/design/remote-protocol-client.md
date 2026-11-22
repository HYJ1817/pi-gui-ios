# M0 设计 · 类型化 Remote Client（proposal / 未冻结）

状态：**design-only**，不授权实现。权威协议定义是 `docs/contracts/remote-v1.json`（status `design-contract`）+ `scripts/lib/remote-protocol-contract.mjs`（参考验证器，桌面权威端语义）。本文描述移动端 client 的拟定形状；所有安全细节以合同为准。

## 目标与非目标

- 目标：把移动端对桌面的访问收敛为一个**闭集类型化 client**——只能发送 `operations[]` 中的 8 个操作，只能携带合同字段，只能接收闭集信封。
- 非目标：通用 HTTP 客户端、通用 RPC 代理、任意 endpoint/header/query 转发、直接访问桌面 `/api/*`、持有 `PI_GUI_TOKEN`/模型/OAuth 凭据。

## Client 组成

```text
RemoteClient
 ├── TransportAdapter   (fetch/WebSocket, TLS, 仅 /remote/v1/*)
 ├── Signer             (Ed25519 device key, canonical signedMessage)
 ├── OperationCodec     (8 个闭集 op 的 request→result 编解码)
 ├── EventStreamClient  (events.subscribe + 帧校验 + cursor/generation)
 ├── PairingClient      (pair.exchange 引导, 一次性, 凭据入 SecureStore)
 └── Store              (SecureStore 凭据 + AsyncStorage 缓存游标, 无秘密)
```

## 请求签名（client 侧职责）

每次操作请求携带 `signedRequest.requiredHeaders` 的 7 个头（`x-pi-remote-device`, `x-pi-remote-epoch`, `x-pi-remote-request-id`, `x-pi-remote-timestamp`, `x-pi-remote-nonce`, `x-pi-remote-body-sha256`, `x-pi-remote-signature`），加固定 `content-type`/`accept`。签名消息 `signedRequest.signedMessage`（权威串）由 client 对 `METHOD + 已校验 rawTarget + timestamp + nonce + bodySha256` 做 Ed25519 签名（device 私钥）。

client **不**自行构造 path：8 个 op 各有 `operation.route` 模板与 `ownerRequirement`；client 只填 opaque `projectId`/`conversationId`/`requestId`（`^[a-z0-9]+-[a-z0-9-]{6,}$`）与 query 闭集参数，其余字符一律拒绝。`requestId` 由 client 生成 UUID v4，签名并用于幂等 `(deviceId, requestId)`。

## 响应信封

client 只接受 `responseEnvelope`：`{protocolVersion,requestId,operation,serverRevision,result}` 或 `{protocolVersion,requestId,error:{code∈17 闭集,retryable}}`。`requestId` 必须回显请求的 UUID；仅 `unauthorized` 错误允许 `ZERO_UUID`（uncorrelated）。任何额外字段、非闭集 code、`result` 内含 `hasForbiddenKey`/`hasForbiddenValue` 一律拒绝。

## Operation 调用面（8 个）

| op | scope | owner | 关键约束 |
|---|---|---|---|
| `projects.list` | `projects.read` | collection | 无参数 |
| `sessions.list` | `sessions.read` | project | `projectId` |
| `runtime.create` | `sessions.create` | project | `projectId`(+query) |
| `runtime.snapshot` | `sessions.read` | conversation | `conversationId` |
| `chat.send` | `chat.send` | conversation | `conversationId`+body |
| `chat.stop` | `chat.stop` | conversation | `conversationId` |
| `approvals.list` | `approvals.read` | conversation | `conversationId` |
| `approvals.respond` | `approvals.respond` | approval | `requestId`+body |

8 个业务 op **不接收 query 参数**——`projectId`/`conversationId`/`requestId` 都是 `pathParameters`（路径模板内），值受 opaque 模式 `^[A-Za-z0-9_-]{8,128}$` 约束；唯一带 query 的是 `events.subscribe` 的 `cursor`（受 `cursorPattern`）。签名 tuple 里的 `path?canonicalQuery` 是已校验的 raw target，不是客户端可自由拼的 query。

## 事件流 client

- `events.subscribe`（GET `/remote/v1/events`，query 仅 `cursor`）建立签名 SSE/WebSocket **设备级**事件流——不在订阅请求里指定 project/conversation；目标资源由服务端按 grant/owner 投影，帧内 `conversationId`/`ownerRevision` 携带归属。client 校验每个 `eventEnvelope` 的 `frameAuthentication.frameMessage`（Ed25519，**PINNED service key**），检查 `streamGeneration`/`sequence`/`conversationId`/`ownerRevision`/`cursor` 单调绑定本订阅与设备。
- `payload` 仅 6 个闭集 schema：`snapshot`、`message.append`、`conversation.status`、`approval.pending`、`approval.settled`、`reset`。`snapshot` 的 `payload.messages[].text` 与 `message.append.payload.text` 是投影转录文本（凭据扫描 + `maxSerializedJsonBytes=8192`）；`snapshot`/`conversation.status` 不携带 `revision` 字段（`ownerRevision` 在信封上）。
- cursor 语义遵循 `cursorTransitionTable`： malformed→`invalid_request`；wellformed-stale/expired/foreign→新 `streamGeneration`+一次性 `reset`（client 用 `reset` 快照重新对齐，不得跨设备猜游标）。`maxConcurrentStreamsPerDevice=2`。

## 配对 client

`pair.exchange`（POST `/remote/v1/pair/exchange`，**唯一未认证**入口）只在桌面本地用户显式开启配对窗口后进行：`reservePairBudget → validatePairingSession → recordPairAttempt → verifyPairProof（设备 Ed25519 proof 绑定 code/displayName/deviceKey/nonce/serviceFp）→ verifyPairCode → confirmLocally → atomic 注册`。响应仅在 `outstandingExchange`（含 `serviceFingerprint`+`devicePublicKey`+nonce+精确 `requestedScopes==grantedScopes`+`replayEpoch`）原子核对后消费，单次退役。client 据此获得 `deviceId`、`grantedScopes`、**由注册事务分配的 `replayEpoch`（re-pair 会递增，不能硬编码为 1）**、pin 住的 `serviceFingerprint` 与桌面服务公钥；`replayEpoch` 在 `x-pi-remote-epoch` 里回显，直到下一次 re-pair。

## 错误与安全姿态

- 失败即闭合：任何 transport/校验异常映射为本地失败，不构造回退通道。
- client 不缓存 `pairingSessionId`/`pairCode` 之外的长效秘密；`replayEpoch` 随签名头单调递增（设备本地持久化）。
- `chat.send` `payload.text` ≤ `maxSerializedJsonBytes=8192`；`approvals.respond` 按 `decisionMatrix`：select 仅 `answer`+`optionId`，confirm 仅 `allow/deny`，input/editor 是 `answer`(带值)/`cancel`。
- 所有输入先经与 `remote-protocol-contract.mjs` 同源的 schema/UTF-8/限长/禁值扫描，再签名发送——但**权威校验始终在桌面**；client 校验只用于早期失败与 UX。

## 待验证项（M1 决定）

- transport 落地：同一 TLS listener 上的 REST+SSE 还是 WebSocket 复用。
- SecureStore 在 SideStore 重签名下的持久性（见 secure-credential-store.md）。
- client 是否需要把 `expectedRevision`/`ownerEpoch` 暴露给 UI（乐观并发提示 vs 静默 reset）。

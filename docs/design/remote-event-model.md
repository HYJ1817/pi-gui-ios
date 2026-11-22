# M0 设计 · 远程事件/投影模型（proposal / 未冻结）

状态：**design-only**。权威定义是 `docs/contracts/remote-v1.json` 的 `eventStream`/`projectionPolicy`。本文说明移动端如何消费事件并映射到 UI 状态。

## 源 → 投影 → 移动端

```text
桌面内部事件 (runtime-registry / SSE / approvals / sessions)
   └─ Remote Gateway 按 operation/字段白名单 + 每事件 scope 投影
        └─ 签名 eventEnvelope (Ed25519 service key)
             └─ 移动端 EventStreamClient → UI store
```

移动端**永不**接收：桌面原始 SSE、内部 runtime/registry 身份、绝对路径、原始日志、token、模型凭据、任意 endpoint 数据。

## 事件帧（`eventStream.eventEnvelope`）

每帧（`eventEnvelope`，`additionalProperties:false`）：`{protocolVersion, sequence, conversationId, event, payload, ownerRevision, streamGeneration, cursor, frameSignature}`。设备/服务身份不走帧字段——帧签名消息里绑定 `deviceId`/`serviceId`，由 `frameAuthentication` 验签证明，信封本身不携带。

- `frameAuthentication.frameMessage` 由桌面服务 Ed25519 签名；client 用**已 pin 的 `serviceFingerprint`/serviceId 对应公钥**验签。
- `frameAuthentication.authorizationRecheck`/`resourceAuthorization`：服务端在投递/重放每帧前重验 device-active、per-event scope、当前 resource owner、ownerRevision；失配 → 丢帧 + reset。
- `sequence` 严格单调（`streamGeneration` 内）；`cursor` 绑定 `(deviceId, streamGeneration, lastSequence)`，只在本订阅内有效。

## 6 个闭集 payload（`eventPayloadSchemas`）

| event | 语义 | UI 用途 |
|---|---|---|
| `snapshot` | `payload.messages[]` + `payload.status` + `payload.revision` | 会话首屏/重置后的状态基线 |
| `message.append` | `payload.text`（投影转录，≤32768B，过凭据扫描） | 流式追加消息 |
| `conversation.status` | `payload.status`,`payload.revision` | 运行/空闲/停止态 |
| `approval.pending` | `payload.method`,`payload.options[{optionId,label}]` | 弹出待决审批 |
| `approval.settled` | `payload.requestId`,`payload.status` | 移除已决审批 |
| `reset` | `payload.reason` | 订阅重建基线（`cursor_expired`/`sequence_gap`/`authorization_changed`/`owner_changed`） |

`approval.pending.options.optionId` 与 `approvals.respond` 的 `optionId` 同源（`{1,128}` 唯一）；`projectionPolicy.optionConsistency` 保证 answer 不比 option 严。

## cursor / 断线 / reset 语义

- `cursorPattern`  opaque；client 不解析，只在续传时回传。
- `cursorTransitionTable`：absent→新 generation；valid→继续；wellformed-stale/expired/foreign→新 generation + 恰好一次 `reset`；malformed→`invalid_request`。
- client 收到 `reset`：丢弃本地该订阅增量缓存，以 `snapshot`/最新帧重建 UI；`resetMonotonic` 保证只接受 streamGeneration 严格增大的 reset（新鲜订阅除外）。
- 背压/丢失：`perDeviceBacklog`+`snapshotWindow`+`transcriptBounds`（≤8KB 转录、≤256 事件、≤1MB backlog、≤300s 年龄）；溢出靠 `reset` 恢复。
- 并发：`maxConcurrentStreamsPerDevice=2`，`concurrency` 约束每订阅。

## UI 投影映射（建议）

- 每个活跃 `conversationId` 维护：`{streamGeneration, expectedSequence, lastCursor, baselineSnapshot, pendingMessages[], approvals[]}`。
- `ownerRevision` 变化 → 视为 owner 变化信号（UI 可显示“会话已由新 owner 接管”或直接 reset）。
- `approval.settled` 到达即移除对应 `approval.pending`（请求 id 一致）。
- 转录文本仅渲染，不当作可执行数据；投影已限长/扫描。

## 待验证

- SSE vs WebSocket 落地（M1 决定 transport）。
- 移动后台/省电策略下 cursor/backlog 寿命（`maxEventBacklogAgeSeconds=300` 是否够）。
- 多设备同订阅的 cursor 独立性（cursor 绑定 deviceId，互不干扰）。

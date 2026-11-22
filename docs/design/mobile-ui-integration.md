# M0 设计 · 移动 UI 集成边界（M0 已冻结 v1 · 远程仍默认关闭）

状态：**M0 冻结 v1**，实现由 M2/M3 起按任务推进。约定 UI 如何经由类型化 Remote Client（`remote-protocol-client.md`）+ 事件模型（`remote-event-model.md`）呈现远程数据。权威协议见 `docs/contracts/remote-v1.json`。

## 分层

```text
Screen/Component (React Native + React Navigation)
   └─ UI store / hooks
        └─ RemoteClient (8 ops + events.subscribe)
             └─ Remote Gateway → 桌面领域服务 → Pi
```

UI 只与**类型化 client API** 交互；不直接构造 HTTP、不知道 `PI_GUI_TOKEN`、不处理绝对路径/内部身份。所有字段已通过桌面投影白名单。

## 屏幕 ↔ 操作映射（建议）

| 屏幕 | 依赖 op / 事件 | 关键状态 |
|---|---|---|
| 配对/连接设置 | `pair.exchange`（仅桌面开配对窗时） | 设备凭据、`serviceFingerprint` pin、`grantedScopes`、`expiresAt` |
| 项目列表 | `projects.list` | 授权项目（opaque `projectId`,`displayName`） |
| 会话列表 | `sessions.list` | 项目下会话（`conversationId`,`active`,`title`） |
| 会话详情/聊天 | `events.subscribe`（设备级，仅 `cursor` query）+ `runtime.snapshot` + `chat.send`/`chat.stop` | 消息流、运行态、cursor |
| 待审批 | `approvals.list` + 事件 `approval.pending`/`approval.settled` | 待决对话框（`requestId,method,options`） |
| 运行时创建 | `runtime.create` | 新会话的 `{conversationId, ownerRevision}` |

## 数据形状（UI 所见）

- 项目：`{projectId, displayName, path?（投影后不含绝对路径）}` — 注意桌面投影已剔除敏感路径字段。
- 会话：`{sessionId, displayName, updatedAt, projectId, activeConversations:[{conversationId}]}`（与 `sessions.list` result 一致；无 `revision` 字段，ownerRevision 在事件信封上）。
- 消息：`{text, role, timestamp}`，转录文本 ≤ `maxSerializedJsonBytes=8192`（凭据扫描已过滤敏感值）。
- 审批：`{requestId, method, title, message, options:[{optionId,label}]}`；`approvals.respond` 发送 `{method, decision∈allow/deny/cancel/answer, value?}`（select 的 value 是 `optionId`，input/editor 是文本），返回 `{accepted, ownerRevision}`。

## 状态/错误姿态（UI 承诺）

- 无连接/未配对 → 明确“需在桌面开启配对窗口”引导，不做后台自动重连到未授权状态。
- `unauthorized`/`device_inactive` → 凭据失效，引导重新配对；不静默降级。
- `stale_owner`/`stale_revision`/`unknown_resource` → 资源已转移/撤销，返回列表并刷新。
- `cursor reset` → 无感重建消息基线，用户看到连续性，不显示内部 cursor。
- 审批应答一次性；超时/已被其他设备 settle → 按钮置灰并刷新列表。
- 永不显示：原始错误文本、内部 commit/路径、token、原始日志。

## 待验证（与 M1/M3 联动）

- React Navigation 路由与 `events.subscribe` 生命周期绑定（进/出会话详情开关流）。
- 后台/锁屏时 SSE/WebSocket 挂起与恢复（是否需本地通知提示“审批待处理”）。
- 大快照（`runtime.snapshot` ≤1MB）渲染分页/虚拟化策略。
- 审批 UI 对 `select`(options) 与 `confirm` 的统一控件。

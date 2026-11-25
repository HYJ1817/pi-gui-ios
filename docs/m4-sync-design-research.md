# M4-sync 调研设计（草案 · 并行调研产物 · 非冻结契约）

状态：**调研草案**（2026-11-25，M3-core 证据链收尾期间并行编写）。本文件不是契约变更——冻结合约仍是 `docs/contracts/remote-v1.json`；正式设计/ADR 在 M3 accepted 后提交至 `docs/design/`。

## 1. M4 范围（ROADMAP）

流式通信、快照+游标增量、断线重连/补发、多设备 revision/幂等。
门槛：乱序/重复/间隙/重启/撤销、故障注入/慢客户端/双设备一致性 —— **状态不能可靠恢复即停止**。
必需证据：`unit`、`integration`、`fault-injection`（新 kind）、`independent-review`。

## 2. 桌面参考实现的事件流模型（server/remote/event-stream.mjs，M4 权威语义）

与 M3 合成 sandbox 的**结构性差异**（M3 sandbox 是简化模型，M4 需对齐参考语义或显式记录决策）：

| 维度 | 桌面参考 | M3 sandbox 现状 | M4 决策需求 |
|---|---|---|---|
| generation 空间 | **每订阅隔离**：stale resubscribe 只重置自己的 generation，不扰动其他订阅 | 设备级共享 journal+generation，stale 重置全设备 | 对齐参考（每订阅隔离）——重绑逻辑可删，语义更干净 |
| cursor | `g<gen>_s<seq>_<22char HMAC>` 绑定 (deviceId,generation,sequence)，**篡改=foreign→reset** | 明文 base64 `cur:device:gen:seq`，无完整性保护 | 对齐 HMAC 绑定（参考已证明必要） |
| backlog | 无签名模板共享 per device，**按订阅物化签名** | 每设备独立 journal，直接物化 | 对齐模板+物化模型 |
| backlog 溢出 | **溢出推进 generation** → 续传命中 reset 路径而非 gap | shift 丢弃最旧 → 产生真 gap | 对齐溢出=reset（**消除了 sequence_gap 的整个故障类**） |
| reset 占用 | 新 generation 自己的 sequence，下一帧=reset.sequence+1 | 同（已对齐） | — |
| 授权重验 | 投递/重放每帧前重验 device-active + per-event scope + grant+owner | 同（已对齐） | — |
| watermark | `stream.watermark(deviceId)` = epoch+head sequence+可续传 cursor | snapshot 返回 cursor/generation/sequence 但 store **从不使用** | 见 §3 |

## 3. 快照+游标原子水位线（契约 runtime.snapshot.watermark）

契约明确：`cursor+streamGeneration+sequence` 是快照返回状态的**原子水位线**，client 从该 cursor 续传并期望同 generation 继续。

**M3 缺口**：`client.snapshot()` 已解析 watermark 字段（client.ts:259-271），sandbox 也返回（sandbox.ts:449-454），但 `store.refresh()`/`load()` **完全丢弃**它——流续传与快照基线之间无原子性保证：
- 先快照后订阅：快照后的并发帧在订阅前丢失（窗口竞态）
- M4 必须实现：**快照水位线 → 流以该 cursor 续传**（乱序/重复由 position 跟踪自然排除）；watermark 过期 → reset 重建（契约路径，已验证）

这是 M4 的核心机制改动，发生在 `store.refresh`/`useRemote`/`recoverStream` 的协同上。

## 4. "流式通信"的语义决策点

合约事件闭集无 delta/chunk 事件：`message.append` 是**整条消息**追加。两个解读：
- (a) 已完成 M3 即满足"流式"（SSE 帧流）——但 ROADMAP 将流式列为 M4 范围，说明指更深
- (b) 助手输出**分块流式渲染**：需要 `message.append` 分块多次发射（同 messageId 的增量追加）或契约新增事件

**倾向**：(b) 且不扩事件集——`message.append` 语义本就是"追加"，允许同 messageId 分块；store 对同 id 做尾部合并。需要 ADR 决策 + 桌面侧确认（跨仓库协议不匹配 fail closed——若桌面 v1 不含分块语义，M4 只能做转录级增量渲染而不能改协议）。

## 5. 多设备 revision/幂等

合约幂等命名空间 `(deviceId, resourceId, ownerEpoch)`：owner epoch 滚动后 client id 成为新 key。M3 sandbox 台账未含 ownerEpoch 判定（`MutationRecord.ownerEpoch` 存了但 replay 查找未校验 epoch）。M4 需：
- replay 命中仅在 ownerEpoch 匹配时；epoch 不匹配=新 mutation（合约原文）
- 双设备同会话并发 send：rev 冲突 → stale_revision（已有）；重试幂等命中（需 epoch 校验）
- 撤销一台设备不影响另一台的流与幂等台账

## 6. 故障注入（fault-injection 证据 kind）

新测试基础设施：**对抗性传输/网关层**包装真实 sandbox，可编程注入：
1. **乱序**：帧重排（窗口内 shuffle）
2. **重复**：帧重复投递（同一帧多次）
3. **间隙**：静默丢弃 N 帧后继续
4. **伪造**：篡改 payload/sequence/generation/cursor/签名后投递
5. **断线重连**：close 后延时重订阅（带/不带 cursor、stale cursor、foreign cursor）
6. **慢客户端**：投递延迟+背压（backlog 溢出触发 reset 路径）
7. **撤销**：mid-stream revokeDevice/grant 收回 → 帧必须停止+reset
8. **重启**：网关状态重建（内存 fixture 重造）→ 全部订阅 reset 恢复
9. **双设备一致性**：两设备同会话，并发 mutation + 各自断线恢复 → 终态一致

每条的断言不变量：无伪造帧入 store；无重复应用；间隙后恢复完整；终态与权威服务端一致。
`fault-injection` scope = `['app','protocol','tests']`（KIND_SCOPES 已有定义）。

## 7. 与 M3 修复的衔接

M3 终审安全审查 note F3（`lastError` 复用会掩盖 stream_unavailable）建议 M4 做**专用流状态通道**——纳入 M4 范围：store 增加 `stream: {state: 'live'|'dead'|'recovering'}` 字段而非错误复用。

M3 的 sequence_gap 终态死亡机：在 M4 参考对齐（backlog 溢出=reset 而非 gap）后，真 gap 只剩**伪造/乱序注入**和**传输层丢帧**两个来源——死亡机仍必要但触发率大降；恢复路径（recoverStream）演变为 watermark 续传。

## 8. 开放问题（M4 启动时首先回答）

1. 桌面 v1 事件模型与 sandbox 的对齐是**改 sandbox**还是**改契约**？（默认：改 sandbox 对齐参考，不动冻结契约——契约 wording 已支持参考语义）
2. 分块流式是否需要协议 v2？（先查桌面 runtime 的真实输出路径——emit 时机）
3. 双设备测试需要 sandbox 支持多 device 并发——N4 修复后 emit 语义已就绪，fixture 需扩展
4. fault-injection 是独立测试文件还是 m3-loop 扩展？（倾向独立 tests/m4-fault-injection.test.mjs）

## 9. 并行期结论

M4 不需要契约变更即可启动的概率高；关键路径是 sandbox 事件流模型对齐（参考语义）+ watermark 原子续传 + 故障注入框架。设计/ADR 正式化在 M3 accepted 后立即进行。

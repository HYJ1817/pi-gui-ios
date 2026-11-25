# ADR 0010 · M4 实时同步模型：水位线续传、每订阅 generation、故障注入

状态：**proposed（M4-sync in_progress，待独立审查后 frozen）**。依据：`docs/m4-sync-design-research.md` 调研、`server/remote/event-stream.mjs`（桌面参考 `74d252f` 分支语义）、冻结合约 `docs/contracts/remote-v1.json`（本文**不变更**冻结契约，只决策移动端/sandbox 侧如何对齐其语义）。

## 决策 1：快照水位线的原子采用（核心机制）

契约 `runtime.snapshot.watermark`：`cursor+streamGeneration+sequence` 是快照返回状态的原子水位线，client 必须能从该 cursor 续传并期望同 generation 继续。

**决定**：`ConversationStore.refresh()`/`load()` 采纳快照水位线：`store` 记录每会话 `{watermarkCursor, watermarkGeneration, watermarkSequence}`；流管理器（useRemote/demo）在**首次订阅或恢复**时以**最新快照水位线的 cursor** 发起续传，而非无 cursor 加入 live head。

- 效果：先快照后订阅的窗口竞态被消除——窗口内的帧由 backlog 续传补齐，乱序/重复由客户端 position 跟踪自然排除。
- watermark 过期（stale）→ 服务端恰好一次 reset → 走 M3 已验证的 baseline 重建路径。
- `recoverStream` 从"reload 后无 cursor 加入"改为"reload 后以最新水位线续传"——恢复不再丢帧。

## 决策 2：sandbox 事件流对齐参考语义（不碰冻结契约）

M3 sandbox 的设备级共享 journal+generation 与参考实现存在结构性差异。M4 sandbox 重写对齐参考（`server/remote/event-stream.mjs`）：

1. **每订阅 generation 隔离**：stale resubscribe 只为该订阅铸造新 generation + 恰好一次 reset；其他订阅不受影响（M3 的"共谋订阅重绑"逻辑整体删除）。
2. **HMAC 绑定 cursor**：`g<gen>_s<seq>_<22-char HMAC(deviceId,generation,sequence)>`，篡改或 foreign 与 wellformed-stale 不可区分 → 新 generation + reset（契约会话 cursorTransitionTable 原文）。
3. **模板+按订阅物化**：backlog 存无签名模板（共享 per device），每帧按订阅者 generation+其 cursor 物化签名——续传 cursor 永远可用。
4. **backlog 溢出推进 generation**（计数 256 / 字节 1MB / 年龄 300s，合约 limits）：溢出不再是真 gap 源，续传命中 reset 路径。**客户端 sequence_gap 终态死亡机保留**——它仍防伪造/乱序注入和传输层丢帧，只是触发率大降。

桌面 adapter 已确认（`server/remote/adapters.mjs` runtimeSnapshot）水位线由 `streamWatermark(deviceId)` 供给——移动端对齐后，未来接真实桌面时语义无缝。

## 决策 3：流式输出 = chunk-append，不扩协议事件集

桌面 publish 语义是 `message.append` 整条追加；合约事件闭集无 delta 事件。**决定**：同一 `messageId` 的多个 `message.append` 帧合法化为**增量分块**——后到的同 id 帧文本**替换/扩展**前帧（最终帧即完整消息），store 对同 id 做尾部合并（upsert 而非追加新气泡）。

- 理由：`append` 语义天然幂等于"该消息截至目前的完整文本"；不新增事件类型，契约 payload schema 不变（仍是 `{messageId, role, text}`）；无协议版本变更。
- 桌面 v1 当前按完成态一次性 emit——M4 的 sandbox fixture 会分块 emit 以测试客户端合并逻辑；未来桌面若做真流式输出，客户端已就绪。
- 若日后桌面否决此解读（跨仓库协议不匹配 fail closed），回退方案：转录级增量仅存在于 sandbox，不接真实桌面流式——本文记录此风险。

## 决策 4：幂等命名空间的 ownerEpoch 校验补全

合约幂等命名空间 `(deviceId, resourceId, ownerEpoch)`：retry 仅在**当前 owner epoch** 下被识别。sandbox `MutationRecord` 已存 ownerEpoch 但 replay 查找未校验。M4 修正：epoch 不匹配 = 新 mutation（合约原文"under a rolled owner epoch the client id is simply a fresh key"）。

## 决策 5：故障注入测试基础设施（fault-injection 证据）

新增 `tests/m4-fault-injection.test.mjs`：对抗性传输/网关包装层，可编程注入九类故障（乱序/重复/间隙/伪造/断线重连/慢客户端背压/撤销/重启/双设备并发）。每类注入断言不变量：无伪造帧入 store、无重复应用、间隙后恢复完整、终态与权威服务端一致、撤销后立即断流。证据 kind `fault-injection`（scope `['app','protocol','tests']` 已在 KIND_SCOPES 定义）。

## 决策 6：流状态的专用通道（F3 挂账修复）

M3 安全审查 note F3：`lastError` 复用会掩盖 `stream_unavailable`。M4 在 store 增加专用 `stream: { state: 'live'|'dead'|'recovering', conversationScope }` 字段，UI 徽标与恢复卡片改读该通道；`lastError` 回归纯操作错误语义。

## 决策 7：M2 挂账 nit 修复

`GlassSurface.tsx:74`：`surfaceElevated` 追加在 `contentStyle` 之后覆盖 approvalSurface 色调（RT fallback 路径，M2 验收时已存在）。M4 顺带修复（contentStyle 后置）。

## 不做的事

- 不变更冻结契约 `docs/contracts/remote-v1.json` 的任何字段、事件集或语义。
- 不改桌面仓库（参考语义已支持全部决策；如需 desktop 配合点，另立协议变更 ADR 流程）。
- 不在本阶段做真实网络传输（M5 范围）；故障注入全部在合成传输层。

## 验收映射（M4 门槛：乱序/重复/间隙/重启/撤销不破坏状态）

| 门槛 | 由什么证明 |
|---|---|
| 乱序 | fault-injection #1：重排帧被 position 跟踪拒绝/重排后恢复 |
| 重复 | fault-injection #2：重复帧精确一次应用 + 幂等 replay 命中 |
| 间隙 | fault-injection #3 + #5：死亡机触发 → 水位线续传恢复完整 |
| 重启 | fault-injection #8：网关重建后全订阅 reset 恢复 |
| 撤销 | fault-injection #7：mid-stream 撤销 → 帧停止 + reset，无泄漏 |
| 双设备一致性 | fault-injection #9：并发 mutation + 各自断线恢复终态一致 |
| 状态可靠恢复 | 全部上述 + 水位线原子续传单测 + integration 桌面复验 |

## 补遗（2026-11-25，独立审查两轮后）

**已修复并经回归测试钉死**：
1. reset 帧为每订阅瞬时投递，不进共享 journal（审查 important：共享序号空洞杀共谋订阅——契约 concurrency 违反）。
2. cursor MAC 加钥（service key material 为 synthetic 密钥替身；真实桌面必须使用秘密 MAC key——本文档为 M5 记录此要求）+ 代际盐绑定（重启后的同值 journal/head 不再错误验证旧 cursor——跨代际静默丢失闭环）。
3. grant/owner 撤销重置订阅（原 emit 内 resetOne 因流级 continue 不可达，死代码激活为 grantProject/rollOwnerEpoch 显式重置）。
4. envelope additionalProperties:false 客户端封闭校验；cursor 常量时间比较；快照水位线 minimum（generation/sequence >= 1）。
5. backlog 续传连续性规则（first-needed-retained）经独立审查验证为正确——比参考 floor 规则更忠实于契约水位线保证（参考规则会误杀 head-0 水位线）。

**已知限制（如实记录，defer M5 真实传输加固时解决）**：
- 首帧盲区（审查 nit 5）：`open()` 重置 position 后传输若恰好丢弃重放的第一帧则不可检测。合成传输有序故不可达；真实网络的缓解是 recoverStream 先经请求面刷新基线。契约 acceptance 未要求。
- recoverStream 在 open() 后立即标记 live（nit 8）：若重订阅被 admission 拒绝（如限流），store 误读 live。装饰级——传输 onClose/onDrop 通道仍在。
- fault 6 绕过 events.open 路径（nit 6）：reset 断言成立但生产 wiring 连续性未被同路径行使。由 regression co-subscription/cross-incarnation 测试补足覆盖。

### 终审补遗（2026-11-25 第二轮）

独立安全终审确认全部第一轮修复有效（16/16 故障注入复跑 + 两个新对抗探针）。新增一条 **M5 defer（审查者明确分类 non-blocking）**：

- **grant 撤销→重新授权窗口的静默分歧**：`grantProject(device, project, false)` 正确投递一次 reset，但订阅存活；撤销窗口内 `emit()` 在 journaling 阶段即按授权过滤（不进 journal），重新授权无 reset——窗口内的变更永久缺席客户端 store 而无任何信号。合成范围不可利用（钩子是测试专用服务端 API，签名操作不可达，demo 从不撤销，真实桌面撤销即需重新配对=全新无 cursor 订阅故无此洞）。**M5 桌面接入前必须修复或规范**：参考对齐的正确修法是事件**不**按授权进 journal、仅在投递/重放时过滤（这也吻合契约 mustRevalidateAuthorizationBeforeReplay 的措辞），或在重新授权时重置订阅。
- 旁注（终审 nit，M5 一并处理）：emit 订阅循环内 resetOne 同步语义下不可达（防御纵深保留）；watermark 的 epoch 与订阅 generation 共享计数器但语义空间不同（脆性不变量，值得注释）；sub.lastSeq 死簿记；re-pair 不重置流状态（同族生命周期问题）。

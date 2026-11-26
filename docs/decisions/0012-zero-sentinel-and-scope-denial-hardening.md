# ADR 0012 · 零哨兵错误关联规则澄清与 scope 拒绝终态化

日期：2026-11-26。状态：独立安全审查（final incremental security review）发现的协议语义缺陷修复；双仓同步 commit。

## 背景

最终增量安全审查（delegate 52014294）发现两项协议语义矛盾/缺陷：

1. **FS-005**：契约 `requestIdCorrelation` 说明配对交换没有请求 UUID，任何配对错误的 requestId 回声全零哨兵；但 `requestIdPolicy` 把全零哨兵严格限定为认证前 `unauthorized` 错误。验证器实现了 policy，导致合法的 `pairing_expired`/`pairing_rejected` 等配对错误响应无法通过项目自身的响应验证。
2. **FS-006**：契约 `acceptance` 规定验证失败的帧（scope 不覆盖、grant+owner 不授权等）"dropped and the stream reset"——客户端侧 terminal。但 `src/remote/events.ts` 对 per-event scope 拒绝只 drop 不 terminal，后续合法帧仍被应用，与 resource 授权失败（terminal）不一致。

## 决策

1. **零哨兵规则澄清**：全零 UUID 只允许在关联不可能的两类封闭情形——认证前失败（wire code `unauthorized`）与无签名配对交换错误（码集合恰好为配对 wire 词汇的封闭集：`unauthorized, payload_invalid, rate_limited, pairing_expired, pairing_rejected, unavailable, internal_error`）。契约 `requestIdPolicy` 与验证器按此对齐；双仓契约副本保持字节一致。成功响应与已认证错误仍必须回声真实 requestId。
2. **scope 拒绝终态化**：`events.ts` 的 per-event scope 拒绝改为 terminal stream death（fatal），与 resource 授权失败语义一致。恢复路径相同：快照水位线重新订阅。静默 drop 会让同一帧在授权翻转后被应用，破坏顺序。
3. **listener 写入前校验**：错误响应在写出前经 `validateRemoteResponse` 校验；任何不合法形状（包括携带零哨兵的越权码）回退为固定合法形状，绝不发出未通过项目自身 schema 的响应。

## 影响

- 配对负向行为对外不变（相同 wire 码/状态）；唯一变化是这些响应现在通过自身验证器而非被 schema 拒绝。
- 客户端 scope 拒绝的 UX 变化：流终止+快照恢复替代静默丢帧——这正是契约早已规定的语义。
- 桌面 FS-001/002/003/004 修复（device-store 事务纪律、时钟持久化回滚、游标重置关闭、日志净化）属于实现层强化，不改变协议语义，不需要 ADR，但其行为依据记录于此备查。

## 证据

- 桌面 `f4ae91c3` 之后链最新修复提交 + gateway/contract 全绿。
- 回归 pins 对每个修复在修复前父代码验证 FAIL、当前 PASS。
- 独立安全审查复验轮确认全部六项关闭后方可导入证据。

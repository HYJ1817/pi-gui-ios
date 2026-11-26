# 架构

## 当前运行路径

`App.tsx` 安装手势/安全区/键盘 provider，解析 Reduce Transparency 后挂载 React Navigation。iPhone 用 native stack；iPad 用原生 Split，由系统处理紧凑尺寸折叠。`GlassSurface` 仅在系统支持且未开启 Reduce Transparency 时使用 `GlassView`，否则实色回退。

`src/remote/useRemote.ts` 是显式 synthetic binding。`demo.ts` 保留 fixtures、合成配对和 `mode: 'synthetic'` singleton；`runtime.ts` 的 cold factory 从显式 client/crypto/stream/authorization 组装 `ConversationStore`、`EventStreamClient` 及流生命周期，构造不连接，demo 组合根才打开进程内网关事件流。项目/会话、消息、审批、快照/游标、重连均为合成演练。消息是有界文本列表，未安装的 Markdown/代码渲染候选不算交付。

`src/remote/native-port.ts`、`native.ts` 与 `modules/pi-gui-remote` 准备了显式启用的 Apple Network/Security/CryptoKit、HTTPS/SSE、Keychain/私钥边界。App/Settings 尚无生产配对或连接入口。**真实配对、真实 sessions/messages 和 live sync 仍属 P3 接线**，模块存在/合成通过不代表可用。

## 边界与源码入口

| 范围 | 入口 |
| --- | --- |
| 页面、导航、设计 | `src/screens/`、`src/navigation/`、`src/components/`、`src/design/` |
| 客户端、状态、事件与装配 | `src/remote/`：`runtime.ts` 负责 cold composition；`demo.ts` 保留合成实现 |
| 未接入 App 的原生连接边界 | `modules/pi-gui-remote/ios/` |
| 远程合同 | [remote-v1.json](contracts/remote-v1.json)；协议校验和双仓库集成测试 |
| 原生依赖与 CI | `native/`、`scripts/ci/`、`.github/workflows/`，见 [构建](releasing.md) / [测试](testing.md) |

目标真实链路是移动视图 → typed remote client → TLS/独立远程网关 → 桌面领域服务 → Pi RPC；不得把现有 localhost 后端、shell 或文件系统变成通用代理。协议、身份、权限及审批边界见 [安全模型](security.md)。

恢复控制层独立于 App：`.agent/control.json` 是唯一任务/运行状态权威，其余为投影，命令见 [AGENTS.md](../AGENTS.md)。[选型记录](decisions/technology-stack.md) 保留技术依据；历史 ADR/阶段文字按对应源码提交与证据阅读，不作当前能力/进度声明。

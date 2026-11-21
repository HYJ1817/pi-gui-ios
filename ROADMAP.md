# 开发路线与验收契约 v1

动态任务状态唯一在 .agent/control.json；本表只规定范围和依赖。未通过 M-1 不开发正式远程业务。用户授权自动推进，人工条件见 AGENTS.md。

| 阶段 | 依赖 | 范围 | 测试与完成门槛 | 停止条件 |
| --- | --- | --- | --- | --- |
| M-1 | 无 | 持久控制层；Windows Expo/TS；原生技术探针；macOS/Xcode/Simulator；Maestro；artifact 分析/失败修复闭环；unsigned device IPA；独立恢复交接 | 控制层故障测试、独立交接、Windows bundling、iPhone/iPad 原生玻璃/导航/菜单点击输入滑动断言、真实图审、CI 重跑、arm64 IPA 结构/Framework/权限检查、一次集中 SideStore 真机清单均有证据 | 账户授权/付费、Runner 不可用、设备人工验收未做不得标完成 |
| M0 | M-1 | 读双方源码；冻结整体架构/API v1/安全模型/模块边界 | ADR、双仓库基线、威胁模型、兼容/事件/审批契约、独立安全审查 | 无法保留已有审批或远程权限隔离 |
| M1 | M0 | 桌面隔离远程服务、显式开关、一次性配对、设备身份/权限/撤销 | fixture 集成、TLS、重放/并发配对/速率/撤销实时断连/所有权负向测试；桌面 canonical 测试 | 不可消除越权/秘密泄漏 |
| M2 | M1 | 优先对齐 T3 的 React Navigation 原生导航、Liquid Glass token/组件、iPad 响应式、系统主题/无障碍 | 模拟器 iPhone/iPad、旋转、大字、VoiceOver 标识、低透明/动效真图 | 核心原生能力不可用 |
| M3 | M2 | 项目/会话、消息/任务控制、模型选择、工具展示和审批 | synthetic 桌面/移动闭环；拒绝/超时/旧审批；有界列表/长消息；UI 验收 | 功能需绕开桌面已有约束 |
| M4 | M3 | 流式通信、快照+游标增量、断线重连/补发、多设备 revision/幂等 | 乱序/重复/间隙/重启/撤销、故障注入/慢客户端/双设备一致性 | 状态不能可靠恢复 |
| M5 | M4 | Tailscale 异地 HTTPS、真机性能/权限/兼容、安全审计 | 免费方案实际验证；网络切换/后台恢复；跨网真机一次清单；独立安全审查 | 需要付费/账户/设备操作 |
| M6 | M5 | unsigned IPA、版本检测、Release 草案/SideStore source、升级兼容 | IPA/隐私/权限/来源校验；升级/降级/撤销兼容、SideStore 自签重装保留；正式发布待明确授权 | 发布、main 合并均需用户批准 |

### 当前已授权的非阻断例外

2026-11-21，负责人要求不要因 M-1 锁定构建受阻而停止所有进展，授权 **M0 设计工作**并行推进；记录见 `docs/acceptance/owner-waiver-m0-design-progression.md`。该例外仅允许源码勘察、架构/协议/威胁模型草案和 synthetic 合同设计，不将 M-1 或 M-1-device 标为通过，不允许 M1 远程业务实现，不改变 M0 的独立安全审查、协议证据和其他验收门槛。ROADMAP 中的原始依赖仍是默认正式验收顺序；只有此次 M0 design-only 工作范围按 owner waiver 提前。

不缩减最终范围。技术栈以 T3 当前 main 为主要参考，逐项见 docs/decisions/technology-stack.md；Expo Router 不再是硬约束，优先 React Navigation。云账户/公网 relay 不移植；定制 fork 先查明依赖/许可证/调用前提并实际验证，不能机械搬入或无理由换掉成熟方案。M-1 必须完成 package/lock/native/导航/状态/消息/动画/玻璃/测试的完整分析与必要技术探针。桌面与移动各自独立 PR；协议先兼容再升级，合并顺序和发布依赖写入每次集成验收。

# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 2292；2026-11-26T17:52:05.828Z

阶段：M5；当前：M5-tailscale；分支：refactor/p2-maintainability

| 任务 | 状态 | 范围 |
| --- | --- | --- |
| M-1-infrastructure | testing | 恢复控制层、Windows 原生探针、macOS/Simulator/Maestro/unsigned IPA 验证 |
| M-1-device | pending | 最终一次 SideStore 免费签名安装与真机验收（全部软件完成后） |
| M0-architecture | testing | 冻结架构、协议和安全模型 |
| M1-remote | testing | 桌面远程授权、配对、撤销 |
| M2-shell | testing | 原生设计系统与 iPad 导航布局 |
| M3-core | testing | 会话、消息、任务、模型、工具及审批 |
| M4-sync | testing | 实时同步、断线补发、多设备一致性 |
| M5-tailscale | in_progress | Tailscale 异地与真机安全兼容 |
| M6-distribution | testing | IPA、版本检测、SideStore 源与发布候选 |

阻塞：无已记录阻塞

检查点：.agent/checkpoints/v2-2026-11-26T17-44-06-340Z-a912ee8c-5411-4fc8-8717-e398787942dc.json；保存时 HEAD：512fde80ea91360eff05cabd07a4076384fe8f41

CI：{"ci":1,"delegates":3,"activeCi":[],"workingDelegates":[],"archives":1}

下一步：P2 candidate assembled on refactor/p2-maintainability: independent functional/security reviews, consolidated tests/typecheck/bundle/desktop parity and fresh-clone recovery are next; then one five-job native CI and PR. See docs/acceptance/p2-maintainability.md. Do not start P3; device checks remain pending.

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

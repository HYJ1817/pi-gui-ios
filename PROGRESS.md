# 项目进度（生成文件）

权威：.agent/control.json；revision 7；2026-11-20T17:31:53.483Z

阶段：M-1；当前：M-1-infrastructure；分支：agent/m-1-bootstrap

| 任务 | 状态 | 范围 |
| --- | --- | --- |
| M-1-infrastructure | in_progress | 恢复控制层、Windows 原生探针、macOS/Simulator/Maestro/unsigned IPA 验证 |
| M-1-device | pending | 一次集中 SideStore 免费签名安装与真机验收 |
| M0-architecture | pending | 冻结架构、协议和安全模型 |
| M1-remote | pending | 桌面远程授权、配对、撤销 |
| M2-shell | pending | 原生设计系统与 iPad 导航布局 |
| M3-core | pending | 会话、消息、任务、模型、工具及审批 |
| M4-sync | pending | 实时同步、断线补发、多设备一致性 |
| M5-tailscale | pending | Tailscale 异地与真机安全兼容 |
| M6-distribution | pending | IPA、版本检测、SideStore 源与发布候选 |

阻塞：尚无已记录阻塞

检查点：2026-11-20T17-31-53-221Z-20476；代码 HEAD：58ec99506e00a35121866580ffb28d09d5078b17

CI：44783585115 in_progress/ @ 58ec99506e00a35121866580ffb28d09d5078b17

下一步：CI 44783585115 的 Windows checks 已通过，macOS 正在 CocoaPods 阶段；独立审查任务见 control.delegates，完成后读取结果并修复。原生/IPA/真机未验收。

测试/审查真实证据见 control 各任务 evidence 与 docs/acceptance/；未登记不视为通过。

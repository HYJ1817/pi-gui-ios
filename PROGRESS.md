# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 37；2026-11-21T03:58:47.770Z

阶段：M-1；当前：M-1-infrastructure；分支：agent/m-1-bootstrap

| 任务 | 状态 | 范围 |
| --- | --- | --- |
| M-1-infrastructure | testing | 恢复控制层、Windows 原生探针、macOS/Simulator/Maestro/unsigned IPA 验证 |
| M-1-device | pending | 一次集中 SideStore 免费签名安装与真机验收 |
| M0-architecture | pending | 冻结架构、协议和安全模型 |
| M1-remote | pending | 桌面远程授权、配对、撤销 |
| M2-shell | pending | 原生设计系统与 iPad 导航布局 |
| M3-core | pending | 会话、消息、任务、模型、工具及审批 |
| M4-sync | pending | 实时同步、断线补发、多设备一致性 |
| M5-tailscale | pending | Tailscale 异地与真机安全兼容 |
| M6-distribution | pending | IPA、版本检测、SideStore 源与发布候选 |

阻塞：S1 v2原始证据/类型/提交与递归门禁已实现，待精确提交独立复审；S2 IPA私有暂存/明确上传集合与脱敏诊断已实现，待独立复审及实际CI证明；S3 最终归档Mach-O/平台/签名/权限校验已实现，缺真实device IPA与独立复审；S4 工具版本和pipefail已实现，缺真实macOS候选锁/审核/locked构建；S5 symlink/junction普通文件边界已实现并回归，待独立复审；S6 完整schema与CI身份/状态导入已实现，待独立复审；S7 检查点先持久化/持锁修复/显式恢复和候选诊断已实现，待独立复审

检查点：.agent/checkpoints/v2-2026-11-21T03-58-47-770Z-838ea4ae-8dee-4c17-91dc-eff403d0069f.json；保存时 HEAD：7c6076e23fd21d69a87bd7f138849ed90630ecad

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17

下一步：已集成7c6076e原生安全修复并完成ReactNavigation/Uniwind/Menu/Reanimated/Gesture/Keyboard探针迁移。T3当前main复核285558eb，13项核心不变，矩阵和增量证据已保存。本地最近完整回归123/123，另新增的隐私保护定向5/5通过；提交后须统一重验并导入新原始报告，再推送开发分支启动安全macOS bootstrap及独立复审。bootstrap预计exit78只产候选锁，不能算native/UI/IPA验收。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 410；2026-11-21T12:53:12.836Z

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

阻塞：M-1完成仍要求独立 review/security/handoff 证据；负责人仅对本次锁定技术验证授权 waive 独立审查，不得将 waiver 记为审查通过或M-1通过。

检查点：.agent/checkpoints/v2-2026-11-21T12-53-12-836Z-aa30d0e1-8bac-4b80-890c-3c9bab081a64.json；保存时 HEAD：db25183b4ae03b246aec8ccf2c06a8b900a9ed4f

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32；44891582412/1 completed/failure @ a3420973d4dff86b7def48c26eddad0c0501692b；44894722354/1 completed/failure @ b6d52004cd4fb95f9a96c1cc39ed83570d0ed322；44901616612/1 completed/failure @ 9503ae3932fa707e00f509a8bb6d884745283feb

下一步：owner-waiver-locked-native-validation.md记录了范围。本地手工核对CI候选全部7,735链接、21,043文件及哈希后，固定Ruby锁语义校验和canonical npm test通过。候选已以owner-waiver-validation-only方式落入locked模式；提交后重新生成本源码指纹的四份规范Windows报告，随后推送触发一次locked macOS CI验证Podfile再生成哈希、全量清单一致、Simulator UI及unsigned device IPA。此waiver不满足required independent-review/security/handoff，故无论本次构建结果如何都不能登记M-1 completed。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

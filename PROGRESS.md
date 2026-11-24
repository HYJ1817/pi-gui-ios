# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 690；2026-11-24T08:06:47.883Z

阶段：M2；当前：M2-shell；分支：agent/m-1-bootstrap

| 任务 | 状态 | 范围 |
| --- | --- | --- |
| M-1-infrastructure | blocked | 恢复控制层、Windows 原生探针、macOS/Simulator/Maestro/unsigned IPA 验证 |
| M-1-device | pending | 最终一次 SideStore 免费签名安装与真机验收（全部软件完成后） |
| M0-architecture | completed | 冻结架构、协议和安全模型 |
| M1-remote | completed | 桌面远程授权、配对、撤销 |
| M2-shell | in_progress | 原生设计系统与 iPad 导航布局 |
| M3-core | pending | 会话、消息、任务、模型、工具及审批 |
| M4-sync | pending | 实时同步、断线补发、多设备一致性 |
| M5-tailscale | pending | Tailscale 异地与真机安全兼容 |
| M6-distribution | pending | IPA、版本检测、SideStore 源与发布候选 |

阻塞：无已记录阻塞

检查点：.agent/checkpoints/v2-2026-11-24T08-06-47-883Z-182f82cb-d499-4b8f-9e2a-152f8583c662.json；保存时 HEAD：53ec2bf028065fe0279d3b603ed4c77df12b4008

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32；44891582412/1 completed/failure @ a3420973d4dff86b7def48c26eddad0c0501692b；44894722354/1 completed/failure @ b6d52004cd4fb95f9a96c1cc39ed83570d0ed322；44901616612/1 completed/failure @ 9503ae3932fa707e00f509a8bb6d884745283feb；44906133898/1 completed/failure @ 0e62f613cc69d41d6064c26a251e355c2a299efd；44911181329/1 completed/cancelled @ 0b3745e4d71da50bbbf1bcf9b58bccdf450c54ce

下一步：M1-remote completed（desktop 74d252f5，final 审查 pass，四类证据齐）。下一可执行任务：M2-shell（原生设计系统与 iPad 导航布局，依赖 M1-remote 已满足）。M-1-infrastructure 仍 blocked（ADR 0006 owner waiver，NATIVE_DEPENDENCIES_REJECTED，不重试）。M2 开始：调研现有 app 结构与技术栈决策记录，然后实现设计系统/导航并补 unit+ui+independent-review 证据。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

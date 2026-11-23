# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 628；2026-11-23T02:45:34.518Z

阶段：M1；当前：M1-remote；分支：agent/m-1-bootstrap

| 任务 | 状态 | 范围 |
| --- | --- | --- |
| M-1-infrastructure | blocked | 恢复控制层、Windows 原生探针、macOS/Simulator/Maestro/unsigned IPA 验证 |
| M-1-device | pending | 最终一次 SideStore 免费签名安装与真机验收（全部软件完成后） |
| M0-architecture | completed | 冻结架构、协议和安全模型 |
| M1-remote | completed | 桌面远程授权、配对、撤销 |
| M2-shell | pending | 原生设计系统与 iPad 导航布局 |
| M3-core | pending | 会话、消息、任务、模型、工具及审批 |
| M4-sync | pending | 实时同步、断线补发、多设备一致性 |
| M5-tailscale | pending | Tailscale 异地与真机安全兼容 |
| M6-distribution | pending | IPA、版本检测、SideStore 源与发布候选 |

阻塞：无已记录阻塞

检查点：.agent/checkpoints/v2-2026-11-23T02-45-34-518Z-3e3d3bd6-dfee-4496-b81b-464593b31970.json；保存时 HEAD：6e0e4449d13b7abfb434b5290515c6f0e6e01b8a

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32；44891582412/1 completed/failure @ a3420973d4dff86b7def48c26eddad0c0501692b；44894722354/1 completed/failure @ b6d52004cd4fb95f9a96c1cc39ed83570d0ed322；44901616612/1 completed/failure @ 9503ae3932fa707e00f509a8bb6d884745283feb；44906133898/1 completed/failure @ 0e62f613cc69d41d6064c26a251e355c2a299efd；44911181329/1 completed/cancelled @ 0b3745e4d71da50bbbf1bcf9b58bccdf450c54ce

下一步：M1-remote 桌面实现已提交 pi-gui@d244f3e1（remote/v1 全对齐；contract 33+gateway 11 绿）。unit+integration 证据已在 14973c4 导入；M0 依赖 unit+protocol-contract 已在新指纹重章导入。剩：两个 delegate 独立审查（taskId 6b89e4b0=M1-remote 实现审查，a83336bb=M0 合同重审）完成后把 receipt+report 写入 docs/acceptance/review-14973c4-*.json，evidence 导入 M1-remote 与 M0-architecture，validate 全绿后 transition M1-remote->completed。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

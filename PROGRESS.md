# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 1381；2026-11-25T14:57:00.751Z

阶段：M5；当前：M5-tailscale；分支：agent/m-1-bootstrap

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
| M6-distribution | pending | IPA、版本检测、SideStore 源与发布候选 |

阻塞：无已记录阻塞

检查点：.agent/checkpoints/v2-2026-11-25T14-57-00-751Z-f09f2375-f0ce-47c3-bb74-3215bb66ad0d.json；保存时 HEAD：20efb3bc35df42a8dbab725d76f7583fe89ae60f

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32；44891582412/1 completed/failure @ a3420973d4dff86b7def48c26eddad0c0501692b；44894722354/1 completed/failure @ b6d52004cd4fb95f9a96c1cc39ed83570d0ed322；44901616612/1 completed/failure @ 9503ae3932fa707e00f509a8bb6d884745283feb；44906133898/1 completed/failure @ 0e62f613cc69d41d6064c26a251e355c2a299efd；44911181329/1 completed/cancelled @ 0b3745e4d71da50bbbf1bcf9b58bccdf450c54ce；45403679142/1 completed/success @ 7df0cad92379bfad14f65a83a52a38d88e79aa79；45413372694/1 completed/success @ f9043a88a26f6ba268eaa73b0bf1a9bd7b348a4c；45463943882/1 completed/success @ cbaba6871587a6bce9902088c5fc2bbcf67c80fa；45473673853/4 completed/success @ 778b67eaf7f6cd87b6f6602e605ae979c533639d；45531958974/2 completed/success @ 1e85410de3d3ae443e0954e09c426ebe66e11ae5；45558360431/2 completed/success @ 51bc1b63914a7e9023a0276ed9e6e540d17768c5；45596517960/1 completed/success @ ee0778534e9d864de691ccb65fd6aa43cc5da219；45623367812/1 completed/success @ d76c7f2e17e858f15f4a0ed461723c0e9b5da2e5

下一步：M5: round-6 87f0b1f0 + native-security round-2 回包→independent 证据链→CI 45623367812(d76c7f2)/新run 全绿→ci/ipa/ui→validate→transitions

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

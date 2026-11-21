# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 390；2026-11-21T12:22:11.111Z

阶段：M-1；当前：M-1-infrastructure；分支：agent/m-1-bootstrap

| 任务 | 状态 | 范围 |
| --- | --- | --- |
| M-1-infrastructure | blocked | 恢复控制层、Windows 原生探针、macOS/Simulator/Maestro/unsigned IPA 验证 |
| M-1-device | pending | 一次集中 SideStore 免费签名安装与真机验收 |
| M0-architecture | pending | 冻结架构、协议和安全模型 |
| M1-remote | pending | 桌面远程授权、配对、撤销 |
| M2-shell | pending | 原生设计系统与 iPad 导航布局 |
| M3-core | pending | 会话、消息、任务、模型、工具及审批 |
| M4-sync | pending | 实时同步、断线补发、多设备一致性 |
| M5-tailscale | pending | Tailscale 异地与真机安全兼容 |
| M6-distribution | pending | IPA、版本检测、SideStore 源与发布候选 |

阻塞：NATIVE-LOCK：CI 44901616612 已生成实际 macOS 候选（approved=false）；必须独立审查候选 Gemfile.lock、Podfile.lock 和 21,043 项 prebuilt inventory 后才能进入 locked build。审查运行环境缺少 @earendil-works/chord/context，未经复审不得批准。

检查点：.agent/checkpoints/v2-2026-11-21T12-22-11-111Z-32406bd3-911c-4b5c-a31b-67bc52dc28f1.json；保存时 HEAD：9503ae3932fa707e00f509a8bb6d884745283feb

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32；44891582412/1 completed/failure @ a3420973d4dff86b7def48c26eddad0c0501692b；44894722354/1 completed/failure @ b6d52004cd4fb95f9a96c1cc39ed83570d0ed322；44901616612/1 completed/failure @ 9503ae3932fa707e00f509a8bb6d884745283feb

下一步：已在 docs/acceptance/ci-44901616612-bootstrap.md 记录真实 macOS POSIX 336/336、prebuild、Pods install 与 candidate inventory。header-root 阻断在当前真实安装清单中已通过；候选依赖锁/manifest 必须由独立审查确认后方可设 approved=true 或进入 locked build。独立审查器启动因运行环境缺少 @earendil-works/chord/context 失败；不伪造审查证据、不重新试同类代码补丁。保留候选 artifact ID 14705414777（下载在 artifacts/ci-44901616612-lock-candidates/），按项目审查协议恢复后继续；UI/IPA/M-1 均未完成。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

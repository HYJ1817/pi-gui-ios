# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 248；2026-11-21T09:02:13.346Z

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

阻塞：NATIVE-LOCK 尚未生成真实macOS Gemfile/Podfile/预编译候选锁并独立核验；NATIVE-PREBUILT-LINK：CI 44877767639/1 在 86cadda 以 NATIVE_PREBUILT_LINK_REJECTED 失败，无候选或路径级证据。原生候选继续受清单完整性门禁约束。；INV-UNREVIEWED-POSIX-LINK：a8b8360 第三轮安全与功能复验确认普通名称的未批准 POSIX 链接可能被依赖清单静默跳过。证据限于源码与模拟探针，真实 macOS/POSIX 验证待完成。原结果见 docs/acceptance/review-a8b8360-result.json。

检查点：.agent/checkpoints/v2-2026-11-21T09-02-13-346Z-700ab0e4-e571-4bc9-be8f-72499d11739a.json；保存时 HEAD：a8b8360fb0c814a612b07302273a7338e1c112d5

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32

下一步：从 node scripts/agent-resume.mjs --remote 核验 blocked 状态。第三轮失败原结果与来源见 docs/acceptance/review-a8b8360-{result,provenance,disposition}；恢复设计见 docs/acceptance/native-inventory-recovery-proposal.md。源码 a8b8360 的 Windows 224/224、typecheck、bundle、Doctor 20/20 通过，独立任务 b861b32f 已完成但安全/功能失败。三轮上限后已封存，当前没有可启动的依赖任务。实际 POSIX、候选锁、原生构建、UI、IPA、SideStore 均待验。未推送，远端 86cadda，最近 CI 44877767639/1 failed。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

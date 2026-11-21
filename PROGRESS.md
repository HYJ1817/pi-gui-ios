# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 340；2026-11-21T10:30:32.346Z

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

阻塞：NATIVE-LOCK 尚未生成真实macOS Gemfile/Podfile/预编译候选锁并独立核验；NATIVE-PREBUILT-LINK：CI44891582412/1已完成failure，macOS298项真实POSIX canonical及prebuild通过，实际依赖树字节清单仍以LINK_REJECTED停止，无候选/具体路径。先补固定来源差分和无路径固定谓词诊断，不机械重跑。

检查点：.agent/checkpoints/v2-2026-11-21T10-30-32-346Z-bb70be7c-ee87-4c35-9df6-f0e8c9672e70.json；保存时 HEAD：93c52e5a26be8e3d0c493de0f31858ad7ac017c2

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32；44891582412/1 completed/failure @ a3420973d4dff86b7def48c26eddad0c0501692b

下一步：ef2c3b7独立3cf20d98安全/功能/恢复三pass完整原receipt和报告已导入；四规范报告Windows263/263有效。提交审查记录后推送开发分支触发一次macOS验证，不额外dispatch。先npm ci后真实POSIX canonical，再prebuild/生产清单；未知仍拒绝并保留新增固定上下文/谓词诊断。CI44891582412旧failure/无候选不改写。若新候选生成需approved=false/exit78及另行独立审核；否则按实际固定诊断定位，不猜具体路径。native锁/UI/IPA/SideStore门禁保留。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 201；2026-11-21T07:44:49.436Z

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

阻塞：NATIVE-LOCK 尚未生成真实macOS Gemfile/Podfile/预编译候选锁并独立核验；NATIVE-PREBUILT-LINK：CI44877767639完成失败，锁校验后在字节清单NATIVE_PREBUILT_LINK_REJECTED停止，无候选；先研究锁定公开RN/Hermes归档链接结构并本地复现，不重复CI或直接放宽链接策略；INV-HARDLINK：独立44bff1c审查确认原生文件/别名物理目标可硬链接外部inode，须在任何读取前拒绝并回归；INV-PREFIX：独立44bff1c审查确认无framework后缀的上层POSIX链接可能漏扫已知Hermes整组，须预检前缀并真实POSIX回归；INV-ENUM：独立44bff1c审查确认os.walk忽略枚举错误可形成不完整清单，须fail-closed和故障回归

检查点：.agent/checkpoints/v2-2026-11-21T07-44-49-436Z-f5371887-333d-40c8-b40f-350ffb2405b8.json；保存时 HEAD：44bff1c4d11fc52ea776c5fd60436e6a3c93923c

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32

下一步：44bff1c独立审查三Blocker已本地修复并加入读取前hardlink拒绝、六前缀预检及enumeration fail-closed回归；旧fail原结果保留，不推送、不CI。先提交精确新源码、生成4类规范报告，再新任务独立复查三发现与总体边界；macOS POSIX尚未执行，native锁/UI/IPA门禁不动。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

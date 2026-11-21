# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 290；2026-11-21T09:51:50.405Z

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

阻塞：NATIVE-LOCK 尚未生成真实macOS Gemfile/Podfile/预编译候选锁并独立核验；NATIVE-PREBUILT-LINK：13b8584已通过精确源码安全/功能/交接复验，允许一次macOS canonical真实POSIX前置门禁约束的候选bootstrap。实际安装树和候选仍待验证；历史失败CI44877767639及原结果保留。

检查点：.agent/checkpoints/v2-2026-11-21T09-51-50-405Z-0c577fb7-b351-44fb-809a-3e7147ba9f06.json；保存时 HEAD：3ae18567ba551d81f803c75e8259df1de2312578

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32

下一步：13b8584独立191cd5ae三项pass原receipt及三份精确报告已保存并导入；Windows248/248及四规范报告仍有效。提交审查与状态记录后，推送agent/m-1-bootstrap触发一次macOS candidate bootstrap；不额外workflow_dispatch。必须先通过npm ci后/prebuild前canonical真实POSIX测试，任一失败立即停止。候选若生成须approved=false、exit78，不登记整体CI/native/UI/IPA通过；下载公开四候选并独立审核后才可落库locked。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

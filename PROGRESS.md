# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 160；2026-11-21T06:54:08.360Z

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

阻塞：NATIVE-LOCK 尚未生成真实macOS Gemfile/Podfile/预编译候选锁并独立核验

检查点：.agent/checkpoints/v2-2026-11-21T06-54-08-360Z-6ddcd6b7-af6b-4937-a246-e1d1e6b2e923.json；保存时 HEAD：bd20d0169d3e14994fc30788ee5ee7c416c621fa

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f

下一步：bd20d01源码与197项本地回归及三类独立审查证据已核验导入。三轮停止后的锁定源码差分/窄修复/独立复核完成，仅解除调查前置阻塞；保留真实native锁门禁。提交证据/控制投影后git push origin agent/m-1-bootstrap，只触发一次候选bootstrap并登记实际head/run/attempt；不dispatch重复CI，不计exit78为成功，候选仍待独立批准。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

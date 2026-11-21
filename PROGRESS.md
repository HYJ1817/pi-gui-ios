# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 103；2026-11-21T06:10:39.723Z

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

阻塞：R2-1 Windows IPA目录junction/重解析点：已补目录及祖先检查和负向回归，待新提交复核；R2-2 缺失权威恢复：已支持缺文件且不虚构字节备份，待新提交复核；R2-3 Expo单场景manifest兼容：已补严格模板/最终包区分及负向回归，待新提交复核；NATIVE-LOCK 尚未生成真实macOS Gemfile/Podfile/预编译候选锁并独立核验

检查点：.agent/checkpoints/v2-2026-11-21T06-10-39-723Z-12f56b45-fcdd-4cc7-85d3-0cc14b9c7d48.json；保存时 HEAD：0148a3fc0058e6db17a803e1946c2a88a3aab85a

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a

下一步：CI44872870220 Windows165项及prebuild通过，pods失败固定码POD_STRUCTURE，无候选/原生/UI/IPA。仅细分安全诊断不放宽策略，已通过真实Ruby定向；完成canonical后提交一次定位性bootstrap。若同类解析仍失败三轮即停止机械重跑，按具体码记录根因/阻塞再处理。独立复核7da88775仍覆盖0148a3f，不沿用到未提交新源码。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

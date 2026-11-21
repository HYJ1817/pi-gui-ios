# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 60；2026-11-21T04:59:42.310Z

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

检查点：.agent/checkpoints/v2-2026-11-21T04-59-42-310Z-6a5076d6-481e-42f5-8730-7f7aa99de2e9.json；保存时 HEAD：d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd

下一步：第二轮3项Important均已实现修复，完整canonical142/142+版本合同和typecheck通过；官方58.0.35模板SHA512已本地验证，模板宏与最终包严格区分。当前改动待提交并推送真实bootstrap重跑；提交后生成新原始报告并对精确提交独立复核。CI44864063976失败且无候选锁，不能批准锁集或登记native/UI/IPA通过。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

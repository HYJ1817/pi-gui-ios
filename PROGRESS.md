# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 2309；2026-11-26T21:44:13.714Z

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
| M6-distribution | testing | IPA、版本检测、SideStore 源与发布候选 |

阻塞：Inherited Expo dependency validation unresolved: Doctor 19/20 and CI 45874631555/attempt 1 failed; native build, Simulator, UI and new IPA unverified (zero artifacts). Dependency upgrades/check bypass are outside P2.

检查点：.agent/checkpoints/v2-2026-11-26T21-44-13-714Z-5f25d4df-30b1-47f6-a7b6-05725c9e9d6f.json；保存时 HEAD：4bffc13234ffb2d41693c20aa47294268e4a56dd

CI：{"ci":2,"delegates":3,"activeCi":[],"workingDelegates":[],"archives":2}

下一步：STOP: P2 PR #2 merged into agent/m-1-bootstrap at 4bffc13234ffb2d41693c20aa47294268e4a56dd with unchanged reviewed source. Draft/HOLD delivery is historical; merge was explicitly user-authorized. Inherited Doctor/CI version-check failure remains unresolved; native/IPA/device acceptance remains unverified. Await a separately authorized task; no automatic P3, dependency upgrade, check bypass, release, device action or further CI.

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

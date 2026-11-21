# 项目进度（生成文件）

权威：.agent/control.json；schema v2；revision 176；2026-11-21T07:19:54.937Z

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

阻塞：NATIVE-LOCK 尚未生成真实macOS Gemfile/Podfile/预编译候选锁并独立核验；NATIVE-PREBUILT-LINK：CI44877767639完成失败，锁校验后在字节清单NATIVE_PREBUILT_LINK_REJECTED停止，无候选；先研究锁定公开RN/Hermes归档链接结构并本地复现，不重复CI或直接放宽链接策略

检查点：.agent/checkpoints/v2-2026-11-21T07-19-54-937Z-f79803a7-4709-4989-9477-4d44c4a6d549.json；保存时 HEAD：86cadda377fc1fdf3c483478b03215a3d6b96c32

CI：44783585115/1 completed/cancelled @ 58ec99506e00a35121866580ffb28d09d5078b17；44864063976/1 completed/failure @ d46d6a5f84ad569f42a727fe29b0e2ed7b6f4afd；44868846710/1 completed/failure @ 86822196c84ee01baf5b8dec41256abdfd04ddeb；44872870220/1 completed/failure @ 0148a3fc0058e6db17a803e1946c2a88a3aab85a；44874304419/1 completed/failure @ 2b16a1ae71f67d953fd7f1956b163843d9a4385f；44877767639/1 completed/failure @ 86cadda377fc1fdf3c483478b03215a3d6b96c32

下一步：公开固定Hermes Debug/Release归档均实测六条versioned alias；依赖清单仅精确六别名、物理目标无链接、schema2绑定links，最终IPA策略未改。本机canonical202/202和typecheck通过，但Windows1314无POSIXpositive。先仅本地提交不推送，生成4规范报告并对新精确commit独立安全/功能/恢复复核；通过后才一次CI，macOS必须在prebuild前执行canonical真实POSIX正负向。CI44877767639真实failure与无候选门禁保留。

证据必须由 agent-validate 解析实际结果、核对提交/源码摘要与依赖后才有效。

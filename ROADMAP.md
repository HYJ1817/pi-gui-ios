# 开发路线与验收契约 v1

原生客户端按阶段推进，但**真机验收不在中途阻塞软件工作**：先完成所有 M0–M6 软件实现、可行自动化/模拟器验证、IPA 与安全审查；最后由用户一次性执行真机/SideStore 清单。Agent 自主排查一般问题，三次有目标尝试仍不可解则记录 deferred/unverified 和恢复条件，继续其他不依赖工作。安全敏感能力必须 fail-closed；审查未完成可在 fixture/默认关闭模式继续实现，但不能启用或验收。动态任务状态唯一在 .agent/control.json；本表只规定依赖、范围和门槛。负责人授予的 M0–M6 软件推进和最终设备清单例外见 `docs/acceptance/owner-waiver-m0-design-progression.md` 与 ADR 0006；例外不构成任何阶段通过证据。


| 阶段 | 依赖 | 范围 | 测试与完成门槛 | 停止条件 |
| --- | --- | --- | --- | --- |
| M-1 | 无 | 持久控制层；Windows Expo/TS；原生技术探针；macOS/Xcode/Simulator；Maestro；artifact 分析/失败修复闭环；unsigned device IPA；独立恢复交接 | 控制层故障测试、独立交接、Windows bundling、iPhone/iPad 原生玻璃/导航/菜单点击输入滑动断言、真实图审、CI 重跑、arm64 IPA 结构/Framework/权限检查均有证据。真机安装不在本阶段执行，集中到最终设备清单 | 账户授权/付费、重大安全风险；一般原生构建阻塞可记录并先推进不依赖它的工作，但不得把未验证构建称作通过 |
| M0 | M-1（owner-waived design and contract work may proceed） | 读双方源码；冻结整体架构/API v1/安全模型/模块边界 | ADR、双仓库基线、威胁模型、兼容/事件/审批契约、synthetic 合同测试、独立功能与安全审查。M-1 未通过不阻断隔离的设计/默认关闭实现，但不能据此 accepted；安全 review 前不启用 | 无法保留已有审批或远程权限隔离；远程功能未安全评审前必须禁用 |

| M1 | M0 | 桌面隔离远程服务、显式开关、一次性配对、设备身份/权限/撤销 | fixture 集成、TLS、重放/并发配对/速率/撤销实时断连/所有权负向测试；桌面 canonical 测试 | 不可消除越权/秘密泄漏 |
| M2 | M1 | 优先对齐 T3 的 React Navigation 原生导航、Liquid Glass token/组件、iPad 响应式、系统主题/无障碍 | 模拟器 iPhone/iPad、旋转、大字、VoiceOver 标识、低透明/动效真图 | 核心原生能力不可用 |
| M3 | M2 | 项目/会话、消息/任务控制、模型选择、工具展示和审批 | synthetic 桌面/移动闭环；拒绝/超时/旧审批；有界列表/长消息；UI 验收 | 功能需绕开桌面已有约束 |
| M4 | M3 | 流式通信、快照+游标增量、断线重连/补发、多设备 revision/幂等 | 乱序/重复/间隙/重启/撤销、故障注入/慢客户端/双设备一致性 | 状态不能可靠恢复 |
| M5 | M4 | Tailscale 异地 HTTPS、真机性能/权限/兼容、安全审计 | 免费方案实际验证；模拟器与合成网络故障测试；真机网络验收纳入最后一次设备清单；独立安全审查 | 需要付费/账户/设备操作 |
| M6 | M5 | unsigned IPA、版本检测、Release 草案/SideStore source、升级兼容 | IPA/隐私/权限/来源校验；升级/降级/撤销兼容的自动化与结构验证；SideStore 真机刷新/覆盖升级留到最终设备清单；正式发布待明确授权 | 发布、main 合并均需用户批准 |
| 最终设备清单（M-1-device） | M6 软件实现、自动化/模拟器验证、IPA 与安全审查完成 | 用户一次性执行 SideStore 安装、启动、刷新、覆盖升级及可用 iPhone/iPad 网络验收 | 真实设备结果由用户届时确认；执行前保持 pending/unverified，IPA/Simulator 不能代替 | 仅在全部软件工作后安排一次；Agent 不得代操作 |

## 最终一次设备验收（owner decision）

硬件用户验收不在软件阶段穿插执行。M-1-device 真机/SideStore 清单移至 M6 软件、自动化/Simulator/IPA 与独立安全审查完成之后，用户一次性执行安装、启动、刷新、覆盖升级及可用 iPhone/iPad 网络验收。此前设备证据保持 pending/unverified；Agent 不请求、不代操作，也不以 Simulator/IPA 代替。普通可延期环境故障按 ADR 0006 记录 deferred 后继续不依赖工作，安全边界保持 fail-closed。

## 当前已授权的非阻断例外

2026-11-21，负责人要求不要因 M-1 锁定构建受阻而停止所有进展，授权 **M0 设计工作**并行推进；后续又要求真机验收只在全部软件工作完成后由用户集中执行，并要求普通问题自行解决或记录跳过后继续。之后进一步确认真机验收只在全部开发完成时由用户亲自集中操作一次。记录见 `docs/acceptance/owner-waiver-m0-design-progression.md` 与 `docs/decisions/0006-final-device-acceptance-and-deferrals.md`。不得把失败 M-1 / 未执行真机标为通过；M-1-device 改为 M6 软件工作后的最终清单。可延期普通环境/工具故障，不阻塞无依赖工作。安全敏感远程入口保持默认关闭/隔离，在独立安全审查完成前不得启用或宣称验收通过。ROADMAP 正式功能依赖和未验证风险仍须如实保留。


不缩减最终范围。技术栈以 T3 当前 main 为主要参考，逐项见 docs/decisions/technology-stack.md；Expo Router 不再是硬约束，优先 React Navigation。云账户/公网 relay 不移植；定制 fork 先查明依赖/许可证/调用前提并实际验证，不能机械搬入或无理由换掉成熟方案。M-1 必须完成 package/lock/native/导航/状态/消息/动画/玻璃/测试的完整分析与必要技术探针。桌面与移动各自独立 PR；协议先兼容再升级，合并顺序和发布依赖写入每次集成验收。

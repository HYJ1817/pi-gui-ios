# Pi GUI Mobile · Agent 约定

## 范围与授权

仓库 `HYJ1817/pi-gui-ios`，应用 `pi-gui-mobile`，React Native + Expo + TypeScript。当前为 synthetic runtime，真实配对/会话/消息/live sync 仍属 P3，见 [架构](docs/architecture.md)。以当前任务授权为准，不自行启动 P3 或扩展到桌面。

可按授权研究、安装依赖、开发分支提交/推送/PR、运行/读取 CI 和独立审查。未授权 main 合并、正式发布/标签、强推、修改已有发布、付费、账户登录或代操作真机。不改参考仓库与 Pi 本体；桌面修改须有任务授权、先读其规范并用独立 worktree，不碰 `C:/pi-GUI` dirty 工作区。

Windows 开发、标准 macOS Runner 原生验证、SideStore 自签；无付费服务/Apple 会员/自建公网中继依赖。优先对齐已读 T3 移动源码，差异与版本/许可证/兼容依据只记 [选型记录](docs/decisions/technology-stack.md)，不机械搬依赖/fork。先配好 [工具链](README.md#开发入口)：Node 24.22.1、Ruby 3.3.8、Bundler 2.6.9 及便携 Ruby GEM 环境。

## 恢复与状态

1. 读本文件、[REVIEW.md](REVIEW.md)，执行 `node scripts/agent-resume.mjs --remote`；检查实际 cwd/分支/HEAD、dirty diff、远端与运行中/失败 CI，不 reset/clean 或覆盖他人修改。
2. `.agent/control.json` 是**唯一任务/运行状态权威**；`.agent/state.json`、`.agent/tasks.json`、`PROGRESS.md`、`.agent/HANDOFF.md` 是可重建投影，不手改。按恢复输出读相关 ADR/验收记录；[ROADMAP.md](ROADMAP.md) 只规定范围/依赖/门槛。
3. 优先处理当前已授权任务；重核证据的 commit、摘要与作用域，失效不能沿用聊天中的 PASS。独立 worktree 与权威分支不符时向协调者报告，不为消除诊断改权威或重置源码。

恢复默认只读。投影损坏用 `node scripts/agent-resume.mjs --repair-projections`；权威损坏先 `node scripts/agent-resume.mjs --list-checkpoints`，核对候选外层/内层摘要、分支与 dirty diff，再用 `node scripts/agent-restore.mjs VERIFIED_V2_PATH --apply`。保留原权威备份与 dirty 源码，不切换/重置分支。

## 工作与交接

实现 → 定向检查/实际运行/必要图审 → 独立上下文审查 → 修复回归 → 证据门禁。转换用 `node scripts/agent-task.mjs transition TASK_ID STATUS`，完成前用 `node scripts/agent-validate.mjs --task TASK_ID` 递归复验依赖。证据失效的 accepted/completed 回 testing，依赖未通过不启动依赖业务，不手改状态造通过。

在**有意义的任务转换、重要提交、阻塞/恢复决定和会话交接**保存状态/`node scripts/agent-checkpoint.mjs --note "说明"`，脚本已保存就不重复；无需每次原子编辑/证据导入另做快照。交接包含 HEAD/dirty 文件、CI/任务标识、已执行/未执行检查、阻塞与下一条命令。协调者维护权威，限域子任务不越界，不另建进度账本或复制历史运行清单。

同类普通环境/工具/Runner 问题最多三次有目标尝试；仍失败保留原因、影响、未验证范围/恢复条件，记 deferred/unverified，继续不依赖工作。安全/隐私、身份/权限、撤销/审批、数据完整性不降低断言；缺独立审查只能继续默认关闭的隔离准备。

验证/证据/CI 统一见 [测试](docs/testing.md)，审查见 [REVIEW.md](REVIEW.md)，远程/秘密边界见 [安全](docs/security.md)。UI 要看真实 iOS 渲染；native glass 不支持或 Reduce Transparency 时明确实色回退，不用静态断言代替图审。

所有软件、可行自动化/Simulator/IPA 验证及独立安全审查后，仅由用户集中一次执行 [SideStore/真机清单](docs/acceptance/M-1-device-checklist.md)。中途不请求/代操作真机，不因设备阻塞软件进度；此前 pending/unverified，Simulator/IPA 不能代替安装、刷新、覆盖升级/网络结果，也不授予合并或发布权限。

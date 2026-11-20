# Pi GUI Mobile · Agent 执行约定

## 产品与授权

原生 iPhone/iPad 客户端，React Native + Expo + TypeScript + Expo Router。逻辑应用名 `pi-gui-mobile`；按用户指定在 `HYJ1817/pi-gui-ios` 仓库开发，不擅自创建或重命名远端仓库。Windows 开发，GitHub 标准 macOS Runner 编译/模拟器验证，SideStore 自签，无付费服务、无 Apple 会员依赖、无自建公网中继。参考 T3 源码，不改参考仓库和 Pi Coding Agent 本体。

用户已授权：研究、安装项目依赖、开发分支提交/推送/开发 PR、触发和读取 CI、下载公开安全的测试产物、独立 Agent 审查、阶段通过后自主继续。**未授权**：合并 main、正式发布/推送发布标签、强推、破坏其他分支、修改已有发布、付费、账户登录授权、代操作真机。首次真机验证合并成一次清单。

## 每次新会话首先执行

1. 读本文件与 `REVIEW.md`，运行 `node scripts/agent-resume.mjs --remote`。
2. 读恢复输出指定的文件，至少 `ROADMAP.md`、生成的 `PROGRESS.md`、`.agent/HANDOFF.md`、当前任务相关 ADR 与最新验收记录。
3. 检查实际分支、dirty diff、最近提交、远端、运行中/失败 CI；不得 reset、clean 或覆盖他人修改。恢复脚本不修复 Git 工作区。
4. 以 `.agent/control.json` 为**唯一任务/运行状态权威**；核验 schema、摘要、检查点及测试证据。`.agent/state.json`、`tasks.json`、`PROGRESS.md`、`HANDOFF.md` 是可重建投影。ROADMAP 只规定范围/依赖/门槛，不手写重复动态状态。
5. 优先恢复当前未完成任务；证据缺失/摘要不符则回到 testing，不采信上次聊天中的“通过”。仅输入“继续开发”亦执行以上流程。

## 自主执行循环

选依赖已完成的任务 → 保存开始检查点 → 调研/设计 → 实现 → 定向测试与实际运行 → 自动化/视觉验收 → 独立上下文审查 → 修复/回归 → 证据门禁 → accepted/completed → 检查点 → 下一任务。阶段未通过不得启动依赖该阶段的正式业务。非阻断文档/调查可并行推进。

任务状态：pending → in_progress → testing → reviewing → accepted → completed；可转 blocked；blocked 恢复 in_progress/testing；证据失效的 accepted/completed 必须回到 testing。`scripts/agent-task.mjs` 管理转换；`agent-validate.mjs` 检查完成门禁，不能凭文字直接改 completed。

任务开始、原子修改、提交、CI 启停、测试/审查、阻塞、ADR、阶段验收后，运行 `node scripts/agent-checkpoint.mjs --note <说明>`。控制层以原子 rename 更新；摘要不匹配停止并保留损坏文件，不自动丢弃状态。投影撕裂可由权威状态重建；权威损坏从最近有效检查点人工核对恢复。

## 安全与仓库隔离

- 远程默认关闭，只能本机用户启用。独立远程鉴权边界，绝不把现有本地 HTTP/WebSocket 整体改为 0.0.0.0 或代理公开。
- 一次性短效配对、每设备身份/凭据/撤销、TLS、请求重放防护、接口/字段白名单、项目/会话归属与权限校验；撤销立即拒绝新请求并断开连接。
- 不传模型 API Key、OAuth Token、PI_GUI_TOKEN、原始错误/配置/环境变量；不得绕过桌面审批。只用临时 synthetic fixture 测试，不写用户真实会话/设置。
- 桌面仓库改动前读它的 AGENTS/REVIEW 与相关规范，独立 worktree/分支，记录 commit、协议和依赖；不碰 `C:/pi-GUI` 现有 dirty 工作区。
- 公开仓库/CI 产物只允许合成测试数据；秘密、私钥、配对码、设备标识、真实日志不上传。CI 不需要模型或 Apple 凭据，不扩大 token 权限。
- 跨仓库协议不匹配 fail closed。协议变更需 ADR、双方 commit 和集成证据。

## 验证与停止

测试唯一入口 `npm test`；定向子命令可用。UI 必须审查真实 iOS 渲染图，不能用 DOM/快照断言代替。必须使用真正 native glass；不支持/Reduce Transparency 时明确实色回退。Simulator 成功 ≠ device IPA ≠ SideStore 安装成功。

同类失败三轮仍未解决：停止机械重试，记录根因、日志和阻塞。需要付费、账户授权、真机操作、核心路线变化、重大安全风险、关键技术阻塞、main 合并或正式发布时才请求用户。其余阶段自动推进。CI 控制并发、超时与路径触发；不为微小文档改动重复完整编译。

退出/额度不足前更新检查点和 HANDOFF：精确 dirty 文件、HEAD、CI run/任务标识、已执行/未执行检查、下一条可执行命令。不能只把状态留在对话。

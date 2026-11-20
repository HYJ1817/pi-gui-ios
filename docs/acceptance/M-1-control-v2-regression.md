# 控制层 v2 定向回归（未完成独立复审）

代码提交：a3acf20eef222e556c5b9de392da51005dfc0238；source fingerprint a76a060b3718e6845f528e51400ba880b0f19ae21a161878ed66abc06d8ebd4d。该提交暂只保存在本地开发分支；需先集成隔离 worktree 的安全 CI/IPA 修复，才统一推送，避免触发旧上传边界。

实际运行：

- `node scripts/verify.mjs unit` 调用唯一 canonical `npm test`：26 tests / 26 pass / 0 fail / 0 skip。
- `node scripts/verify.mjs typecheck`：exit 0。
- `node scripts/verify.mjs bundle`：1132 modules、1.6 MB iOS bundle、exit 0。
- `node scripts/verify.mjs doctor`：20/20 checks pass、exit 0。
- 实际用 agent-task evidence 导入这四份 schema v2 原始报告，未覆盖其结果或源身份；门禁认可四份本地证据，同时继续拒绝缺失的 CI/UI/IPA/独立审查/真机证据与已知 blockers。

原有 11 类恢复用例保留并扩展：失败报告/非0退出、证据类型替换、无真实 commit、源码/报告/日志漂移、递归依赖失效、已知阻断、专用路径、Windows junction、严格 CI 导入、坏状态写前拒绝、检查点持久失败不推进 revision、投影修复遇锁无写入、损坏权威从明确快照恢复且保留 dirty 文件、失败独立审查原始结果不能被盖为通过、手工设备确认不能被普通命令报告代替。

源代码静态与本地测试层面已实现 S1/S5/S6/S7 修复；这不是独立审查通过结论，blockers 保留为“修复与回归已实现，待独立复审”。S2/S3/S4 仍由隔离 worktree 处理。当前 M-1 保持 in_progress，未进入 M0。

已知非阻断工具提示：Node24 对闭合固定命令表中 Windows npm.cmd 的 shell 启动发出 DEP0190 弃用提示；没有把任意用户字符串交给 shell。此项后续可替换为直接执行 npm-cli.js，不影响已执行命令的真实 exitCode；不据此放宽任何完成门禁。

回滚：保留 v1 原状态备份和历史提交；如需撤回当前控制实现，在开发分支 revert a3acf20 并核对 schema 迁移方向，不用旧运行时直接读取 v2 权威。损坏状态恢复用已验证 v2 checkpoint，脚本保留原文私有备份，不 reset 用户源码。不得强推或合并 main。

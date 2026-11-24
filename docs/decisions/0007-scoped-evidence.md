# ADR 0007 · 作用域化证据（scoped evidence）与检查点保留策略

日期：2026-11-24。状态：已实施。解决“修改 CI/诊断脚本 → 全部阶段证据统一失效 → 重复复审”的低效循环。

## 背景

`sourceFingerprint` 原本是**单一全局指纹**：仓库内除 `.agent/`（除 schemas）、`docs/acceptance/`、`PROGRESS.md` 外的所有文件哈希为一个值，`validateReport` 要求报告指纹等于当前全局指纹且等于其 commit 的全局指纹。结果：改 `scripts/ci/verify-ipa.py`、workflow、测试文件都会让 M0/M1/M2 的 unit/ui/independent-review/protocol-contract 证据整体失效，已完成的独立复审被迫重做——本轮 CI 修复期间该循环实际发生了多轮。

## 决策

证据 kind 按“它实际依赖什么”绑定到命名路径集合（`SCOPE_SETS` + `KIND_SCOPES`，定义在 `scripts/lib/control.mjs`）：

- `app`（src/、App.tsx、metro/babel/app.json 等）、`tests`、`native-build`（scripts/ci/、native/、.github/、.maestro/、Gemfile*）、`control`（scripts/lib/、agent 脚本、verify.mjs、.agent/schemas/）、`protocol`（远程契约源/测试/文档）、`meta`（docs/、AGENTS/REVIEW/ROADMAP 等治理文档）、`shared`（package*.json、tsconfig、.gitignore/.gitattributes）。
- `shared` 与**任何集合都未覆盖的文件**属于每个 kind 的作用域——新出现的未知面 fail-closed，由 `coverageCheck()` 保证覆盖测试存在。
- kind 映射：`unit` = app+tests+control+native-build+protocol（npm test 实际执行这些）；`typecheck/bundle/doctor` = app；`ci` = app+tests+native-build+control+protocol；`ui/ipa/device-*` = app+native-build(+protocol)；`integration` = protocol+control；`protocol-contract` = protocol；`independent-review` = `union`（任务自身非独立、非设备 evidence 的并集）；`independent-security` = union+native-build；`independent-handoff` = all（全局限定词，未来新增集合自动纳入）。任务可用 `evidenceScopes[kind]` 显式声明更窄的复审范围，如 M0/M1 的复审绑定 `protocol`、M2 绑定 `app`。

## 验证规则（`validateReport`）

- 报告/记录新增可选字段 `scopes` + `scopeFingerprint`；有则必须等于该 kind 声明的作用域，且等于 `committedFingerprint(commit, scopes)` 与当前 `sourceFingerprint(scopes)`；`sourceFingerprint` 仍必须等于 `committedFingerprint(commit)`（报告确实在那棵树上产出）。
- 无 scope 字段的**旧报告**：`sourceFingerprint == committedFingerprint(commit)`（报告产出时工作树=提交树）且 `committedFingerprint(commit, scopes) == sourceFingerprint(scopes)`。语义：旧报告在其作用域没有变化时保持有效；作用域内文件变了才失效——旧证据不用重新委托即可迁移生效。
- `independent-*` 收据中的 `result.sourceFingerprint` 改为与 `report.sourceFingerprint` 恒等（审的就是报告绑定的那个 commit），去掉对“当前”全局指纹的依赖。
- `gate`/`inspectRecovery` 共享 ctx，按 scope key 记忆指纹计算，消除多次全树哈希。

## 检查点保留

`.agent/checkpoints/` 累积 433 个文件（427 个被 git 跟踪，~20MB）。`createCheckpoint` 末尾现在自动 `pruneCheckpoints`：保留最新 50 个 v2 快照 + 权威 `control.data` 中仍被引用的文件名（当前引用、证据溯源），仅删除 `v2-*.json` 文件名、只删普通文件（拒绝符号链接），其余名称不动。文件仍在 git 历史中，工作区与仓库停止无限增长（保留 git 跟踪符合 ADR-0004“v2 快照入 Git”）。

## 拒绝的替代方案

- 无限白名单/放松 `sourceFingerprint` 断言：违反 fail-closed。
- 每文件签名证据清单：复杂度远超收益。
- `meta` 移出复审默认范围：采纳——治理文档/ADR 是事后记录，复审认证的是其领域内的产物。
- `.maestro/`、Maestro 安装步骤：实际弃用（simulator.sh 已是纯 simctl），CI 中移除死步骤。

## 迁移

- schema：`evidenceRecord`/`evidence.schema.json` 增加可选 `scopes`、`scopeFingerprint`；`task` 增加可选 `evidenceScopes`。`schemaVersion` 不变，旧文件可读。
- `verify.mjs` 为新报告写 `scopes`+`scopeFingerprint`；`agent-task.mjs evidence` 原样搬运进记录。
- 已存任务按复审实际覆盖写入 `evidenceScopes`；这是声明复审边界，不是修改状态或补证据。

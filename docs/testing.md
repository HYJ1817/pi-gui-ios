# 测试与证据

先满足 [README 工具链前置](../README.md#开发入口)，包括 Windows 的 Bash、Ruby 3.3.8 和 Bundler 2.6.9。缺少安全测试运行时是失败，不能用 skip/忽略标志制造通过。

```bash
npm test
npm run typecheck
npm run export:ios
npx expo install --check
npx expo-doctor
```

`npm test` 是 canonical 入口（Node suites + 精确技术栈合同）；定向如 `node --test tests/m4-fault-injection.test.mjs`。类型、Metro bundle、依赖检查均不等于 Xcode/设备通过。Expo 的三个既有版本例外受精确合同约束，不能扩成通用忽略名单。

## 五 job CI

[Native infrastructure](../.github/workflows/native-infrastructure.yml) 在匹配路径的 `agent/**` push、PR 或手动 dispatch 运行。同一 `agent/**` 分支开 PR 可能双跑；维护分支可用 `refactor/**` 走 PR/手动入口。普通入口文档修改不触发。

| Job | 实际职责 |
| --- | --- |
| `checks` | Windows：安装锁定 JS 依赖、canonical tests、typecheck、Expo install check、iOS bundle |
| `native-build` | macOS-26：校验模板与依赖锁，构建独立 Release Simulator app 和 unsigned arm64 device app，生成带 manifest 的 app handoff |
| `sim-acceptance` | macOS-26：验证 handoff，使用 simctl 在 iPhone/iPad 安装、启动、深链导航并截取真实渲染图 |
| `ipa` | macOS-26：验证 handoff，私有 staging 打包/检查最终 IPA，生成分发草案 |
| `evidence` | Ubuntu：合并已净化的白名单报告/PNG，产出 `m-1-ios-<run_id>`；它的成功不代表上游全部成功 |

手动输入 `stage=all|build|sim|ipa`；仅 `sim`/`ipa` 配合 `app_run_id` 跳过构建。复用时显式传 `app_run_id`/`app_sha`：先验证 manifest 的 run、合法 attempt、`native-build` job、SHA 和 tar 摘要再解包，产物 `head_sha` 还必须等于本次 `GITHUB_SHA`。不允许跨提交复用或把部分 stage 成功当整线通过。artifacts 保留 7 天，过期重建；`checks` 仍运行。

```bash
gh workflow run native-infrastructure.yml --ref "$BRANCH" -f stage=all
gh workflow run native-infrastructure.yml --ref "$BRANCH" -f stage=sim -f app_run_id="$RUN_ID" -f app_sha="$SHA"
```

`scripts/ci/simulator.sh` 使用 **simctl + 合成深链参数 + 截图**，不运行 Maestro，不证明真实触控/键入/手势端到端通过。人工审查 iPhone/iPad、深浅色、大字、Reduce Transparency 真图，保留交互缺口。另有 [M5 native preparation](../.github/workflows/m5-native-probe.yml) 编译运行原生传输核心、按需生成 Pod 锁候选；它不属于主流水线五 job，也不证明 App 已接上桌面。

## 证据持久化

源码已提交且确需验收时，令 `TASK_ID` 为权威当前任务，使用现有入口：

```bash
node scripts/verify.mjs unit "$TASK_ID"
# 检查报告引用的确切日志；PUBLIC_LOG 只指向已审查的内容寻址合成日志
# 报告文件名：当前任务为 local-unit.json，其他任务附加 -<TASK_ID>
git add -- "$PUBLIC_LOG"
node scripts/agent-task.mjs evidence "$TASK_ID" "$REPORT"
node scripts/agent-validate.mjs --task "$TASK_ID"
```

其他本地 kind 有 `typecheck`、`bundle`、`doctor`。`integration` 访问指定桌面工作区，仅在授权范围内运行。

报告按 [evidence schema](../.agent/schemas/evidence.schema.json) 保存命令/时间/exit、commit、源码/作用域指纹和日志摘要。导入报告存 `.agent/evidence/<sha256>.json`；可公开日志仅用 `docs/acceptance/logs/<sha256>.log`，保留原始字节、不做换行转换。verify 对未通过合成输出检查的原文存入忽略目录 `.agent/private-logs/`；命令成功不代表这些材料可导入或公开。先核对 `REPORT` 和 `PUBLIC_LOG` 的实际路径、内容与摘要，再暂存确切日志；导入/门禁还核对日志、receipt、verification、截图等嵌套产物的 Git 索引字节。不得强加敏感/未验证日志、重算历史摘要或把不可恢复历史记为通过。

**内容寻址不等于脱敏**，输出筛查保守且不能替代内容审查。`node scripts/agent-compact.mjs` 默认只读，审计现有报告/嵌套依赖并预览整理；`--apply` 将不参与门禁的历史存入同一内容寻址目录，由权威摘要引用，保留最新诊断与仍有效的门禁候选。归档不恢复成有效证据；投影仅保留摘要。历史原日志只可用显式 `--recover-logs-from` 从只读来源找回相同字节；缺失或敏感材料保持缺口，不改报告。

CI 的 `collect-evidence.py` / `merge-evidence.py` 仅接纳闭合白名单，原始构建日志/模拟器清单留在 runner 私有临时目录，不整目录上传。

不覆盖被引用字节、不改历史失败/指纹、不用 `--passed`；敏感原始材料留私有位置，公开派生报告另用身份/摘要并说明缺口。门禁复验依赖/当前作用域，CI 绑定精确 workflow/run/attempt/head/结果，独立审查读取原收据；旧 PASS 不自动成为新树或 P3 PASS。恢复/路径/安全回归按变更范围运行，审查见 [REVIEW.md](../REVIEW.md)。

Simulator 图审、[unsigned IPA 检查](releasing.md) 和 [最终用户设备清单](acceptance/M-1-device-checklist.md) 分别记录；未运行项写 pending/unverified，不用一种证据替代另一种。

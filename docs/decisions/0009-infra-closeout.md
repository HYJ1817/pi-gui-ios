# ADR 0009 · M-1 基础设施收尾：evidenceScopes 下限、Maestro 残留清理与 Manifest.lock 语义校验

日期：2026-11-25。状态：已实施。解除 ADR-0006 下 M-1-infrastructure 的 blocked（维持期内由 CI 五 job 流水线与 simctl UI 证据链重建了 Simulator/IPA 验收能力）。

## 背景

M-1-infrastructure 按 ADR-0006 保持 blocked：locked 模式当年无一次成功 Simulator/UI/IPA 运行。随后 ADR-0008 的五 job 流水线与纯 simctl UI 证据链在 run 45413372694 端到端全绿（含 unsigned IPA 上传），blocked 的原始条件已消失；剩余为三个记录的 nit 与证据补齐。

## 决策

### 1. evidenceScopes 收窄下限（`checkScopeFloor`，validateControl 内 fail-closed）

ADR-0007 允许 `evidenceScopes` 为 independent-* 复审声明更窄作用域（M0/M1 绑 `protocol`、M2 绑 `app`），但此前没有任何对“非法收窄”的检测——声明 `['meta']` 也会照单全收，复审证据可以绑定一个几乎不含受审产物的作用域而不被任何门禁发现。

新增下限，在控制层 schema 校验阶段即拒绝：

- `evidenceScopes` 只能收窄 `independent-*` 证据种类；非独立种类的 `KIND_SCOPES` 是事实绑定，不允许重声明；
- 声明的作用域集合必须是该 kind 默认解析边界的子集（不得借声明扩大复审范围或引入未知集合）；
- 默认边界覆盖任一产品集合（`app`/`native-build`/`protocol`）时，声明必须至少保留一个产品集合——不允许把复审绑定到只有 `meta`/`control`/`tests` 的表面；
- `independent-handoff`（`['all']`）不允许任何收窄。

收窄在边界内的复审域选择（例如 protocol 阶段复审绑 `protocol`、安全复审按复审人实际覆盖绑 `['app']` 或 `['native-build']`）保留 ADR-0007 语义，由复审 receipt 的 reviewedCommit 与审查职责约束，不做机械全集强制；floor 阻断的是“复审证据与受审源码面脱节”的配置错误。

现有 M0/M1/M2 的收窄声明全部满足下限，已存证据不失效。回归测试覆盖全部拒绝路径。

### 2. Maestro 残留清理

ADR-0008 已删除 `.maestro/` 与安装步骤，但白名单与管线仍保留 Maestro 时代路径：

- 两处 artifact 白名单中的 `reports/{iphone,ipad}-{native,dark,accessibility}.xml` 与 `*-debug.json` 共 24 条：simulator.sh 转 simctl 后无任何生产者，属死路径，删除；
- `collect-evidence.py` 的 JUnit 重建与 `maestro-debug` 透传块删除（无生产者=死代码）；`merge-evidence.py` 的 REPORTS 白名单收敛为 steps/diagnostics/environment；
- `safe-diagnostics.py` 的 `MAESTRO_*` 诊断类别与 `MAESTRO_DEBUG_*`/`MAESTRO_STEP_*`/`MAESTRO_CONSOLE_*` 词表条目删除；
- `SCOPE_SETS['native-build']` 中 `.maestro/` 前缀删除；
- 测试改为断言残留输入被忽略且不再出现在白名单中。simctl 验收机制（截图白名单 + steps/diagnostics/environment）完全保留。

### 3. Pods Manifest.lock stamping 的真实依赖一致性验证

`install-pods.sh` 在 locked 模式下把评审过的 `Podfile.lock` 复制为 `Pods/Manifest.lock`，以规避 `pod install --deployment` 留下的序列化格式漂移导致 Xcode 'Check Pods Manifest' 阶段误报。风险：若复制无条件执行，stamp 理论上会掩盖真实解析差异。

最小必要修复：stamp 前先用 `validate-locks.rb manifest-compare` 做语义级一致校验——同 `pod install` 产物共享 PODFILE CHECKSUM，任何版本/来源/CHECKOUT OPTIONS/SPEC CHECKSUMS 不同即 `POD_MANIFEST_DRIFT` 非零退出并阻断流水线，stamp 永不掩盖真实差异。格式纯漂移（字节不同、语义相同）允许 stamp。新增：五种差异/非法输入的回归测试 + 一个 stub 端到端测试（证明 drift 时 copy 不发生）。

## 证据

`npm test` 325 全绿（含 3 个新控制层测试、6 个 manifest-compare 测试、1 个 install-pods 端到端 stamp 测试）；CI 五 job 流水线绿跑 + ui/ipa/ci/独立审查证据见 M-1-infrastructure 验收记录。

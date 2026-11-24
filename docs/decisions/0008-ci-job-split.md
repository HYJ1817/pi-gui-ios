# ADR-0008: CI 分独立 job 的可复跑流水线（2026-11-24）

状态：accepted（实现已提交，首个端到端绿跑验证中）

## 背景

`native-infrastructure.yml` 原本是单 `ios` job 一条龙：环境探测→npm→prebuild→pods→模拟器构建→iPhone→iPad→设备构建→IPA 打包验证，循环约 45–60 分钟。历次失败循环（pods lock-review ×4、prebuild ×1、NATIVE_LAUNCH_EXITED ×1、BUNDLE_PLATFORM(_SUPPORTED_HERMESVM) ×2）每次都要从头到尾重跑，且 IPA 验证首次到达即连环失败。需要：

- 各阶段可独立调试/复跑（build / sim / ipa），不必每次整线 60min；
- IPA 验证能批量报告全部违规而非首个即停；
- 中间产物跨 job 传递必须有来源与完整性校验（不能信任裸 artifact）。

## 决策

### 1. 五 job 流水线

`checks`(windows, npm test/typecheck/install-check/export) → `native-build`(macos: 环境→npm→prebuild→pods→simulator-build→device-build→打包 handoff) → 并行 `sim-acceptance`(iphone+ipad UI 验收) 与 `ipa`(私有 staging 打包+验证+上传 unsigned IPA) → `evidence`(ubuntu: 合并各阶段已消毒证据为规范 `m-1-ios-<run_id>` artifact)。

### 2. workflow_dispatch 分阶段复跑

输入 `stage`(all/build/sim/ipa)、`app_run_id`、`app_sha`。`app_run_id` 非空且 stage∈{sim,ipa} 时跳过 `native-build`，用 `actions: read` 权限 + download-artifact `run-id` 从指定旧 run 取回 app 产物；`verify-handoff.py` 强制校验 manifest 的 `run_id`/`job`/`head_sha`（`app_sha` 必填时逐位比对）并重算 tarball sha256，任一项不符打印固定 code 失败。跨 run 复用强制 `app_sha` —— 不允许凭 run-id 信任任意 commit 的产物。

### 3. Handoff 协议

`native-build` 将 `PiGUIMobile.app`（sim 与 device 各一）打成 tar，经 `write-handoff.py` 生成 `{job,kind,run_id,run_attempt,head_sha,sha256}` manifest 一并上传 `sim-app-<run_id>`/`device-app-<run_id>`（retention 7 天，仅本工作流消费）。下游 job 先验证后解包。

### 4. IPA 验证批量化

`verify-ipa.py` 的 `Invalid` 携带 `codes` 列表；逐 bundle 违规收集进 `violations` 统一报告（去重、上限 64，输出仍只有固定 vocabulary code —— 绝不回显路径/plist 值）。`stage-ipa.py` 逐行打印所有 code。

关键语义修正（保留 fail-closed）：非 app bundle 的平台键从"必须存在且==iPhoneOS"改为"存在则必须含 iPhoneOS"（真实 hermesvm.framework plist 不含 `CFBundleSupportedPlatforms`/`DTPlatformName`/`DTSDKName`，Mach-O platform==2/arm64 仍是决定性设备检查）；`UILaunchScreen` 子键、`UISupportedInterfaceOrientations~iphone` 豁免前缀策略；`UIDeviceFamily` 语义从 `==[1,2]` 放宽为 `{1,2}` 的非空子集；资源 bundle plist 的 `CFBundleExecutable` 按元数据处理；松散 seal 文件（codesignature/codedirectory/coderequirements(-1)）与 `.pkg`/`.mobileprovision` 同列签名材料拒绝。

### 5. 移除 Maestro 死代码

`.maestro/`、`scripts/ci/maestro-debug.py`、run-step 的 `maestro` 步骤删除 —— simulator.sh 一直是纯 simctl，Maestro 安装只占 CI 时间未执行任何断言。

### 6. 证据合并（fail-closed）

`merge-evidence.py` 只接纳 collect-evidence.py 已消毒产物：reports 白名单文件名、PNG magic+白名单清单、steps/diagnostics/environment 结构逐项校验，不重新引入任何原始日志。任一不符整体 `SYNTHETIC_EVIDENCE_REJECTED`。

## 不变的边界

- 无 continue-on-error、无白名单扩容、无凭证；unsigned IPA ≠ SideStore 安装（仍然只留到最终真机清单）。
- Mach-O `platform==2 && arm64`、签名材料检查、路径安全（symlink/junction、tmp 严格前缀）全部保留。
- artifact 白名单集合不变：`ipa-ci.test.mjs`/`ipa-integrity.test.mjs` 仍精确断言上传路径集合；唯一变化是同一白名单在 sim 阶段 artifact 与合并 artifact 各出现一次（test 改为比较去重集合）。

## 备选与拒绝

- 保持单 job + 重跑单个 step（GitHub rerun failed jobs）：无法跨机器取回 device 构建产物，且 IPA 步骤前的 ~45min 前置仍要重跑 —— 拒绝。
- 直接信任 download-artifact 无 manifest：跨 run 误取/错 commit 不可检测 —— 拒绝。
- ipa 在 native-build 内就地打包：与 sim 并行可省 ~2min，但失败一次要重跑全部 —— 拒绝。

## 残余风险

- 分 stage 的 workflow_dispatch 成功不等于整线绿；`ci` 证据仍以整线成功 run 为准。
- Handoff artifact 7 天保留期内 `app_run_id` 过期会下载失败 —— 预期行为，重新跑 build 即可。
- 首次绿跑前的结构性 bug（YAML/expression/job 名）只能在 CI 暴露，已逐条用本地 js-yaml 解析与测试锁定。

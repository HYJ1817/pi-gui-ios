# CI 重构与 IPA 验证修复验收记录（2026-11-24）

## 提交链

| Commit | 内容 |
| --- | --- |
| bce4f9f | verify-ipa 批量违规+非 app 平台键条件化、stage-ipa 对称剥离、CI 五 job 拆分、scoped evidence、checkpoint 裁剪 |
| 07b76f2 | verify.mjs 目标任务参数 |
| e07f2bb | GlassSurface RT 修复（bootstrap 期解析）+ CI paths 过滤修复 |
| a262561 / b9bd917 / 36d1e7e / 7df0cad | 证据/委派记录/17e8255 复审导入 + manifest.head_sha==GITHUB_SHA 反跨提交绑定 + docs/acceptance 触发收窄 |
| f9043a8 | merge-evidence 扁平化布局修复（artifact 下载剥目录） |
| 91cd397 / 0e6adb5 / fd84da5 | 单元证据重生成 + ui 证据 + M2 完成 + nextAction |

## 结果（真实产物）

- **CI run 45413372694 @f9043a8 — 全部 5 job 绿**：checks(4s级) → native-build → sim-acceptance ∥ ipa → evidence。steps.json 9/9 passed，environment observed（macOS 26.7.2, Xcode 26.6, node 24.22.1, bundler 2.6.9）。
- **unsigned-device-ipa-45413372694** artifact：`PiGUIMobile-unsigned.ipa` + `verification.json`(IPA_VERIFIED, arm64, kind unsigned-device-archive) + `SHA256SUMS`。IPA_VERIFIED ≠ SideStore 安装成功（留用户真机清单）。
- **m-1-ios-45413372694** artifact：28 张真实模拟器 PNG（iphone+ipad × light/dark/accessibility + dynamic-type + final）+ 消毒 reports。
- 证据记录：M0 unit+protocol-contract、M1 unit+integration、M2 unit+ui+independent-review（17e8255 复审 grandfathered-valid，7df0cad fix 复审 pass）；CI 记录 45403679142+45413372694 已导入 authority。

## 修复清单（本轮失败循环的根因与修复）

| # | 失败 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | BUNDLE_PLATFORM_SUPPORTED_HERMESVM | verify-ipa 要求非 app bundle 平台键存在且==iPhoneOS，真实 hermesvm.framework plist 不含三键 | 存在则必须含 iPhoneOS；Mach-O platform==2/arm64 仍为决定性设备检查 |
| 2 | 首个违规即停、每轮 45–60min | verify 遇错即抛 | Invalid.codes 批量收集（去重/上限64，仅固定 code） |
| 3 | 单 job 不可分阶段调试 | 一条龙 ios job | checks→native-build→(sim∥ipa)→evidence + workflow_dispatch stage/app_run_id/app_sha |
| 4 | 跨 run 复跑可错认证 | 无产物绑定 | write-handoff/verify-handoff manifest（run_id+job+head_sha+sha256）+ sim/ipa 断言 manifest.head_sha==GITHUB_SHA |
| 5 | Maestro 死代码 | simulator.sh 纯 simctl | 删除 .maestro/、maestro-debug.py、步骤名单 |
| 6 | 审查复审被无关源码改动连坐失效 | 全局指纹 | scoped evidence（SCOPE_SETS/KIND_SCOPES/union + legacy grandfather） |
| 7 | 证据/检查点无限累积 | 无保留上限 | createCheckpoint 内置 prune（保留 50+权威引用） |
| 8 | merge-evidence 取空 | download-artifact 剥 leading dirs | report_dir() 兼容嵌套与扁平两布局 |
| 9 | RT 回退名义证据 | isLiquidGlassAvailable 不含 RT | bootstrap resolveGlassPreferences + listener，Gate enabled=native&&rt===false（复审 pass） |
| 10 | evidenceScopes 任意收窄风险/nit | task 声明无下限校验 | 记录为 nit（需未来 floor 校验；不阻塞，权威文件本身受 integrity 保护） |

## 残余风险

- 每次 CI 证据导入/提交都会推进 HEAD；ui/ipa/ci 证据锚定其 provenance run 的 commit（允许 report.commit 早于 HEAD，scoped fingerprint 校验实际内容不变性）。
- 分 stage dispatch 成功 ≠ 整线绿；ci 证据仅认整线 success。
- `evidenceScopes` floor 校验、Maestro 白名单残留（junit/xml 路径保留在 artifact 白名单但不再产出）、Pods Manifest.lock stamping 三项 nit 已记录未关闭。
- M-1-infrastructure 仍 blocked：缺 unit/typecheck/bundle/doctor/ci/ui/ipa/independent-review/independent-security/independent-handoff 证据，待解除 blocked 后生成。

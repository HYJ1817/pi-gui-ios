# P2 工程整理

本轮仅工程结构、控制层及证据持久化整理；不启动 P3，不修改桌面仓库，不合并默认分支或发布。最终结果集中于本报告。

**最终结论：DRAFT / HOLD merge。** 继承的 Expo 版本校验阻塞尚未解决：Doctor 19/20；实际 CI `45874631555/attempt 1` 在 `02185c9` 失败，产物为零。P2 的工程整理、共享结果绑定与独立审查已交付，不代表软件里程碑验收或原生/IPA/真机通过。最终控制层明确 STOP，由父协调者独立读回、推送并创建 blocked draft PR。下文前半部分保留实施历史，最终测量与门禁见末节。

## 受保护基线

- 实际基线：`e130b692b01fff904f08cdd92eb70bd7deb74d1c`，`agent/m-1-bootstrap`，工作区干净；P1 merge `2e03288`。原开发与 P1 会话均 completed、无 active run 或 pending background tasks。
- 源码完整 CI：`5e38181faf169b96ad48b8638b3c06d3a95d8e98`，https://github.com/HYJ1817/pi-gui-ios/actions/runs/45819300792 ，已核实 success；桌面只读基线 `60d243a24b3ced198bd2e9ccaeb1e66f6129ba7e`。
- 权威 revision 2286、623 条证据、9 个任务。已验收软件的历史结论属于旧源码；P2 源码变动须正常失效，不能把历史 PASS 视为 P2 PASS。M5 device-network 与 M-1-device 设备验收仍待用户。
- 跟踪文件（基线工作区原始字节口径）：813 个，55,632,883 bytes。检查点 50 个，25,102,243 bytes；docs/acceptance 416 个，19,172,386 bytes；.agent/evidence 180 个，192,263 bytes。control.json 462,341 bytes，tasks.json 409,548 bytes。最终同时复核 Git blob 口径，避免换行影响误判。
- 基线权威检查点：`.agent/checkpoints/v2-2026-11-26T17-05-17-988Z-9fd20840-1eec-4a38-a0dc-1a207d9dff4e.json`，SHA256 `b65ea451ae333773f9d2ffe78458f1b30b024dd9c48ee9955d8bbf8b67065ac1`，authorityDigest `9898a0aa8e8ecefa7bf6c5722220318ccbd54d03f1dbe9c8349f9e40b0b47d93`。恢复命令已实际执行且 exit 0，其冗长输出保存在本机会话临时产物，不公开本机路径日志。
- P1 对较早 `4ad785a` 的日志调查不能直接代表最新 5e38181 的日志完整性；本轮重新逐层核查。旧日志、报告与收据不改内容/时间戳/摘要/结论，不公开本机路径或用户数据。

## 分工与门禁

这是多个独立职责的工程整理，实施按组件隔离；同一目录/工作区只有一个写入者。父协调者 worktree `C:/pi-gui-ios-p2`，分支 `refactor/p2-maintainability`，负责集成、范围控制和 PR。子代理实际工作区由 delegate 工具创建并在首次写入前确认。

| Lane | 独占范围 | 决策与交付 | 下一门禁 |
| --- | --- | --- | --- |
| control | scripts/lib/control.mjs、recovery.mjs、schema.mjs、agent-*、verify.mjs、.agent schemas/authority/projections/checkpoints、tests/control.test.mjs、.gitignore、不可变证据存储 | 紧耦合的控制与证据合同统一由一位实施者处理；精简历史/投影/检查点/恢复输出，安全日志准入与不可变路径防护；可审查提交 | 状态/恢复/证据/路径安全定向回归，随后独立安全审查 |
| runtime | src/remote、对应 runtime 测试（不碰 control/schema/protocol checker） | 轻量装配边界，保留 synthetic 能力与业务行为，生产链路继续禁用；不按文件长度拆分 | 远程/业务定向测试、类型检查 |
| infrastructure-audit | 只读 scripts/ci、协议副本、原生模块与依赖、成熟项目参考源码 | 审计明确维护问题、协议 D2 与实际参考 commit；只提有收益的最小修改 | 父协调者划定后续独占实施范围 |
| docs | 实现稳定后单独分派 README 与六份开发规范文档 | 准确能力、简化流程与必要命令，保留历史 ADR | 链接/命令核对 |
| validation/review | 候选树冻结后独立只读 | 一次统一全量测试、类型、bundle、适当 Native CI、全新 clone、功能与安全审查 | 原始结果、精确 commit、未验证项明确 |

不为每次证据导入/代理状态写完整快照，不通过缩小实际依赖范围保住旧证据。连续两次同类修复失败先定位根因。非阻断 nit 不重启全项目验收循环。

### 初始分派（历史，均已终态）

- control delegate：`node:delegated-task:command%3Amcp%3Ae2b2c73f-cc7a-4ea8-aef7-1beb329e3ba1%3Adelegate-task%3A6116e3f9-da00-4535-941c-beda940684bd`。
- runtime delegate：`node:delegated-task:command%3Amcp%3Ae2b2c73f-cc7a-4ea8-aef7-1beb329e3ba1%3Adelegate-task%3A8b12efaf-ebd3-4db9-83cc-7a164b570b63`。
- infrastructure audit delegate：`node:delegated-task:command%3Amcp%3Ae2b2c73f-cc7a-4ea8-aef7-1beb329e3ba1%3Adelegate-task%3Abf87ccb8-660b-4373-9c38-fada8a216760`。
- docs delegate：`node:delegated-task:command%3Amcp%3Ae2b2c73f-cc7a-4ea8-aef7-1beb329e3ba1%3Adelegate-task%3A6a3e1588-ad53-41da-8e10-2542c5921c7f`；仅改指定七份开发文档，控制层新命令待集成时对齐。
- 当时按服务端完成通知读取结果，随后核对组件提交边界、集成、集中验证及独立审查。分支采用 refactor/ 前缀。实际五 Job CI 的失败与最终停止边界在末节记录；此历史分派不是继续执行指令。
- 协调基线提交 `a1a1218`；主工作区仍在 `agent/m-1-bootstrap@e130b69` 且未改动。当前尚无 P2 测试或 CI 通过结论。
- 三条旧 working 记录真实状态已逐一读取：9081f59c failed；b59334b1 completed、审查结论 FAIL；a5cb4a18 completed、审查结论 FAIL。后两次审查使用旧桌面 commit，历史结论不变，不伪装 PASS。随后 round-10 的结果另有独立记录。

### IPA 保护信息

旧源码 IPA 报告引用 `.agent/evidence/61e778bcea080bec599e690ef8d6f7db1ba5686b0dd43e1606dc445ded666e4b.json`。IPA archive SHA256 `71147485f788ffb2b7cf84f92f82b53df4a20017c9f2ddf94b5b539ccb67d737`；verification `docs/acceptance/ipa-verification-45819300792.json` SHA256 `7a2feed7fd6e1fb8a64e19b356b9b7a306a9597f495677b50066a2827180b6fc`。GitHub API 核实 unsigned-device-ipa artifact `15118533232` 未过期，10,795,076 bytes，artifact ZIP digest `cc406b7ca284889fa2dd20709fd91b7e9f60d8da3377b879de652df60131bee6`；此 ZIP digest 与 IPA 文件摘要不是同一对象。

Git blob 精确口径基线：813 文件、55,632,688 bytes；docs/acceptance 416 文件、19,172,191 bytes。与工作区的 195-byte 差别来自检出换行，最终对比使用 blob 口径。

## 组件交付与集成

运行时：子代理提交 `f39bbbd9a06c7f988b7de542d033f33cf832ace9`，隔离分支 `t3/0ba60aa1` 干净；已检查 diff 并 cherry-pick 为协调分支 `fc477e2`。新增 62 行 `runtime.ts` 将 store/event 生命周期从 demo 装配中抽出，显式注入 client/crypto/stream/资源授权；demo 保留合成数据、配对与 singleton，明确 mode=synthetic；useRemote 统一经一个明确的 synthetic 选择入口。sandbox/client 规则职责集中，未因体积拆分。生产连接与原生 transport 未启用。

该组件子代理执行：M3/M4/M5/runtime 定向测试 61 passed、0 failed、0 skipped，typecheck exit 0，diff --check exit 0；7 个新增行为用例覆盖冷构造、依赖隔离、授权、失败、恢复和 cursor/reset。尚未声称集成树全量测试或 Native CI 通过。父协调者集成后 diff --check exit 0，原开发工作区仍干净。

文档：子代理提交 `0f8e377db31dc93d2099e326726d6c53c149e4d7`，仅七份指定文档，已核对 diff 并集成为 `ca1c14d`。AGENTS 由 7,590 减至 4,019 bytes；七份文档合计由 17,933 增至 19,773 bytes，增加部分是修正过去过短/过时的工具链、五 Job、IPA 命令及合成/生产/真机边界说明。40 个相对链接/锚点、6 段 Bash 语法、脚本/npm 命令存在性与 diff 检查通过。控制实现交付后需统一对齐 README/AGENTS 的 resume/recovery/checkpoint 和 testing.md 的报告/日志命令，未提前虚构新 CLI。

基线与基础设施审计：独立 worktree `t3/dc69ce47` 在 `e130b69` 无跟踪文件改动。固定 Ruby 环境后 npm test 417 passed、0 failed、0 skipped（含 stack 合同），typecheck exit 0，独立下载旧 IPA 后 verify-ipa exit 0/IPA_VERIFIED。首次缺 Ruby 的失败原日志单独保留，属于工具环境失败，不改写为代码通过。可复用环境：`RUBY=C:/tools/ruby338/rubyinstaller-3.3.8-1-x64/bin/ruby.exe`，bin 加 PATH，GEM_HOME/GEM_PATH 为其 `lib/ruby/gems/3.3.0`。旧 IPA 独立下载所得文件 10,937,783 bytes、SHA 与上述记录相同。原始审计日志/公开参考快照在本机临时目录 `pi-p2-audit-tVzcs9`，未把本机路径/失败原始输出上传。

审计确认 Python 依赖/IPA 校验、Swift 五文件边界和五 Job 工作流职责清晰，无证据支持重构，保留不动。D2 存在两处真实差异：移动参考校验器缺少 device.serviceId 绑定拒绝，以及普通事件 reserved conversationId=stream-reset 拒绝；固定桌面已拒绝这两个合成向量。第二处在完整移动 acceptEventFrame 链已有防护；本调查不证明生产绕过。

协议补齐 delegate `node:delegated-task:command%3Amcp%3Ae2b2c73f-cc7a-4ea8-aef7-1beb329e3ba1%3Adelegate-task%3Ac97c2c62-e05a-4aab-be15-827adb585129` 独占协议参考校验器、remote-contract 测试、desktop-remote-verify、一个小型共用 normalization helper/固定 pin 及 D2 段落；不改桌面和协议能力。使用已安装 TypeScript parser/printer 处理格式/注释差异，仅显式映射已知 CONTRACT_URL 字面量，离线 pin 加实际集成副本比对，禁止手写 tokenizer 或通用去空白。

实际参考：T3 `4fab242f6e620f51af936f16c250b6c43202b269`（审计时 main，2026-11-26T17:32:23Z），已读 mobile package/App/Stack、connection/runtime、test-fixtures、native-controls 注册/podspec、mobile-behavior 假后端与用例、mobile-development 文档及 fingerprint workflow；审计中 main 前进后重取 16 文件并确认字节相同。Bluesky `bdeb25ed84cf12d06362d4a04939f8caf11d0818`，已读原生/web App roots、一个 Expo native module、mock-server/e2e setup/flow、testing/build 文档及 lint/nightly-e2e 工作流。借鉴明确装配所有权、fixture 隔离、薄 native bridge、开发命令；不移植 Effect/provider/Monorepo、不升级依赖、不把上游 advisory fingerprint 代替本项目硬门禁。所建议的 T3 sidebar-navigation-shell.tsx 在固定当前树为 404，未当作来源使用。

控制：子代理 `a46ab78f12faca26e3432a5a278299400dac4c26` 已集成为 `512fde8`。control 462,341→45,344 bytes，tasks 投影 409,548→8,385 bytes；完整检查点 50→8，25,102,243→3,611,886 bytes。581 条证据、21 条终态 CI、142 条终态 delegate 迁入摘要绑定的不可变历史；权威保留 42 个门禁候选、1 条 CI、3 条审查 provenance，归档不能满足门禁。保留最新诊断及仍能通过的较早候选；不改任何历史报告。50/50 控制定向回归通过，组件提交全新 clone resume exit 0、8 个检查点有效。协调分支通过显式 adopt-branch 接管并再校验 8 个检查点；最终字节统计待收口。

持久化审计遍历全部 623 条原证据：290 份报告字节精确，333 条旧引用摘要不符仍无效；找回 8 个唯一安全日志、覆盖 25 个引用，按原 SHA 和 Git 索引字节核对。42 个引用/10 个产物因敏感或来源不足 withheld，另 2 个嵌套引用不可得；新 clone 不会神奇获得这些原文。源工作区审计与不含私有原文的 clone 审计分别保留，不能把 clone 中缺失的 withheld 字节误记为已公开。七个 completed 软件里程碑因来源变化回 testing；M5 in_progress、设备 pending；没有缩小任何 scoped fingerprint。

协议：`4aac86e3df4c92dbe972f6605eec7c2ac379f630` 已集成为 `08cbe41`；42 项合同测试、6 个直接行为对照及 copy/JSON/工作区负向用例通过，两处行为 pin 均验证旧实现失败。固定 normalized hash 为 `b9dbb606c7fa3bc731b5c19032d25c0a5d0c606df2c53c4c2577b00319c95f8b`；它使用清除 source positions 的正式 normalizer，与审计探索值不同，未把探索输出冒充验收。集成时精简 D2 说明，并移除桌面验证成功输出中无必要的本机绝对路径；桌面源码未改。

## 集中验证与独立审查

候选 `c1b41d8a0f331fd8907b6788c94da121152bfdff` 的 global sourceFingerprint 为 `3ce7ede25eebe836f0a1d3820edd7a87c6e624bfc0cac942241f2d47b7766fe5`。一次 canonical npm test：441 passed、0 failed/skip；typecheck exit 0，iOS bundle exit 0（1669 modules）；实际固定桌面合同 33/33、网关 67/67，桌面与原始 dirty 工作区均未改。四份成功原始报告及日志按原摘要保存于内容寻址目录，共享测试输出不等于共享任务通过条件。

Doctor 实际 19/20，版本建议检查失败：expo 58.0.26→期望 ~58.1.0，expo-glass-effect 58.0.5→期望 ~58.0.6。整体请求的验证集合因此仍为 FAIL；原始失败报告 `.agent/evidence/c57104783647198ae7e347b407983c275cd4ddc486019cf66bb348588b0482d3.json` 保留，含本机路径的输出留本地。未升级依赖、扩展忽略名单、重跑制造通过或导入失败证据。已另派只读诊断核对原基线和 CI install --check 的实际影响。

功能审查与真实交接 PASS：原始 receipt `.agent/evidence/3de75651600a78617081bf8ffc9b0dbe444db5ee3a406d475f66f2bd178a2598.json`；99/99 定向测试，独立无 hardlink 克隆实际完成权威损坏/显式恢复/dirty 文件字节保留及 check:stack。记录守恒核查按历史 multiplicity 计数，确认 623 条证据、22 条 CI、145 条 delegate 均保留。唯一非阻断项是文档漏暂存新导入 JSON，现仅补这两行；不为此重复业务测试。该 meta 文档变化不改变 unit/业务/安全既有作用域；原 c1 交接 all-scope 记录仍绑定原源码，不冒充新文档树的门禁。

安全审查 PASS、无 Blocker/Important/Nit：receipt `.agent/evidence/9c5a1d140d4539f3113805166c5c2118a9cb05e6221b67fa2ee19760cdd70731.json`；99 项定向测试及 10 项独立对抗用例通过，确认静态安全路径/atomicWrite 防线与基线字节相同，归档 PASS/显式 FAIL/未暂存日志不能满足当前门禁；协议负向及变异校验通过。已知同 OS 用户并发目录替换只能检测而非完全防止，日志筛查仍需人工审查，均不扩张既有保证。

## 最终交付、阻塞与证据边界

### 精确源码与共享绑定

测试/功能/安全原始对象仍绑定 `c1b41d8a0f331fd8907b6788c94da121152bfdff` / global `3ce7ede25eebe836f0a1d3820edd7a87c6e624bfc0cac942241f2d47b7766fe5`。`02185c937bf3bb8a83ade0ed17d59a971ae16cb9` 仅增加 docs/testing.md 两行精确暂存指引；当前 global 为 `628d6b092d8ea9a73e4d5d2c9b6c291c52e83f5aaf777b19dc893a1b8d3800d9`。最终元数据改动相对 02185c9 只在授权目录，45 个 task/kind 的 8 组实际作用域以及 global 与提交源码逐项相同；未改任何 scope 声明或策略。

只新增必要的 29 份小型 wrapper，加上直接使用的 4 份原始 M5 报告，共 33 个当前有效绑定。所有 wrapper 在登记前用 immutableWrite 持久化并暂存确切字节，再经 validateSchema / validateReport，随后一次 mutate 登记。18 个命令绑定共享四份原报告/日志；其中 protocol-contract 42 项与 M4 fault-injection 确为该次完整 `npm test` 的子集，保留真实 command=`npm test`、原始执行时间/commit/global/log，不虚构单独命令。15 个独立绑定共享功能、安全、当前交接三份实际 completed/pass 收据。wrapper 中的 sameRunEvidence/note 说明任务子集与限制；独立 wrapper 的 startedAt/finishedAt 明确只是本次绑定创建时间，不是审查执行时间。没有重复原始日志、重复业务测试或重复审查。

| 真实原始对象 | 内容寻址 SHA256（.agent/evidence/*.json） | 结果/用途 |
| --- | --- | --- |
| unit | `05fcd7c6423a9779b0732001c6874eca63ffa64c42bd6dfaa7671d2442811c3c` | npm test 一次，441/441 + stack；共享 unit / protocol-contract / fault-injection |
| typecheck | `81028456d9a2f5c5fe7f47acdb918ea62e6b85a09a9fdce502c6e94585341b14` | npm run typecheck exit 0 |
| bundle | `64372ce4f9dc82c2243bb7026837e4050b3c188be195fb440c5addd336b60e82` | npm run export:ios exit 0，1669 modules |
| integration | `45370ed132c6028733ab38a97e15047404861329b9a72095e630f01bd2ec49ba` | node scripts/desktop-remote-verify.mjs exit 0；桌面合同 33、网关 67 |
| independent-review | `3de75651600a78617081bf8ffc9b0dbe444db5ee3a406d475f66f2bd178a2598` | c1 功能 PASS，0 Blocker/Important；其旧 all-scope handoff 不重用 |
| independent-security | `9c5a1d140d4539f3113805166c5c2118a9cb05e6221b67fa2ee19760cdd70731` | c1 安全 PASS，0 Blocker/Important/Nit |
| independent-handoff | `a7a67111c56eb8e64dfac6d976ebfdb83f9d57989e965f02fcbac011a3621ffe` | 02185c9 的新 GitHub clone PASS；恢复 M-1-infrastructure |

当前 handoff 实际从已发布 GitHub 分支无 hardlink/alternate 克隆，核对 commit/global 与公开 JSON/日志字节，完成损坏权威、dirty 保留、显式恢复、resume 和 check:stack，并用独立 fixture 验证未暂存日志/JSON 的拒绝及精确暂存后的通过。只使用此新收据绑定 all-scope；不把 c1 的旧 handoff 改指纹冒充当前结果。这个收据验证的是 02185c9 的已发布字节及恢复流程，最终 metadata commit 的远端字节仍须父协调者在推送后独立核验。最终整合写入者未登记自己为 completed，也不充当独立验收来源。

### 继承失败与未验证范围

Doctor 原报告 `c57104783647198ae7e347b407983c275cd4ddc486019cf66bb348588b0482d3` 仍 passed=false、exit 1，原始私有输出 withheld，未导入任何 PASS。只读诊断收据 `cb926552d75cf364a1973c8e38c2ee658f34c407209c8798036b6f1c5b76b81a` 确认原基线与候选的 package/lock/config/workflows 相同，当前对两者均报相同版本差异。诊断记录的公开元数据显示 expo 58.1.0 与 glass 58.0.6 于 2026-11-26 发布；这解释当前推荐变化，不能倒推旧 CI 当时返回的服务端值。依赖保持 expo 58.0.26 / expo-glass-effect 58.0.5；未升级、扩忽略名单或绕过检查。

实际唯一 P2 Native CI：[45874631555/attempt 1](https://github.com/HYJ1817/pi-gui-ios/actions/runs/45874631555)，head=`02185c9`，2026-11-26T18:16:46Z 创建、18:19:03Z 终态 **failure**。checks 的 npm test/typecheck 成功，`npx expo install --check` 失败，bundle 跳过；native-build、sim-acceptance、ipa 均 skipped。evidence job 对零输入报 SYNTHETIC_EVIDENCE_REJECTED，未生成 artifact（API total_count=0）。未新增任何 passing CI/Doctor/UI/IPA 报告，未重用旧 IPA 为 P2 验收。最终证据元数据提交使用 `[skip ci]`，不再触发已知失败的原生验证。

公开原始 API 收据保留为：run `a6833cdd2aa28166280f9e1648e917ddf4a356c7cee13b6f608e49ec9ed3b7f9`，jobs `626b8bbacb7fc7037cd26b05ec5e64251d4b01acc06e6d8e281c4875c1f88e91`，artifacts `244563f989470892c537c9a4622920af0d228ee4528f7d00c64a06d6cd95856c`。终态失败经既有 ci CLI 再向 GitHub API 核验后保留在 live authority，不能因整理终态记录而隐藏。旧成功 CI 仅为剩余旧 UI/IPA 诊断候选的历史 provenance，绝非 P2 成功。

### 门禁、守恒与检查点

| 任务 | 当前有效绑定 / requiredEvidence | 保持的状态 | 缺口 |
| --- | --- | --- | --- |
| M-1-infrastructure | 6 / 10 | testing | doctor、ci、ui、ipa |
| M0-architecture | 4 / 4 | testing | 全局继承阻塞仍未解除 |
| M1-remote | 4 / 4 | testing | 依赖与全局阻塞 |
| M2-shell | 2 / 3 | testing | ui、依赖与全局阻塞 |
| M3-core | 4 / 5 | testing | ui、依赖与全局阻塞 |
| M4-sync | 4 / 4 | testing | 依赖与全局阻塞 |
| M5-tailscale | 6 / 9 | in_progress | device-network、ci、ipa、依赖与全局阻塞 |
| M6-distribution | 3 / 4 | testing | ipa、依赖与全局阻塞 |
| M-1-device | 0 / 2 | pending | device-install、device-upgrade；仅最终用户操作 |

33 个 positive report validation 通过不等于 task gate 通过。现有 gate API 对九个完整任务均返回未通过，含真实阻塞、未完成依赖与上述缺失/过期/失败证据；没有转换里程碑状态。

显式 compactControl 将新增绑定前后 75 个 live candidates 整理为 **42** 个：**33 current-valid + 9 旧诊断候选无效**；历史归档 **614** 个，合计 **656 = 原始 623 + 新绑定 33**。原始 623 个记录按 task 与完整内容、含重复 multiplicity，全部守恒；原报告/收据/日志无一改写。原始 623 的持久化审计仍为精确报告 290、摘要不符 333；其嵌套引用为 tracked-exact 332、missing 38、withheld 6。加入 33 个共享绑定后，总计精确报告 323、摘要不符 333，嵌套 tracked-exact 365、missing 38、withheld 6；这些是引用次数，不是唯一文件数。精确字节不表示当前可用，历史 missing/withheld 也不等于新验收失败或材料已恢复；未将不可得字节补写成通过。

两份摘要绑定历史归档均通过原 schema/摘要核验；新归档为 `b929c1b0b308841a15d0b2a1aad8d1a057445674b6cbbb1090123de46d55c619`。live CI=2（旧 success + 当前 failure）、历史 CI=22，共 24 条记录/23 个唯一 run-attempt；归档后显式恢复的当前 failure 同时保留终态归档副本，原始 22 条全部保留。live delegate=3（实际功能/安全/当前 handoff provenance）、历史 delegate=148，working=0；原始 delegate 身份及 multiplicity 与三项已审查终态修正均保留。

本次最终整合只产生两个有意义的完整检查点：一次显式归档边界、一次最终 STOP 交接；33 次绑定没有逐条建快照。连同父协调者原有检查点，正常保留 **8/8 valid**；原始最终里程碑快照 `v2-2026-11-26T16-27-54-196Z-74ec05c2-cc59-45bb-804e-36f2f361d42f` 与基线 `v2-2026-11-26T17-05-17-988Z-9fd20840-1eec-4a38-a0dc-1a207d9dff4e` 均仍在正常八份内且字节不变。最终交接检查点为 `.agent/checkpoints/v2-2026-11-26T18-36-02-530Z-16574fc1-d842-4bda-83dc-bc5c92ac4559.json`，保存时 HEAD=02185c9；外层/内层摘要及引用历史均已核验。旧检查点只按保留规则从当前树删去，仍可由 Git 找回。

## 最终测量与交付限制

以下统一为 **Git blob / 最终暂存索引** 精确字节，包含本报告、所有小 wrapper 和原始公开收据；不混用 CRLF 工作区字节。报告暂存后重算至固定值，避免本报告自身尺寸造成漂移。旧报告与失败历史保留，因此原始证据目录没有靠删除历史来缩小。

| 对象 | 原基线文件数 | 原基线 bytes | 最终文件数 | 最终 bytes |
| --- | ---: | ---: | ---: | ---: |
| 全部跟踪文件 | 813 | 55,632,688 | 840 | 32,244,518 |
| .agent/checkpoints | 50 | 25,102,243 | 8 | 1,315,622 |
| docs/acceptance（含日志与本报告） | 416 | 19,172,191 | 430 | 19,344,344 |
| .agent/evidence | 180 | 192,263 | 229 | 1,259,101 |
| docs/acceptance/logs（包含在 acceptance 内） | 17 | 140,250 | 30 | 286,597 |
| .agent/control.json | 1 | 462,341 | 1 | 49,454 |
| .agent/tasks.json | 1 | 409,548 | 1 | 8,385 |
| .agent/state.json | 1 | 53,052 | 1 | 6,117 |
| .agent/HANDOFF.md | 1 | 42,811 | 1 | 5,036 |
| PROGRESS.md | 1 | 3,216 | 1 | 1,865 |
| 本报告（基线不存在） | 0 | 0 | 1 | 24,978 |

本次最后整合未重跑产品全测、typecheck、bundle、桌面或 CI；它只验证元数据 allowlist/global/scope、33 个绑定、九个完整 gate、623 条原始记录守恒、历史/检查点/投影与精确暂存字节，以及 git diff --check。首轮只读元数据核查遇到 60 秒工具时限，后续有界本地核查完成；该工具时限不是产品测试失败，也不抹去上述 Doctor/CI 失败。

应用仍是 synthetic runtime，真实配对/会话/消息/live sync/生产接线属于 P3；安全、鉴权、撤销、审批、权限与数据完整性边界没有放宽。package/lock/workflows 与桌面均未改；SideStore 安装/刷新/升级/网络始终待用户最终一次操作。原生编译、Simulator 新图审、新 IPA、最终 metadata 的远端字节尚未在本次收口核验，保持 unverified。既有并发目录替换检测边界和日志需人工审查的限制保留。

回滚按 Git 精确回退本分支 P2 提交或逐文件恢复所需旧 blob；最终 metadata commit 可单独 revert，源码可回看基线 `e130b69`。不 reset/clean/强推、不改历史不可变对象，不以回滚冒充新树验收。下一步仅父协调者读回最终提交、推送核对远端字节并开 **DRAFT / HOLD merge** PR；解决继承依赖版本阻塞须另行授权，P2 到此 STOP，无 P3、依赖升级、合并或发布。

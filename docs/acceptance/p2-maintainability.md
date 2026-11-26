# P2 工程整理

本轮仅工程结构、控制层及证据持久化整理；不启动 P3，不修改桌面仓库，不合并默认分支或发布。最终结果在此单一报告追加，避免复制审计手册。

## 受保护基线

- 实际基线：`e130b692b01fff904f08cdd92eb70bd7deb74d1c`，`agent/m-1-bootstrap`，工作区干净；P1 merge `2e03288`。原开发与 P1 会话均 completed、无 active run 或 pending background tasks。
- 源码完整 CI：`5e38181faf169b96ad48b8638b3c06d3a95d8e98`，https://github.com/HYJ1817/pi-gui-ios/actions/runs/45819300792 ，已核实 success；桌面只读基线 `60d243a24b3ced198bd2e9ccaeb1e66f6129ba7e`。
- 权威 revision 2286、623 条证据、9 个任务。已验收软件的历史结论属于旧源码；P2 源码变动须正常失效，不能把历史 PASS 视为 P2 PASS。M5 device-network 与 M-1-device 设备验收仍待用户。
- 跟踪文件（基线工作区原始字节口径）：813 个，55,632,883 bytes。检查点 50 个，25,102,243 bytes；docs/acceptance 416 个，19,172,386 bytes；.agent/evidence 180 个，192,263 bytes。control.json 462,341 bytes，tasks.json 409,548 bytes。最终同时复核 Git blob 口径，避免换行影响误判。
- 当前权威检查点：`.agent/checkpoints/v2-2026-11-26T17-05-17-988Z-9fd20840-1eec-4a38-a0dc-1a207d9dff4e.json`，SHA256 `b65ea451ae333773f9d2ffe78458f1b30b024dd9c48ee9955d8bbf8b67065ac1`，authorityDigest `9898a0aa8e8ecefa7bf6c5722220318ccbd54d03f1dbe9c8349f9e40b0b47d93`。恢复命令已实际执行且 exit 0，其冗长输出保存在本机会话临时产物，不公开本机路径日志。
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

### 当前分派（恢复入口）

- control delegate：`node:delegated-task:command%3Amcp%3Ae2b2c73f-cc7a-4ea8-aef7-1beb329e3ba1%3Adelegate-task%3A6116e3f9-da00-4535-941c-beda940684bd`。
- runtime delegate：`node:delegated-task:command%3Amcp%3Ae2b2c73f-cc7a-4ea8-aef7-1beb329e3ba1%3Adelegate-task%3A8b12efaf-ebd3-4db9-83cc-7a164b570b63`。
- infrastructure audit delegate：`node:delegated-task:command%3Amcp%3Ae2b2c73f-cc7a-4ea8-aef7-1beb329e3ba1%3Adelegate-task%3Abf87ccb8-660b-4373-9c38-fada8a216760`。
- docs delegate：`node:delegated-task:command%3Amcp%3Ae2b2c73f-cc7a-4ea8-aef7-1beb329e3ba1%3Adelegate-task%3A6a3e1588-ad53-41da-8e10-2542c5921c7f`；仅改指定七份开发文档，控制层新命令待集成时对齐。
- 服务端完成通知后读取结果，不轮询。下一步：检查各组件提交边界，集成后安排独立审查；集中验收再 push/PR。分支使用 refactor/ 前缀，避免 push 与 PR 创建分别触发全套 Native CI；最终 PR 仍执行原五 Job。
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

下一步：候选源码冻结后，并行独立功能/安全审查及统一测试/类型/bundle/真实桌面协议验证；从全新 clone 验证正常恢复、损坏恢复、dirty 保留与嵌套证据。测试原文可共享，任务绑定与每个门禁保持独立。仅在源码合齐、审查/本地检查通过后触发一次原五 Job CI；如源码需修复则如实重验，不把旧产物当新源码证据。

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

这是多个独立职责的工程整理，实施按组件隔离；同一目录/工作区只有一个写入者。父协调者 worktree `C:/pi-gui-ios-p2`，分支 `agent/p2-maintainability`，负责集成、范围控制和 PR。子代理实际工作区由 delegate 工具创建并在首次写入前确认。

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
- 服务端完成通知后读取结果，不轮询。下一步：检查各组件提交边界，集成后安排文档与独立审查；集中验收再 push/PR。
- 三条旧 working 记录真实状态已逐一读取：9081f59c failed；b59334b1 completed、审查结论 FAIL；a5cb4a18 completed、审查结论 FAIL。后两次审查使用旧桌面 commit，历史结论不变，不伪装 PASS。随后 round-10 的结果另有独立记录。

### IPA 保护信息

旧源码 IPA 报告引用 `.agent/evidence/61e778bcea080bec599e690ef8d6f7db1ba5686b0dd43e1606dc445ded666e4b.json`。IPA archive SHA256 `71147485f788ffb2b7cf84f92f82b53df4a20017c9f2ddf94b5b539ccb67d737`；verification `docs/acceptance/ipa-verification-45819300792.json` SHA256 `7a2feed7fd6e1fb8a64e19b356b9b7a306a9597f495677b50066a2827180b6fc`。GitHub API 核实 unsigned-device-ipa artifact `15118533232` 未过期，10,795,076 bytes，artifact ZIP digest `cc406b7ca284889fa2dd20709fd91b7e9f60d8da3377b879de652df60131bee6`；此 ZIP digest 与 IPA 文件摘要不是同一对象。

Git blob 精确口径基线：813 文件、55,632,688 bytes；docs/acceptance 416 文件、19,172,191 bytes。与工作区的 195-byte 差别来自检出换行，最终对比使用 blob 口径。

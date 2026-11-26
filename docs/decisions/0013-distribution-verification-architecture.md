# ADR-0013: M6 分发验证架构（版本检测 / 升级兼容 / SideStore 源 / 发布草案）

日期：2026-11-26
状态：accepted

## 背景

ROADMAP M6 要求：unsigned IPA 的版本检测、Release 草案/SideStore source、升级/降级/撤销兼容的**自动化与结构验证**；SideStore 真机刷新/覆盖升级留到最终设备清单；正式发布需用户明确授权。

## 决策

四个 stdlib-only、fail-closed 的离线验证组件，全部只输出固定代码词汇（绝不输出 plist 值、路径或环境细节）：

1. **`scripts/ci/version-detect.py`** — 从 IPA 清单提取 `CFBundleShortVersionString`/`CFBundleVersion`/`CFBundleIdentifier`，与仓库唯一事实源 `app.json`（expo.version / ios.buildNumber / ios.bundleIdentifier）交叉校验。任何漂移 = `VERSION_MISMATCH` 硬失败：SideStore 升级排序与用户可见版本都键在这些字段上，与源码树不一致的 IPA 永不可分发。

2. **`scripts/ci/upgrade-compat.py`** — 结构级升级兼容验证：buildNumber 严格单调（iOS 对非递增 CFBundleVersion 的覆盖安装按降级/拒绝面处理）、bundle 身份稳定（覆盖安装只在同身份下可能）、arm64 架构稳定。**报告显式声明 `scope: structural-automation-only` 与 `deviceSemantics`**：SideStore 刷新/覆盖/撤销的设备语义永远由最终用户设备清单验证，本报告绝不声称。

3. **`scripts/ci/sidestore-source.py`** — AltStore/SideStore 源清单**草案**生成。`date` 字段置 null（发布时盖章，绝不虚构）；`publicationStatus: draft-only-never-published`；`appPermissions` 诚实声明空敏感权限面（与 verify-ipa 的零权限策略一致）；iconURL/downloadURL 指向将来发布位置——草案结构完整但在发布发生前不可工作，这正是验收要求（无隐式发布）。

4. **`scripts/ci/release-draft.py`** — 发布草案装订：tag/title/notes/asset 清单全部生成但**只写本地文件**（`publicationStatus: draft-only-requires-explicit-user-authorization`）。关键安全属性：**交叉哈希绑定** — 草案描述的 sha256/size 必须与 verify-ipa 验证过的字节完全一致（`IPA_HASH_BINDING`）且 SideStore 草案条目也必须一致（`SOURCE_HASH_BINDING`），任何一个输入报告非 passed 即整体失败。草案不可能静默描述未被验证的字节。

## CI 集成

ipa job 在 `IPA_VERIFIED` 之后增加 M6 步骤，产出五件分发工件随 IPA 上传。升级兼容在首次授权发布之前没有真实基线：流水线用**本轮已验证报告派生的合成前一版本基线**驱动检查器端到端运行（证明接线真实执行）；跨真实发布的回归检测由单元测试的配对 fixture 覆盖，并在基线入库后自动生效。

## 不做什么

- 不发布任何东西：无 GitHub release、无 tag 推送、无 SideStore 源托管。全部 `draft-only`。
- 不声称设备语义：撤销/刷新/覆盖的真实行为属于最终用户设备清单（ADR-0006）。
- 不引入签名材料：IPA 保持 unsigned，重签名是用户在自己设备上的自主行为。

## 测试

`tests/m6-distribution.test.mjs`（14 例）覆盖：版本一致/版本漂移/build 漂移/格式非法/bundle-id 冒充/单调性拒绝/版本回退/身份漂移/输入非 passed 全部失败关闭/哈希绑定断裂拒绝/SideStore 形状与诚实权限声明/草案装订端到端。另已对真实 CI 产物（run 45759600894, build 1, ~10.9MB unsigned IPA）执行完整端到端链验证通过。

## 安全加固轮（2026-11-26 最终安全/功能审查 FSEC-001..004 + functional 4I）

首轮独立审查发现六个 important，全部修复：

- **FSEC-001 有界解析与净化失败**：zip 元数据（条目数/单文件/总量/压缩比）在任何解压字节产生之前校验；清单读取上限 1 MiB、压缩比上限 100；plist/JSON 容器类型先验证后使用；数字只接受 ASCII 十进制（`str.isdigit` 接受 Unicode 数字，正是此类工具必须拒绝的输入）；一切失败转固定码报告——traceback、输入值、文件路径绝不进入输出。
- **FSEC-002 端到端链绑定**：版本报告携带被检 IPA 的 `ipaSha256`；release-draft 验证 ipa↔verify↔version↔compat↔sidestore 全链同 digest，版本/build/tag/下载 URL/包身份精确一致。任何文档张冠李戴即 `*_HASH_BINDING`/`SOURCE_VERSION_BINDING`/`SOURCE_URL_BINDING`/`IDENTITY_BINDING` 硬失败。compat 报告的 `bindings` 记录它实际比较了什么。
- **FSEC-003 严格 schema**：`isinstance(True, int)` 为 True 是 Python 陷阱——build 号显式拒绝 bool；缺失字段不是"相等"而是 schema 违规；verify 报告必须 IPA_VERIFIED + 有效 sha256 + 非空合法 bundle id + 精确 ['arm64']。
- **FSEC-004 canonical tag 语法**：tag 必须精确匹配 `v<semver>+build<n>` 且等于由本批输入派生的 tag——遍历/换行/query/fragment/分隔符/不一致全部拒绝；完成后的 URL 再经 urlsplit 校验主机与路径。
- **CI 基线诚实化**：合成基线（候选减一）被移除——它不证明任何东西。两种诚实模式：`docs/acceptance/distribution/baseline-*.json` 存在时跑真实比较；否则哨兵报告 `NO_BASELINE_FIRST_RELEASE`，草案 notes 明确"not applicable — first release"，绝不声称未曾运行的验证。
- **FSEC-006 证据不可变性**（控制面级）：verify.mjs 输出日志改内容寻址 `docs/acceptance/logs/<sha>.log`；agent-task evidence 导入时把报告字节复制进 `.agent/evidence/<sha256>.json` 内容寻址存储后才记录路径——权威引用的字节永不因后续重建被覆盖。历史失效引用在 `docs/acceptance/evidence-immutability.md` 如实记账。

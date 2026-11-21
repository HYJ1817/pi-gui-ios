# ADR 0003 · 原生依赖、最终 IPA 与公开证据边界

日期：2026-11-21（本机日期）；范围：修复 58ec995 首轮安全审查确认的问题。状态：实现与 Windows 离线回归；**真实 macOS 依赖锁 bootstrap、device IPA 和 SideStore 尚未验收**。

## 基线与历史事实

实现工作区基于 26e122a，独立开发分支 t3/harden-ipa-integrity。不修改父 Agent 的控制层、schema、app、package 文件及其他测试；不启动子 Agent，不推送、创建 PR、触发/重跑/取消 CI 或合并发布。

恢复时只读查询 44783585115 仍在运行。父 Agent 随后提供并允许本机只读参考的日志显示：2026-11-20 17:52:14Z，Xcode 26.6 / iOS 26.5 的 arm64 Simulator Release 出现 `BUILD SUCCEEDED`；父 Agent 于 17:52:43Z 请求取消，最终 cancelled，取消处于 iPhone 交互阶段，没有产品失败断言。首轮 artifact 14655366727（471821 bytes）不含 device IPA，也不含可恢复的实际 Podfile.lock。**不可将取消写成 native 编译失败，也不可将这次历史编译成功继承给本次源码。** 原始日志仅留本机，未复制进仓库或公开产物。

## 决策一：先私有暂存、验证最终字节，再发布白名单

- `package-ipa.sh` 在必须存在的 `RUNNER_TEMP` 下 `mktemp`，设置 EXIT/HUP/INT/TERM 清理。原 app 不改动；副本、Payload、处理签名的中间材料只进入私有目录。
- 开始前删除旧的三个发布文件。目录检查通过后构建 ZIP，再重新读取最终 ZIP 验证，生成最终 IPA SHA-256 与固定字段 JSON。仅将最终 IPA、verification.json、SHA256SUMS 复制到 artifacts/ipa。任一失败（包括部分复制失败）都删除这三个文件并清理暂存。SIGKILL/主机故障不能执行 shell trap；残留仅在临时 runner，不在任何 artifact/cache 上传路径。
- 原始环境、构建、pods、Maestro 日志和 simctl inventory 均在 `RUNNER_TEMP/native-private`；不上传这些目录/文件。每步输出固定 step/status，报告固定 `NATIVE_STEP_<STEP>_<STATUS>` code；开始执行就记录 running，最终收集时将未结束的 running 标成 interrupted，区别于 not-run。结尾清理 runner 私有目录。
- 合成截图仅来自清空应用状态后的专用模拟器和固定流程路径。PNG 验证结构/CRC/解压长度，移除文本等元数据，只保留 IHDR/IDAT/IEND；拒绝动画、错误结构与未知 critical chunk。不能据此判断画面内容或代替真实 UI 图审。
- JUnit 重新构造固定 testcase 标识和失败/跳过状态，保留断言失败，不携带原始用例名、路径、stack、message、system-out。DTD/实体、缺失用例或未能表示的 suite error 拒绝发布；步骤实际失败仍使 job 失败。
- Actions 三组 artifact 的 path 均为**逐文件显式白名单**，没有目录、glob 或整个 artifacts 上传。最终 IPA 只在包装验证步骤成功且 job 成功时上传；合成证据只在收集成功时上传；候选锁只在 pods 返回 bootstrap-required 时上传。失败/未执行的步骤不会上传旧文件。没有 Payload、签名明文、原始日志或 simctl 清单的发布规则。

## 决策二：stdlib 直接解析每个可执行体

`verify-ipa.py` 不调用 lipo、vtool 或 codesign 来推断验证成功。它既能检查目录，也能检查最终 ZIP，使用同一策略：

1. ZIP 限制为单一 Payload/PiGUIMobile.app；拒绝重复/大小写冲突名称、穿越、控制字符、Windows 特殊路径、符号链接、特殊文件、加密条目及超限内容；读取最终成员并检查 CRC。
2. 解析真实 thin/fat/fat64 头和 load command 边界。只允许唯一 arm64（不接受 x86_64、额外 slice 或 arm64e）；必须有可执行 __TEXT 与 LC_BUILD_VERSION，platform 必须为 PLATFORM_IOS=2，不能是 simulator=7、macOS、Catalyst 或仅靠旧版本命令猜测。
3. 每个识别到的 Mach-O，包括未被 Info.plist 引用的可执行体，均检查平台、最低系统和签名。最低系统必须为有效数字版本（本探针策略 12–99），SDK 不早于部署版本；二进制最低系统不高于所属 bundle 和顶层应用的最低系统。拒绝加密代码及 dyld 环境注入命令。这里是归档策略检查，不是完整系统加载器或可运行性认证。
4. app/framework/executable bundle 的 CFBundleExecutable 必须指向真实 Mach-O；app、dylib framework、bundle 使用匹配的 Mach-O filetype。Framework 没有 binary 或 Info.plist（包括空目录）会失败，不再静默跳过。每个可执行 bundle 的平台/最低系统元数据也必须一致。
5. 所有 LC_CODE_SIGNATURE/LC_DYLIB_CODE_SIGN_DRS 都拒绝；即使空签名命令也不当作 unsigned。拒绝 _CodeSignature、CodeResources、provisioning、entitlements/xcent、私钥/证书文件、ResourceRules/ExportOptions 等残留。`codesign -d` 的非零返回不再被当成“未签名”的证据。
6. 允许在**私有副本的嵌入 framework** 上用真正 `/usr/bin/codesign --remove-signature` 正常化供应方签名，并清理 framework 资源 seal；工具错误与移除后仍有签名均失败。不会移除 app 签名来掩盖意外签名构建，不删除 provisioning/entitlements 以使其过检。非 macOS 不假装执行此操作。

权限与网络采取显式允许表：当前敏感权限允许表为空，已知 permission 及未知 NS/UI/LS/WK/UT/NFC 敏感命名空间均默认拒绝；源码定义的有限非敏感元数据键单独允许。ATS 只接受明确列举且值为 false 的四个放开选项和空 NSExceptionDomains；不接受未知键或任意 exception domain。URL scheme 仅允许本应用的 piguimobile / io.github.hyj1817.piguimobile（Expo 默认添加 bundle ID 的事实已对锁定版本源码核对）。

`configure-native.py` 只将已知 RN 生成模板的 NSAllowsLocalNetworking 布尔选项收紧为 false；不悄悄删除未知权限或 ATS 例外来绕过审查。未来需要真实远程权限、扩展或网络策略时，必须显式修改策略、补负向测试并复审。

## 决策三：真实解析候选锁，审核后才有 locked 构建

固定 Ruby 3.3.8、Bundler 2.6.9、CocoaPods 1.16.2；Gemfile 使用精确版本，ruby/setup-ruby 固定 commit SHA。**未生成或编造 Gemfile.lock / Podfile.lock**，native/dependency-policy.json 当前明确是 bootstrap-required。

首次 macOS bootstrap：

1. `bundle _2.6.9_ install` 在 RUNNER_TEMP 内解析实际 Gemfile.lock；pods 脚本启用 `set -euo pipefail`，`pod install | tee` 的错误不会被 tee 吞掉。日志留私有临时目录并清理。
2. 解析真实生成的 Gemfile.lock / Podfile.lock，拒绝未知来源、带凭据/查询的 URL、任意绝对/逃逸路径和未知顶层字段。候选 Gemfile.lock 从 Bundler 解析字段重建，Podfile.lock 从受限 YAML 重建，丢弃注释与未解析原文；只有规范化后的锁能发布。
3. 收集 `ios/Pods` 和 `node_modules` 中全部 framework/xcframework 文件、Mach-O、静态/动态库、wasm/native module、Metal/tbd 与 tar/zip 归档的相对路径、大小和 **SHA-256**。尤其覆盖 RN Pods 中 Debug 与 Release 的 Hermes / ReactNativeCore / ReactNativeDependencies 归档，不能只依赖 Podfile.lock 的 podspec checksum，也不依赖上游可选 SHA1 检查。生成前检查 native 路径链接与路径安全；不记录绝对路径或环境变量。
4. 只保存四个安全候选：Gemfile.lock、Podfile.lock、prebuilt-dependencies.json、review.json。review.approved=false，code=NATIVE_LOCK_BOOTSTRAP_REVIEW_REQUIRED；hashes 绑定 Gemfile、package-lock、生成 Podfile、两个候选锁和预编译清单。
5. **返回 78，使 job 失败并停止后续 build/simulator/IPA。** 候选 artifact 名明确 review-required；不得登记为 ci/ipa acceptance。

父 Agent 审核实际 macOS artifact 后的落库契约：

- 审核解析的全部版本、来源、本地生成路径及全部预编译二进制/Debug+Release 归档哈希；记录对应 run/head 与独立审查证据。不能仅凭文件名或 approved 字段批准。
- 将真实候选 Gemfile.lock 放仓库根；Podfile.lock 放 native/Podfile.lock；prebuilt-dependencies.json 放 native/prebuilt-dependencies.json。
- 新建 native/lock-review.json：schemaVersion=1、approved=true、hashes 原样取自审核过的 review.json。将 native/dependency-policy.json.mode 改为 locked。不要把本 ADR 的说明当作实际批准。
- 下一轮 prebuild 后先比对 Gemfile/package-lock/Podfile 和审核锁/清单的 SHA-256，再把审核过的 Podfile.lock 复制到 ios。Bundler 使用 BUNDLE_FROZEN=true；CocoaPods 使用 `pod install --deployment`。安装后重新规范化和比较两个锁及全部预编译字节清单，一处漂移或新增/丢失均失败，才允许构建。
- 后续若需要换依赖，必须在专用审查分支显式回到无旧锁集的 bootstrap 流程获取新候选，再重新审核落库；不会自动更新、忽略差异或把未锁定解析降级为可验收。

## 缓存边界

actions/cache restore/save 均固定 SHA 0057852bfaa89a56745cba8c7296529d2fc39830（已只读核对官方 v4.3.0 tag）。key 绑定 OS/arch、macOS/Ruby/CocoaPods/Bundler 版本和 Gemfile、Gemfile.lock、package-lock、生成 Podfile、审核 Podfile.lock、策略、review、预编译清单的 hashFiles；**没有 restore-keys 宽泛回退**。

只缓存公开的第三方 CocoaPods 下载/公开 trunk 元数据、ReactNative 共享下载及 Pods 三个明确命名的预编译归档目录。没有项目 app、Payload、DerivedData、build、工作区、签名身份/配置或 CI 日志目录。供应方公开二进制的原签名不代表项目签名授权，最终 IPA 仍必须移除供应方签名并通过上述验证。

bootstrap 阶段不恢复/保存此缓存；locked 阶段即使命中缓存仍执行全部锁、归档及实际展开后二进制 SHA-256 校验。只有校验成功才保存缓存，测试/构建失败不能保存项目生成物。缓存是提速手段，不是可信或验收证据；主要减少重下载/重复准备依赖，不宣称缓存命中免除 Xcode 构建。

## 验证与剩余门禁

Windows 本地实际运行 `npm test -- --test-reporter=spec`：**100 tests，100 pass，0 fail，0 skipped**（新增 IPA/CI 89 项 + 此 worktree 基线控制层 11 项；不是父 Agent schema v2 的 26 项测试快照）。测试入口保持 `npm test`，新增仅 tests/ipa*.test.mjs，不修改父控制层测试。用纯合成临时 fixture 实际读取 Mach-O/ZIP 字节，不 mock lipo，不写真实用户数据。覆盖错误平台/架构/minOS/签名、缺 executable framework、额外 executable、敏感权限/ATS、ZIP 特殊路径/链接、打包失败与部分发布残留、tee 掩盖失败、锁/预编译漂移、截图/JUnit 脱敏及上传/缓存门禁。另实际通过：4 个 CI shell 文件 bash -n；18 个 workflow run 命令/块 bash -n；5 个 Python 文件 compile（不写 pycache）；select-simulators.mjs 和两个新测试文件 node --check；git diff --check。

父 Agent 下一步：cherry-pick 本实现提交后在集成工作区重跑 npm test，独立复审，再统一触发一次 macOS bootstrap。先取得并审核安全候选锁、按上述契约落库，再进行 locked native/IPA CI；不把 bootstrap 的 exit 78 误记为已通过或 native 编译故障。

**未执行/不得标通过：** 本实现的 macOS Ruby/Bundler/Podfile 解析与候选锁规范化、cache 命中/污染回归、真实 codesign framework 去签、最终 device Release Mach-O/IPA、iPhone/iPad Maestro 与截图视觉验收、独立安全复审和 SideStore 免费签名安装/刷新/覆盖升级。当前 Windows 没有 Ruby，不能声称运行过 Ruby 解析器或 ruby -c。父 Agent 统一安排真实 CI；本实现未触发任何新 CI。

离线静态 IPA 检查、历史 Simulator 编译、device IPA 生成、SideStore 真机成功是四种不同证据。所有报告均明确 sideStoreInstallVerified=false。

## 集成后的诊断补充

父工作区另补充 `safe-diagnostics.py`，避免只有一个失败stage而无法排障：公开报告只含固定类别代码、Git HEAD中已有的相对源码名/行号，或HEAD package-lock中的包名/行号；**不复制原始错误消息、引号中的标识符/值、生成或未提交的源码名、绝对路径**。代码词表也从不可变Git源码读取，不能由安装后生成文件扩大。Ruby锁解析仅报告固定校验阶段；pods失败在清理私有日志前提取此类安全诊断，保留原退出码。环境只输出正则约束的8项公开工具版本，不输出env配置或模拟器标识。

`collect-evidence.py` 分别生成白名单内的diagnostics/environment JSON；失败/中断时保留专用空白模拟器的failure.png，并执行相同PNG结构/元数据清理。新增键盘显隐、动画完成与原生手势探针截图也逐个列入白名单。现有不上传原始日志/签名材料/目录通配的断言保持，并将只核文件数量提升为完整预期集合比较。新增合成privacy fixture检验：即使私有标记存在于源码文本或生成文件中，也不能经诊断回显；不使用真实数据。

## 回滚

如发现兼容问题，在开发分支 revert 本实现提交，保留 bootstrap 未验收状态；不得通过放宽权限/签名/平台断言或忽略锁差异来让 job 变绿。对合法新键、新依赖来源或生成结构的支持应有真实 macOS fixture 和独立复审后再加入显式表。

# 技术栈对齐决策 · T3 Code main

状态：技术决策与必要探针记录，实际验收状态以 control/evidence 为准。用户第14条取代原“Expo Router 硬约束”；本文件是技术选择与差异的唯一决策入口。**候选/计划不等于已通过原生运行验收。** 现有恢复/安全修复继续，不改变桌面架构或远程授权边界。

## 1. 实际研究基线与方法

2026-11-21 本地首次完整分析时，实际 `git ls-remote https://github.com/pingdotgg/t3code.git refs/heads/main` 得到 **068332c603ce5ca40ad5a96a09cffa34ebd05dff**；本次继续时再次查询并取回当前 main **285558eb1053d17f59ea8ecdf7c57999e92381f8**，完成锁文件/manifest及相关导航、composer、消息/feed/onboarding代码差异审查。最新 main 的移动直接依赖为102项、相关patch为19项：移除 @react-native-ai/apple，expo-audio的peer快照随之变化；本文采用的13项核心版本与相关UI补丁均未变化。新main还增加LinkedThread路由、MCP sign-in业务和语音适配，不据此把T3业务授权层搬入本项目。完整基线及增量证据分别保留，早期 ccc1feb… 仅是历史研究。本次从该 commit 的 Git 对象只读导出源码；Windows 完整 checkout 超时的半成品工作树不作分析依据，未编辑 T3 源文件。

实际读取：mobile package、root package/catalog/overrides、整个 pnpm lock 的机器解析、入口/App/Stack、iOS workspace navigator/header、Uniwind Metro/CSS、状态和持久层、native markdown/代码块、手势/动画/键盘调用、原生模块与 podspec、移动单测配置、e2e/behavior 脚本及相关 Actions。源码路径见下表，不以 README 或截图推测。

增量证据 `docs/acceptance/t3-main-delta-285558eb.json` 记录最新main、102项统计、变更/删除依赖、20个关键源码/补丁的前后摘要及13项核心版本一致性。机器证据：`docs/acceptance/t3-main-technology-inventory.json` 含主分支 commit、13个主要源码文件摘要、103项移动端直接运行/开发依赖的声明与锁定解析、20项相关补丁摘要；94项注册表版本已从 npm 官方 registry 取回 license/engines/peers/integrity，0 查询失败。9项本地/workspace引用不伪装为注册表包。`t3-vendor-inspection.json` 另校验两个本地 tgz 的 SHA-512 与 lock 一致，并实际读取包内 metadata/许可证。研究使用独立临时工具目录的 YAML 2.9.0（ISC），未加入应用依赖。

## 2. 逐项选型矩阵

“同族”只表示主要成熟方案一致；**有 patch/fork 的相同版本号不视为相同实现**。

| 领域 | T3 当前 main 实际方案/版本/许可证 | pi GUI Mobile 对应选择 | 一致性与具体原因 | 实际验证/完成前要求 |
| --- | --- | --- | --- | --- |
| 原生应用基座 | Expo 58.0.23、RN 0.88.1、React 19.3.0；MIT | 保持 Expo SDK58 / RN0.88.1 / React19.3.0；Expo58.0.26 | 同族，Expo补丁版不同；本项目58.0.26已实际 Windows bundle 和 Xcode26.6 Simulator 编译；不无依据回退已验证补丁 | 新依赖集仍须重新编译/运行，旧成功不能继承 |
| 导航 | @react-navigation/native7.5.1、native-stack7.21.0、elements2.9.45；MIT；`createStaticNavigation` + 自定义 workspace navigator | 采用 React Navigation7.5.1 / native-stack7.21.0 / elements2.9.45 静态入口，已移除 Expo Router 文件路由 | 对齐；Expo Router 不再是硬约束，也不再作为默认包装层 | 新入口类型检查、bundle、双设备 native push/pop/返回手势 |
| 导航底层 | react-native-screens **5.0.0-t3.61** 本地MIT fork；native-stack补丁；core override7.24.0 | M-1 先用官方 screens4.30.1 + 同族 native-stack；core7.24.0 精确对齐 | 明确差异、非声称等价：T3 fork包括V5 Stack/Split/Tabs、iOS27.1横向栏/toolbar/cache与自定义投影，不能只复制tgz就得到其完整导航；本项目先在已验证Xcode26.6/SDK组合建立官方native-stack基线。M2自适应布局前重新评估所需窄补丁或fork | 官方版本能否满足最终iPad行为未确认；M2列宽/转屏/多栈/交互返回失败时不得用JS假导航绕过 |
| UI组织/样式 | React Native、平台特化组件、Uniwind1.13.2、Tailwind4.3.3；MIT；native props用withUniwind显式映射 | 采用免费Uniwind1.13.2/Tailwind4.3.3，探针保留System字体、原布局和系统主题 | 对齐；字体/复杂主题生成暂不照搬T3品牌资产，M2另验；不引入另外一套大型UI kit，不使用付费uniwind-pro，也不复制T3全部主题生成/monorepo脚本 | Metro实际生成类型/原生bundle；深浅色/动态字体/无障碍截图 |
| Liquid Glass | expo-glass-effect58.0.5 MIT，GlassSurface + native availability；旧系统另有blur降级 | 相同GlassView及API探测，Reduce Transparency或不支持时明确实色回退 | 主实现一致；回退按用户明确约束不借blur伪装Liquid Glass | 真正iOS26+运行和图审；availability文字不能单独证明渲染 |
| 原生菜单/控件 | @react-native-menu/menu2.0.0 MIT且有patch，@expo/ui58.0.27 MIT且有patch，以及T3 UIKit模块 | 采用社区原生menu2.0.0标准API，已替换初版ActionSheetIOS；按具体功能后续引入@expo/ui，不一次安装全部模块 | 同族、未应用T3扩展patch；无现成功能需要时不自造新原生控件 | 原生菜单点击/取消/状态回传、iPad锚点和图审；不得称未应用T3补丁的包完全等价 |
| 动画 | Reanimated4.7.1 + Worklets0.13.1，MIT；含screens-V5退出动画补丁；ReduceMotion.System | 采用相同4.7.1/0.13.1组合，探针由UI worklet完成回调反馈状态，遵循系统减少动态效果 | 同族、实际native运行待验；不搬入依赖T3 V5生命周期的退出动画补丁，若无相同调用前提不机械应用 | 有真实UI worklet动画探针、Reduce Motion和快速返回/卸载回归 |
| 手势 | Gesture Handler3.5.0 MIT+patch，GestureDetector/Pan、根GestureHandlerRootView | 采用3.5.0、根容器及原生Tap探针，辅助功能动作使用独立反馈而不冒充手势回调 | 同族、native实测待验；不为仅表面统一移植T3窗口/滚动优先级内部路由 | 真实tap/pan/纵向滚动/系统边缘返回互不吞事件 |
| 键盘 | keyboard-controller1.23.0 MIT+patch，KeyboardProvider/StickyView/Reanimated keyboard；iPad浮动键盘和内容inset补丁；原生composer | 采用1.23.0的KeyboardProvider/KeyboardAwareScrollView/useKeyboardState，显隐由native observer反馈 | 同族、停靠/浮动等native实测待验；T3专有composer和复杂inset patch暂不整套搬入。已读补丁中的iPad浮动/最小化缺陷，不能因版本号相同忽略差异 | 输入、收键盘、切前后台、安全区、iPad停靠/浮动/硬键盘；未验证项保留门禁 |
| 消息/Markdown | **react-native-enriched-markdown1.2.0-t3.18** 本地MIT fork，MD4C github flavor、可选数学、选择/链接/图像/代码渲染回调 | 优先相同成熟库技术族/经审计fork；M3前用离线消息探针实际比较，暂不另造Markdown组件/切HTML WebView | 对齐优先的候选，尚未定稿/未安装；保留流式更新、Windows路径、表格、长代码、复制/选择等成熟能力要求；不机械拷贝T3权限/媒体/分享绑定 | 真正native渲染、流式不完整Markdown、超长消息/表格/代码、链接授权、字体/选择测试后才确定具体fork版本 |
| 长列表 | @legendapp/list3.7.3 MIT，AnimatedLegendList、键盘滚动协调与高度测量 | 消息/会话列表优先同族LegendList；M-1简单探针保留小型ScrollView | 同族候选，业务列表未开发；不提前复制T3几千行feed projection | M3大列表、流式append、滚动锚点/键盘及内存实测 |
| 代码高亮/差异 | @pierre/highlights0.5.0、@pierre/diffs1.7.0-beta.4（Apache-2.0）；Nitro0.37.2 MIT + T3Highights/SourceText/ReviewDiff模块 | 优先成熟同族；按工具/消息展示需要单独验证，暂不引入terminal、diff全套native vendor | 尚未选择具体实现；语法树/高亮/差异不自行重造；T3模块内第三方vendor需另查许可证和构建条件 | M3原生边界与大代码块实测、第三方notice、Framework/ABI及资源校验 |
| 原生扩展架构 | Expo Modules + Swift/UIKit、Nitro/C++；t3-native-controls podspec最低iOS18，自有模块受根MIT，vendor另计 | Expo Modules和成熟社区组件优先，仅为被证实的能力缺口写窄原生适配 | 技术族一致、范围不同；不把整个T3UIKit层移植成另一个内部平台，不无理由提高最低iOS | 每个新增native模块都进macOS构建、Simulator运行、device IPA检查 |
| 状态管理 | Effect4.1.3、@effect/atom-react4.1.2 MIT；Atom Registry、Layer注入、shell/threads projection、snapshot+WS增量 | 按Pi GUI协议和体量在M0选择；M-1局部探针useState；不提前引入T3全部runtime | 用户明确允许不同；Pi GUI后端/身份/审批不同，不能把T3 domain schema当协议权威。优先成熟external-store/Effect方案，比较后记录ADR | M0定稿前复核复杂度、取消/资源释放、M4补发/幂等/并发测试；当前无最终业务状态库选择 |
| 持久化/秘密 | expo-sqlite58.0.15 / SecureStore58.0.2，wrapper MIT；秘密独立保存 | 凭据优先SecureStore；本地缓存按M0数据量决定SQLite，M-1不保存配对秘密 | 同族候选；运行控制层JSON与移动业务存储不是同一层 | SideStore重签/覆盖升级后的Keychain、撤销清理和缓存脱敏真机验证 |
| 远程通信 | 共享client-runtime + Effect、HTTP/WS、DPoP/ticket；自有t3-web-socket与云/私网适配 | 独立Pi GUI remote v1白名单边界；优先Tailscale+TLS；可借鉴成熟DPoP/游标方案 | 必须不同的业务授权边界，不兼容代理T3或桌面通用RPC；不暴露桌面token/模型凭据，不修改Pi本体 | M0威胁模型；M1权限/撤销/重放/归属；M4断线与并发集成 |
| 单元/组件测试 | Vite Plus1.4.0封装Vitest5、@effect/vitest4.1.2，unit/react两项目、React Compiler变换；相关工具另见registry/根manifest许可 | 当前CLI/恢复/二进制检查用成熟Node:test + Python stdlib；React业务组件测试再评估同族Vitest，canonical npm test不分叉 | 用户允许测试基础设施不同；不为小型独立App搬整套monorepo工具/特定tsgo脚本 | 定向和canonical真实数字；必要组件测试不得被静态断言替代 |
| 端到端/视觉 | agent-device CLI、租赁设备池/gateway、Hermes/Metro行为探针、fixture provider、journey/pose/视频/截图审查；并非仅看README推测Maestro | 免费Maestro CLI2.12.1、标准GitHub macOS Simulator、合成数据、截图/JUnit/必要录屏 | 明确不同；不依赖T3设备池或付费云；保留其“真实交互+业务状态+视觉证据分层”和失败截图思想 | Agent可获取脱敏诊断和截图、定位失败并复验；代码静态通过不是UI通过 |
| 编译/分发 | Expo dev client / EAS本地或远端工作流、原生fingerprint、定制runner/账户配置 | 标准Runner xcodebuild、签名关闭的device IPA、SideStore自签、GitHub Artifacts/Releases（发布需批准） | 按用户硬约束不同；不声称EAS一律付费，仅不依赖其账户/云服务或Apple会员 | Ruby/Pod/预编译SHA锁，最终IPA结构检查，真实SideStore安装独立人工门禁 |
| 包管理/工具链 | Node26.13.1、pnpm12.14.0；catalog/overrides/patch/local tarball/workspaces | 当前Windows和CI Node24.22.1/npm11.19.1，package-lock固定完整性；独立应用不搬pnpm monorepo | 工具不同有实测依据：Expo58最低Node22.13，现有24环境已bundle/编译；不机械改全局Node或Pi | 每次依赖变更重验npm ci、peer、锁、macOS native和产物；后续迁移包管理须单独ADR |

## 3. 锁文件与兼容性细节（不能忽略）

- pnpm-lock.yaml 是 **两份 YAML 文档**：第一份锁 pnpm及平台exe，第二份才是项目依赖；均标 lockfileVersion9.0。使用 `parseAllDocuments`，不是只读第一份或grep版本。
- mobile importer、workspace catalog、root overrides、patchedDependencies、file tgz/workspace link共同决定实际代码；不能仅照mobile package里的范围安装。本次完整解析103项直接依赖并核对20个相关patch。
- native-stack7.21.0 patch包含独立scene presentation envelope、finishTransitioning、toolbar/center item扩展等；官方7.21.0不是该patch后的同一实现。screens tgz5.0.0-t3.61的Fabric接口包括Stack/Split/Tabs/FormSheet，并非普通4.x替换文件。
- T3固定core7.24.0并注明旧core会导致native stack启动问题；跟随其导航版本时一并核对core解析，不只安装顶层两个包。
- 本项目当前Expo58.0.26官方bundledNativeModules实际列：RNGH~3.3.0、Reanimated4.7.1、Worklets0.13.0、keyboard-controller1.22.7、screens~4.30.1、@expo/ui~58.0.29。T3的3.5.0/0.13.1/1.23.0/私有screens属于有意不同组合。本次仅对gesture-handler/keyboard-controller/worklets三个第三方包声明推荐版本差异，并精确固定为3.5.0/1.23.0/0.13.1；canonical npm test 同时执行 check-technology-stack，对照固定研究证据逐项校验13个实际版本、MIT许可、Reanimated/Worklets peer组合和两个core/Metro override，例外列表本身也必须完全匹配。其余SDK检查保持，并新增真实键盘显隐、UI worklet完成和原生手势回调的Maestro门禁。未使用--force、--legacy-peer-deps或宽泛忽略，也不把版本钉住视为native兼容证明。
- 原生生成模板也作为精确输入：CI使用expo-template-bare-minimum58.0.35，先fetch且不运行其生命周期，再校验已审SHA512后交给Expo；校验器摘要进入原生锁/缓存key。该包manifest声明0BSD，实际随包LICENSE是650 Industries的MIT文本，均记录且完整保留通知。单场景生命周期有严格schema，模板宏只准prebuild，最终IPA只准编译类名；不因此放宽ATS或权限。来源及fixture见tests/fixtures/expo58-template-source.json。
- T3键盘patch不只是版本钉住：已读iPad浮动/最小化键盘willChangeFrame处理与chat inset补偿；其未使用的额外API不自动成为本项目必需。需要其相同行为时优先复用有许可证的窄补丁并单测，而非重造键盘控制器。
- Markdown tgz实测版本1.2.0-t3.18、MIT、1193文件、SHA256 `8383ce9d60afbe3ef036376449b69884cc5c2bb6f6120716fb54f30e6c636a3d`，SHA512与T3 lock一致；screens tgz版本5.0.0-t3.61、MIT、1918文件、SHA256 `0516636f91ca55f3d656c31a466c2e3050c97fa06093288c887838b1ee0b3960`，同样已核。保留Software Mansion与T3版权，不能仅因根仓库MIT就忽略vendor许可证。

## 4. 源码定位

以下路径以最新285558eb1053d17f59ea8ecdf7c57999e92381f8为主，初始完整证据的068332c603ce5ca40ad5a96a09cffa34ebd05dff及其前后摘要保留在上述两个报告中；缩写的 `src/`、`modules/` 均应加 `apps/mobile/` 前缀，根目录脚本/配置保留原路径。可用 `https://github.com/pingdotgg/t3code/blob/285558eb1053d17f59ea8ecdf7c57999e92381f8/<path>` 复核：

- `apps/mobile/package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`：实际版本、catalog、override、补丁、local archive和peer例外。
- `apps/mobile/index.ts`、`src/App.tsx`、`src/Stack.tsx`、`src/features/layout/createWorkspaceStackNavigator.ios.tsx`、`src/native/V5StackHeader.ios.tsx`：静态导航、provider、原生投影和UIKit header。
- `apps/mobile/metro.config.js`、`global.css`、`src/components/ui/GlassSurface.tsx`、`src/native/native-glass.ts`、`src/components/ui/Menu.tsx`：Uniwind、GlassView和原生menu。
- `src/features/threads/ThreadDetailScreen.tsx`、`ThreadArrangementSheet.tsx`、`floating-working-control.tsx`、`thread-work-log.tsx`：键盘/动画/手势/LegendList实际调用。
- `src/native/EnrichedMarkdownText.tsx`、`HighlightedCodeBlock.tsx`、`codeBlockMarkdown.ts`、`src/lib/markdownDocument.ts`：native渲染及其流式、链接、代码等适配，不是WebView主聊天。
- `src/state/atom-registry.ts`、`src/state/threads.ts`、`src/connection/runtime.ts`、`src/persistence/mobile-{database,secure-storage}.ts`：Atom/Layer/状态投影/持久化和凭据分离。
- `modules/t3-native-controls/ios/T3NativeControls.podspec`、native module binding/config、t3-highlights/source-text/review-diff：原生边界与平台条件。
- `apps/mobile/vite.config.ts`、`scripts/mobile-{e2e,behavior,native-client,native-static-check}.ts`及其目录、`.github/workflows/mobile-*.yml`：实际单测、行为/视觉和构建体系。

官方交叉核对：React Navigation 7 native-stack/getting-started；Uniwind免费版quickstart/Metro；Expo SDK58 GlassEffect/版本表；各版本npm registry peers/licenses。其内容只是兼容依据，仍不能代替本项目实际运行。

## 5. 当前执行与验收约束

1. 已集成安全CI/IPA修复及恢复候选诊断，保留所有安全断言；未合并main/未发布。
2. 已迁移React Navigation和必要UI技术探针，Windows类型检查/bundle/版本合同已实际执行；完整集成回归与真实native验收仍由门禁判定，没有机械引入T3的全部102项依赖。
3. 依赖集确定后生成真实macOS候选锁，审查后锁定；再跑iPhone/iPad原生交互和图审、device IPA检查。修改依赖会使旧锁/证据失效。
4. 没有实际构建、运行和测试的候选均保留“待验证”；尤其消息业务、定制fork、键盘浮动态和大列表，不能仅凭T3已使用就替本项目验收。
5. 重要偏离/新增fork须更新本表、source/registry证据和独立审查；T3 main后续变化先记录delta，不盲目升级已验证依赖。

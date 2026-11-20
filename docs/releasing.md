# 构建与分发

开发分支可自主提交/推送/运行 Actions。没有用户明确批准不得合并 main、创建正式 Release/发布标签、强推或修改已有产物。

M-1 使用标准 macOS Runner、本地 Expo prebuild、xcodebuild，避免 EAS/Apple 会员依赖。Simulator app 与 iphoneos arm64 device app 分别构建；device 使用 CODE_SIGNING_ALLOWED=NO，打包 Payload/PiGUIMobile.app 为 unsigned IPA。不得声称此包可直接安装或已通过 SideStore。保存 SHA256、Info.plist、最低 iOS、bundle ID、Mach-O 平台/架构、嵌入 Framework 清单和权限审计。

固定原始 bundle ID 拟用 io.github.hyj1817.piguimobile。无 App Groups、Push、iCloud、Associated Domains 等付费 entitlement；后续 SecureStore 配置须验证 SideStore 重签后的 Keychain 与升级行为。Framework 是否可重签只在真机能最终确认。

正式 M6：批准后 GitHub Releases 托管 IPA，SideStore 自定义源采用官方支持格式/字段，版本/最低系统/下载链接/大小一致；发布前验证来源、升级保留、重签 bundle ID 行为、回滚。当前未发布任何版本或源。人工安装合并一次见 acceptance/M-1-device-checklist.md。

官方资料：Expo https://docs.expo.dev/；SideStore https://docs.sidestore.io/docs/advanced/app-sources；Apple xcodebuild man page 由实际 macOS Runner 保存。

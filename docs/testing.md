# 测试规范

npm test 是 canonical 本地自动化入口；必须包含恢复故障注入和门禁测试。npm run typecheck、npm run export:ios 验证类型与 Metro iOS bundle；npx expo-doctor 验证 SDK 依赖。Windows 不声称能运行 Xcode。

GitHub 标准 macOS-26：记录 sw_vers/xcodebuild/simctl 版本与实际选中 runtime；本地 prebuild/CocoaPods；Release simulator 无 Metro 独立运行；Maestro CLI 固定版本与校验和；iPhone/iPad 点击、输入、滑动、断言；深浅色/大字/低透明度截图、native hierarchy、JUnit、构建日志；always 上传合成证据。不得使用付费 Maestro Cloud/EAS 服务。

设备构建单独 generic/platform=iOS、iphoneos arm64、CODE_SIGNING_ALLOWED=NO。IPA 是待 SideStore 重签产物，结构校验不是安装成功。集中人工清单见 acceptance/M-1-device-checklist.md。

恢复故障：原子写入后恢复；中断留下 tmp；dirty 文件保留；CI running/failed 在状态中保留并远端重核；分支/HEAD 漂移显式诊断；证据内容和 source fingerprint 更改失效；更换 Agent 无历史恢复；双仓库 major 不一致拒绝阶段推进。独立子 Agent 真实执行 resume 并完成一项检查，报告证据。

证据来自真实命令、exitCode、代码指纹、报告文件 SHA256 和 Git commit。接受任务需要必需证据类型齐全、没有过期、独立审查。文档/控制投影不能自证业务功能。CI pass 不能替代用户授权合并或发布；没有截图不能声称 UI 验收。

# 测试规范

npm test 是 canonical 本地自动化入口；包含恢复故障注入、IPA/CI安全测试以及与固定T3研究证据匹配的精确技术栈合同。三个已论证的第三方版本差异由闭合名单和精确版本检查替代Expo推荐值比较，仍必须通过native运行验证，不用忽略标志代替兼容证据。npm run typecheck、npm run export:ios 验证类型与 Metro iOS bundle；npx expo-doctor 验证 SDK 依赖。Windows 不声称能运行 Xcode。

GitHub 标准 macOS-26：记录 sw_vers/xcodebuild/simctl 版本与实际选中 runtime；本地 prebuild/CocoaPods；Release simulator 无 Metro 独立运行；Maestro CLI 固定版本与校验和；iPhone/iPad 点击、输入、滑动、断言；深浅色/大字/低透明度截图、必要原生层次证据、JUnit、闭合代码和公开源码定位的结构化诊断；只上传明确白名单中的合成证据，原始构建日志与模拟器清单留在私有临时目录。不得使用付费 Maestro Cloud/EAS 服务。

设备构建单独 generic/platform=iOS、iphoneos arm64、CODE_SIGNING_ALLOWED=NO。IPA 是待 SideStore 重签产物，结构校验不是安装成功。集中人工清单见 acceptance/M-1-device-checklist.md。

恢复故障：完整 schema 写前校验（含嵌套 checkpoint/CI）；先落盘读回快照再提交引用；检查点失败不得推进权威；投影修复持锁且遇锁无写入；符号链接/Windows junction 拒绝；损坏权威从显式有效 v2 快照恢复并保留本地原文备份；中断留下 tmp；dirty 文件保留；CI running/failed 在状态中保留并远端重核；分支/HEAD 漂移显式诊断；证据内容和 source fingerprint 更改失效；更换 Agent 无历史恢复；双仓库 major 不一致拒绝阶段推进。独立子 Agent 真实执行 resume 并完成一项检查，报告证据。

证据格式按 `.agent/schemas/evidence.schema.json` v2。`node scripts/verify.mjs unit` 实际执行唯一 canonical `npm test`，其余 typecheck/bundle/doctor 同样执行并保存命令、exitCode、原始输出摘要、开始/结束时间、源码指纹和真实 Git commit。`node scripts/agent-task.mjs evidence <任务ID> <报告相对路径>` 只导入原始身份和结果，禁止 --passed/登记时盖新指纹。接受任务递归复验依赖、精确 CI workflow/run/attempt/head/success、独立审查原始 receipt JSON 结论；证据类型不能替换，设备确认不得由 CI 报告冒充。接受任务需要必需证据类型齐全、没有过期、独立审查。文档/控制投影不能自证业务功能。CI pass 不能替代用户授权合并或发布；没有截图不能声称 UI 验收。

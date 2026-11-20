# M-1 初始开发证据（未通过阶段验收）

基线提交：58ec99506e00a35121866580ffb28d09d5078b17；分支 agent/m-1-bootstrap。日期 2026-11-21 本地 / UTC 2026-11-20。本记录是历史事实，当前门禁由 agent-validate 对 source fingerprint 复核，不能将历史通过继承给变化后的源码。

## 实际修改

初始提交包含 53 文件：AGENTS/REVIEW/ROADMAP/PROGRESS、.agent 权威/投影/schema、恢复/检查点/状态机/验收脚本与 11 项故障测试、Expo Router 三个原生屏幕文件与主题、SDK58 配置/lock、Maestro flows、macOS CI/模拟器/IPA 脚本、架构/协议/安全/设计/测试/发布/ADR/源码研究与第三方通知。完整清单：git show --stat 58ec995。

## 实际运行

环境：Windows，Node v24.22.1、npm 11.19.1、Git 2.53.0.windows.2、GitHub CLI 2.95.0。现有 GitHub 授权可读写目标开发分支，不需要用户重新登录；没有读取/输出凭据值。

| 命令 | 真实结果 | 限制 |
| --- | --- | --- |
| npm test | 11 tests，11 pass，0 fail，0 skipped | 临时目录 fixture，不接触真实桌面数据 |
| npm run typecheck | exit 0 | 不等于 native 编译 |
| npx expo install --check | Dependencies are up to date | 固定于 package-lock 的 SDK58 组合 |
| node scripts/verify.mjs doctor | 20/20 checks passed，exit 0 | 不等于 native 编译 |
| node scripts/verify.mjs bundle | iOS 1132 modules，1.6 MB bundle，exit 0 | Windows JS export，未声称 iOS Simulator 成功 |
| npx expo prebuild --platform ios --no-install（Windows） | exit 1：Skipping generating iOS native project files；At least one platform must be enabled | 已识别平台限制；交 macOS CI 执行，不标通过 |
| bash -n / node --check CI 脚本 | 修复生成脚本字符串换行后通过 | 仅语法检查 |

详细初轮输出在 local-unit/typecheck/bundle/doctor.json，首次代码指纹不同于后续改动时会失效。初始 CI Windows checks 已在 44783585115 完成成功；macOS 尚在运行，实时状态见 control.ci 与 gh run view。

## 已完成的恢复故障用例

正常保存/投影重建；进程 exit 77 中断留下半写临时文件而旧权威完好；未提交源码保持；多写者 lock 拒绝且不删他人 lock；checksum/schema/status/cycle 拒绝；禁止跳过测试/审查和缺证完成；源码变化/报告篡改使证据失效；CI running/failed 持久恢复；Git HEAD/分支漂移可检测且不 reset；desktop/mobile 协议不匹配阻止后续阶段。

真正独立上下文交接已启动，尚未取得结果，不能算通过。独立功能审查与独立安全审查亦运行中，其准确任务标识在 control.delegates。

## 安全与未执行

未修改桌面和 Pi 本体；无远程 listener/网络请求/真实账户数据。只上传合成测试日志与未来模拟器截图；Actions contents:read，checkout 不保留凭据，固定 action SHA 与 Maestro zip SHA256。不创建/合并 main、不发布、不创建付费资源。空远端首次 push 后 GitHub 自动将开发分支设为默认分支；没有已有 main 可作为 PR 基线，因此暂未开 PR。

尚未执行/通过：macOS native 编译、真实 Liquid Glass 图审、Maestro 操作、iPad/深浅色/辅助功能、arm64 IPA/Framework 验证、SideStore 真机安装/刷新/覆盖升级、正式远程协议与业务功能。

## 回滚

远程功能尚未启用；可直接停止技术探针。代码回滚用新开发分支上的 git revert 58ec995（root commit 如需操作先复核），不得 reset/强推/删除原分支。停 CI 使用 gh run cancel <明确run>；保留已有日志和报告。当前不删除任何代码或产物。

结论：**M-1 进行中，不满足阶段完成条件。** 下一步读实际 macOS CI/审查结果、修复并重验，不向用户索取下一阶段提示词。

# 原生构建与分发

开发分支可按任务授权提交/推送/PR/运行 Actions。**main 合并、正式 Release/标签、修改已有发布、强推和付费须明确授权**；草案不是发布许可。

## 原生构建

[主 CI](../.github/workflows/native-infrastructure.yml) 是完整入口：需 [固定工具链](../README.md#开发入口)、macOS/Xcode、CocoaPods 1.16.2；Windows 不能构建原生 iOS。

在可丢弃 macOS checkout 中，按工作流的模板 fetch → `verify-template.py` → Expo prebuild → `configure-native.py` 生成 `ios/`；`npm run prebuild:ios` 单独不能替代完整性检查。设置 `RUNNER_TEMP` 为私有可写临时目录后：

```bash
bash scripts/ci/install-pods.sh
xcodebuild -workspace ios/PiGUIMobile.xcworkspace -scheme PiGUIMobile -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/simulator ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build
xcodebuild -workspace ios/PiGUIMobile.xcworkspace -scheme PiGUIMobile -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/device ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
bash scripts/ci/package-ipa.sh build/device/Build/Products/Release-iphoneos/PiGUIMobile.app
```

`install-pods.sh` 校验已审 Gem/Pod 锁及预编译清单，冻结 Bundler、使用 `pod install --deployment` 并启用 Split。依赖变化须从真实 macOS 候选审查更新，不手改锁/关校验。Xcode 找不到 Node 时按工作流设置 `NODE_BINARY`。

## IPA 与 SideStore

`package-ipa.sh` 在私有 staging 打包 `Payload/PiGUIMobile.app`，验证最终字节后写入 `artifacts/ipa/`。Simulator 与 iphoneos arm64 分别构建；unsigned IPA 须由用户重签。

拿到实际 IPA 后可独立重验（`IPA` 指向该文件，`OUT` 指向可写输出目录）：

```bash
python3 scripts/ci/verify-ipa.py "$IPA"
python3 scripts/ci/version-detect.py "$IPA" app.json "$OUT/version-report.json"
```

检查 SHA256、bundle 身份、Info.plist/权限/ATS、Mach-O 设备平台/arm64、Framework/资源与签名材料。`IPA_VERIFIED` 不证明 loader、重签或真机运行。身份/版本以 `app.json` 为准；artifact ZIP 与内部 IPA 的摘要是不同对象。

`ipa` job 验包后运行 `baseline-compat.py`、`sidestore-source.py`、`release-draft.py`，报告/source/Release 草案随 `unsigned-device-ipa-<run_id>` 上传。它们只生成文件，未来下载 URL 不代表已发布源。有基线才比较版本/身份/架构；无基线输出 `NO_BASELINE_FIRST_RELEASE`，不制造“候选减一”或升级通过。

所有软件、可行自动化/Simulator/IPA 验证及独立安全审查后，**仅由用户集中一次**执行 [最终设备清单](acceptance/M-1-device-checklist.md)：SideStore 安装/启动/刷新/覆盖升级、可用 iPhone/iPad 网络/权限兼容和 Keychain 重签/升级/撤销行为。此前 pending/unverified，CI/Simulator/IPA 不能代替设备结果；Agent 不登录 Apple/Tailscale 或代操作真机。

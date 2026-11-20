# ADR 0002 · 仓库与技术验证范围

日期：2026-11-21；状态：仓库/技术探针范围采用；原导航假设由用户第14条及 technology-stack.md 修订，Expo Router 不再是硬约束。工具链新组合仍待实际 CI 验证。

用户明确指定在 HYJ1817/pi-gui-ios 空仓库工作，因此逻辑应用名 pi-gui-mobile 与仓库名分别记录，不创建额外远端或擅改名。初始分支 agent/m-1-bootstrap；不创建/合并 main。

Expo npm registry 实测最新稳定为 58.0.26，blank-typescript SDK 58 模板 58.0.35；以模板和 expo install 解析兼容依赖，再锁 package-lock，不能逐个凭旧知识拼版本。原生 GlassEffect 需 iOS 26+；真实编译/渲染待 macOS-26 Runner 验证。macOS-26 官方 runner 清单有 Xcode 26.6/iOS 26.5 runtime，CI 实测为最终证据。

M-1 页面只做离线、合成原生探针，包含 native Stack、GlassView、ActionSheet、TextInput、Switch、滚动与无障碍，不提前实现远程业务。unsigned IPA 是编译方案，SideStore 安装始终独立人工门禁。

# 首轮 macOS CI 实际结果（历史证据，非通过）

Run 44783585115 / attempt 1，源码 58ec99506e00a35121866580ffb28d09d5078b17；实际终态 **cancelled**。因独立安全首审发现旧 IPA 暂存/上传边界有缺陷，且控制源码已变化，父 Agent 主动取消以阻止继续执行过期流程。不是测试断言失败，不能把取消包装成通过。

实际环境：macOS 26.7.2 (25G332)、Xcode 26.6 (17F113)、iOS Simulator runtime 26.5 (23F77)、Node v24.22.1、npm 11.19.1。环境与官方静态 runner 清单不同处以此次实际输出为准。

真实结果：

- Windows job 136452414242：success（npm ci/test/typecheck/Expo compatibility/iOS export）。
- macOS job 136453024100：CocoaPods 安装、Maestro cli-2.12.1 zip 校验及安装、Release arm64 Simulator build 成功。
- 构建日志于 2026-11-20T17:52:14.0311600Z 输出 `** BUILD SUCCEEDED **`；使用 iphonesimulator26.5 SDK。
- iPhone 自动验收步骤于 17:52:14Z 开始；17:52:43Z 请求取消，17:53:01Z 执行终止。未跑到可见的 Maestro 断言，无真实应用截图，故不推断渲染或交互成功。
- iPad、device arm64、IPA 和 SideStore 安装均未执行。

已实际下载 artifact 14655366727（名称 m-1-ios-44783585115，471821 bytes compressed）到忽略目录 artifacts/initial-44783585115 并读取分析。内容为 environment、simulator inventory、pods 和 simulator build 日志；没有 Payload、IPA、签名/配对材料或用户数据。未将这些旧原始日志再次提交；修复后只上传明确允许的安全结果、截图及通过检查的最终包。

实际 Pod 下载日志显示 RN/Hermes 使用 repo.reactnative.dev，并已有其 SHA1 sidecar 检查；它不能替代本项目要求的独立 SHA256 锁与 Podfile.lock。首轮未导出 Podfile.lock，下一轮必须用显式 bootstrap 收集真实候选锁，再核查落库并强制 deploy 一致，不能伪造原生锁。

下一步：完成 S1–S7 修复、定向回归、独立复审，使用新源码重跑安全 CI。旧 run 的成功子步骤仅是历史事实，不能满足新源码的 M-1 完成门禁。

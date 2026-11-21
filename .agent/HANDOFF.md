# Agent 交接（生成文件）

revision 37；权威摘要 115ef614accad81e1397a88e1ffe14f4b7a9a86876fa063476cf7b89ed3f4cda

先读 AGENTS.md / REVIEW.md，执行 node scripts/agent-resume.mjs --remote。

当前 M-1-infrastructure（M-1），预期分支 agent/m-1-bootstrap。

下一步：已集成7c6076e原生安全修复并完成ReactNavigation/Uniwind/Menu/Reanimated/Gesture/Keyboard探针迁移。T3当前main复核285558eb，13项核心不变，矩阵和增量证据已保存。本地最近完整回归123/123，另新增的隐私保护定向5/5通过；提交后须统一重验并导入新原始报告，再推送开发分支启动安全macOS bootstrap及独立复审。bootstrap预计exit78只产候选锁，不能算native/UI/IPA验收。

阻塞：S1 v2原始证据/类型/提交与递归门禁已实现，待精确提交独立复审；S2 IPA私有暂存/明确上传集合与脱敏诊断已实现，待独立复审及实际CI证明；S3 最终归档Mach-O/平台/签名/权限校验已实现，缺真实device IPA与独立复审；S4 工具版本和pipefail已实现，缺真实macOS候选锁/审核/locked构建；S5 symlink/junction普通文件边界已实现并回归，待独立复审；S6 完整schema与CI身份/状态导入已实现，待独立复审；S7 检查点先持久化/持锁修复/显式恢复和候选诊断已实现，待独立复审

检查点 .agent/checkpoints/v2-2026-11-21T03-58-47-770Z-838ea4ae-8dee-4c17-91dc-eff403d0069f.json；HEAD 7c6076e23fd21d69a87bd7f138849ed90630ecad。dirty（保存时）：
- M .agent/HANDOFF.md
-  M .agent/control.json
-  M .agent/state.json
-  M .agent/tasks.json
-  M .github/workflows/native-infrastructure.yml
-  M .gitignore
-  M .maestro/native.yaml
-  M PROGRESS.md
-  M app.json
-  D app/_layout.tsx
-  D app/diagnostics.tsx
-  D app/index.tsx
-  M docs/architecture.md
-  M docs/decisions/0003-native-build-integrity.md
-  M docs/decisions/technology-stack.md
-  M docs/design-system.md
-  M docs/testing.md
-  M package-lock.json
-  M package.json
-  M scripts/ci/collect-evidence.py
-  M scripts/ci/install-pods.sh
-  M scripts/ci/native-dependencies.py
-  M scripts/ci/simulator.sh
-  M scripts/ci/validate-locks.rb
-  M scripts/lib/control.mjs
-  M scripts/verify.mjs
-  M tests/control.test.mjs
-  M tests/ipa-integrity.test.mjs
-  M tsconfig.json
- ?? .agent/checkpoints/v2-2026-11-20T18-49-56-180Z-992fd4b2-e260-49d6-a707-a7478368bdd4.json
- ?? .agent/checkpoints/v2-2026-11-21T01-19-37-337Z-2a3895e4-a20a-44da-b047-eb1eb94f292c.json
- ?? App.tsx
- ?? docs/acceptance/t3-main-delta-285558eb.json
- ?? global.css
- ?? index.ts
- ?? metro.config.js
- ?? scripts/check-technology-stack.mjs
- ?? scripts/ci/safe-diagnostics.py
- ?? src/navigation/
- ?? src/screens/
- ?? src/uniwind-types.d.ts
- ?? tests/ci-diagnostics.test.mjs

CI：[{"id":"44783585115","head":"58ec99506e00a35121866580ffb28d09d5078b17","workflow":".github/workflows/native-infrastructure.yml","attempt":1,"status":"completed","conclusion":"cancelled","url":"https://github.com/HYJ1817/pi-gui-ios/actions/runs/44783585115"}]

独立任务：[{"taskId":"node:delegated-task:command%3Amcp%3Ac31b83bb-4e95-4301-8a91-f13f8295d85a%3Adelegate-task%3A4b75cf04-9360-469c-87e1-321a7e4b3149","role":"functional-review-and-fresh-handoff","status":"completed","sourceCommit":"58ec99506e00a35121866580ffb28d09d5078b17"},{"taskId":"node:delegated-task:command%3Amcp%3Ac31b83bb-4e95-4301-8a91-f13f8295d85a%3Adelegate-task%3Aff1f8e3d-e43a-47c2-ad8d-14c02bc295d0","role":"security-review","status":"completed","sourceCommit":"58ec99506e00a35121866580ffb28d09d5078b17"},{"taskId":"node:delegated-task:command%3Amcp%3Ac31b83bb-4e95-4301-8a91-f13f8295d85a%3Adelegate-task%3A7af46559-43da-4538-9daa-7eee427ab8c0","role":"native-ci-ipa-fix-isolated","status":"completed","sourceCommit":"26e122a6a7b090e0a850ff9f741b3f7bced896cd"}]

桌面 HYJ1817/pi-gui@af0432a0bc3b04c717a63ede3cc457e859401833，协议 未实现；移动协议 1。运行 resume 获取未通过门禁；不沿用聊天总结，不丢弃 dirty 修改。

# Pi GUI Mobile

面向 Windows Pi GUI 的 iPhone/iPad 原生客户端：React Native + Expo + TypeScript，仓库 `HYJ1817/pi-gui-ios`，应用名 `pi-gui-mobile`。

**当前 App 使用 synthetic runtime**：合成项目/会话、消息/脚本化回复、停止及审批经过 typed client/store/event stream，传输仅在进程内，不连接真实桌面或模型。真实配对、真实会话/消息及 live sync 仍属 **P3 待接线范围**；已有模块和历史阶段验收不代表生产就绪，见 [架构](docs/architecture.md)。

CI/Simulator、unsigned device IPA 结构验证与用户真机/SideStore 验收分别记录，不能互相替代。

## 开发入口

- 对齐 CI 的 **Node 24.22.1**；本地验证使用 npm 11.19.1，完整 JS 依赖由 `package-lock.json` 锁定。
- Python >=3.11；Windows 从 Git Bash 运行，测试需要真实 Bash。
- **Ruby 3.3.8 + Bundler 2.6.9**：`gem install bundler -v 2.6.9 --no-document`。Windows 锁安全测试使用真实 Ruby/Bundler/Psych，不需 CocoaPods。便携安装用 `RUBY` 指向 ruby.exe，配置 `GEM_HOME`/`GEM_PATH` 使该 Ruby 能加载精确 Bundler。

```bash
npm ci
npm test
npm run typecheck
npm run export:ios
```

`npm start` 启动 Metro；本地原生模块需原生构建。macOS/Pods/IPA 命令见 [构建与分发](docs/releasing.md)，CI 与证据见 [测试](docs/testing.md)。

Agent 先读 [AGENTS.md](AGENTS.md) / [REVIEW.md](REVIEW.md)，执行 `node scripts/agent-resume.mjs --remote`。`.agent/control.json` 是唯一任务/运行状态权威；[PROGRESS.md](PROGRESS.md) / `.agent/HANDOFF.md` 是生成视图，[ROADMAP.md](ROADMAP.md) 规定范围。历史 ADR/报告按其提交边界阅读。

安全边界见 [安全模型](docs/security.md)；最终由用户一次性执行 [设备清单](docs/acceptance/M-1-device-checklist.md)。没有 main 合并或正式发布授权。

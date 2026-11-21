# Pi GUI Mobile

独立 iPhone/iPad 原生客户端，连接 Windows Pi GUI。逻辑应用名 pi-gui-mobile；开发仓库按用户指定使用 HYJ1817/pi-gui-ios。

当前阶段见 [PROGRESS.md](PROGRESS.md)，完整范围见 [ROADMAP.md](ROADMAP.md)。新 Agent 先读 [AGENTS.md](AGENTS.md)、[REVIEW.md](REVIEW.md)，执行 node scripts/agent-resume.mjs --remote。仅输入“继续开发”即可按仓库控制层恢复。

本阶段为 M-1 离线基础设施探针，尚无真实桌面远程连接能力。不会暴露现有 localhost 后端。开发/测试/构建说明随实际验证更新；不声称 Simulator 或 unsigned IPA 等于 SideStore 真机验收。

## 本地验证工具

- Node 24.22.1 / npm 11.19.1，使用 `npm ci` 安装 JS 锁定依赖。
- Python >=3.11，用于真实 Mach-O、IPA、产物和安全边界的合成 fixture 检查。
- Windows 测试从 Git Bash 执行（或把 Git 的 bash.exe 加入当前进程 PATH）；shell/打包回归需要真实 Bash，不支持跳过。
- Ruby 3.3.8 + Bundler 2.6.9，用于直接运行 macOS 使用的 Bundler/Psych 锁文件解析器；不是 JS mock。Windows 可用官方 RubyInstaller 便携版，不需要 MSYS2/DevKit、CocoaPods 或修改系统 Ruby。便携版可用 `RUBY` 指向 ruby.exe、`GEM_HOME`/`GEM_PATH` 指向隔离 gem 目录；先安装精确 `bundler` 2.6.9（`gem install bundler -v 2.6.9 --no-document`）。CI 在 Windows 和 macOS 都安装固定版本，缺少运行时不会跳过安全测试。
- 测试唯一入口 `npm test`；定向可用 `node --test tests/native-locks.test.mjs`。本地通过不替代真实 macOS 解析、构建、Simulator 图审或 device IPA 验收。

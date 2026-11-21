# 架构工作稿

应用 pi-gui-mobile 位于用户指定 HYJ1817/pi-gui-ios 仓库。M-1 只有离线技术探针，不连接桌面、不读取真实会话。React Native + Expo；已按用户第14条迁移至 T3 同族 React Navigation 静态入口，并接入必要的 UniWind/菜单/手势/动画/键盘探针；Windows迁移检查不替代尚待完成的原生运行验证；原生 GlassView 只用于操作 chrome，正文采用系统实色表面。Windows 编译 JS/类型检查，GitHub 标准 macOS 编译 Simulator 和 device arm64。

目标：移动视图 → 类型化 remote client → TLS/独立远程网关 → 桌面现有领域服务 → Pi RPC（不改本体）。网关必须按操作/字段白名单投影，不能通用代理现有 HTTP、shell、文件系统、凭据服务。

T3 完整研究基线 068332c603ce5ca40ad5a96a09cffa34ebd05dff，继续时已复核当前main 285558eb1053d17f59ea8ecdf7c57999e92381f8，13项核心选型未变，差异见 technology-stack.md 与增量证据；早期 ccc1feb15572c422fbdce26ba6077b91459cfd47 仅保留为历史证据；桌面基线 af0432a0bc3b04c717a63ede3cc457e859401833。研究记录见 source-research.md。M0 冻结前安全和协议细节均是 proposal，不能声称已经实现。当前非阻断预研草案见 `docs/decisions/0005-remote-protocol-v1-proposal.md`；它不是冻结 ADR、实现计划许可或 M0 验收。

状态/恢复层：control.json 单一权威、SHA256 完整性信封、版本化 schema、原子写入、派生投影、Git/源码指纹、证据/检查点关联。见 decisions/0001-persistent-control.md。

# 架构工作稿

应用 pi-gui-mobile 位于用户指定 HYJ1817/pi-gui-ios 仓库。M-1 只有离线技术探针，不连接桌面、不读取真实会话。React Native + Expo Router 使用 UIKit 原生栈；原生 GlassView 只用于操作 chrome，正文采用系统实色表面。Windows 编译 JS/类型检查，GitHub 标准 macOS 编译 Simulator 和 device arm64。

目标：移动视图 → 类型化 remote client → TLS/独立远程网关 → 桌面现有领域服务 → Pi RPC（不改本体）。网关必须按操作/字段白名单投影，不能通用代理现有 HTTP、shell、文件系统、凭据服务。

T3 基线 ccc1feb15572c422fbdce26ba6077b91459cfd47；桌面基线 af0432a0bc3b04c717a63ede3cc457e859401833。研究记录见 source-research.md。M0 冻结前安全和协议细节均是 proposal，不能声称已经实现。

状态/恢复层：control.json 单一权威、SHA256 完整性信封、版本化 schema、原子写入、派生投影、Git/源码指纹、证据/检查点关联。见 decisions/0001-persistent-control.md。

# M0 远程协议与安全边界提案（未冻结）

状态：**proposal / non-gating design work**。为响应“不要继续卡在 M-1”的要求，先推进不依赖实现的 M0 架构准备；不改变权威任务状态、不绕过 ROADMAP 依赖、不代表 M0 已开始或通过。M-1 原生锁验证停止于 CI 44906133898/1 的 Pods prepare；M-1-device 尚未执行。本文不是已批准 API v1，也不授权桌面仓库改动、真机操作或业务实现。

## 依据与现有抽象

桌面只读基线：`HYJ1817/pi-gui@af0432a0bc3b04c717a63ede3cc457e859401833`。不得以桌面当前 dirty 工作区内容替代此固定基线。

- `server/auth.js:33-60`：本地 HTTP API 检查精确 loopback Origin 与 Electron 注入的 `PI_GUI_TOKEN`；缺 token 时是开发模式。该 token 不属于远程设备凭据，不能移动复用或透传。
- `server.js:1719,1875`（固定基线）由组合根创建 HTTP server 并绑定 loopback；`server/router.js:176-187` 统一认证后再分派 `/api/*` 与全局 `/api/events`。目前没有单独的移动远程入口；这需要 M0 先确认独立 listener/handler 的装配边界，而不是把现有 listener 暴露到 LAN。
- `server/projects.js` 与 `server/sessions.js`：项目由桌面登记；会话归属按会话头中的 cwd 校验，列表/历史访问不能仅凭客户端提供的绝对路径或文件名。
- `server/runtime-registry.js:7-14,90-112`：并行 runtime 身份绑定 backend、项目/仓库/workspace epoch、conversation 与 runtime generation/session；旧 owner 会被拒绝。这些内部身份只供桌面校验，不应作为可伪造的客户端授权声明。`server/router.js` 同时保留 Classic owner 请求校验与 Runtime 路由；两者不可假定互换。
- `server/sse.js:15-29,82-124`：已有 SSE 使用序号、有限 backlog、连接预算和 snapshot。远程端只能投影经授权的事件，不能把当前全局事件流原样公开。
- `public/approval-model.js`：审批事实来源是 Pi `extension_ui_request` 的 id 与方法；协议没有结构化风险/作用域字段时保持 unknown/null。Classic approval scope 和 Runtime owner 绑定需要分别适配；移动端不能自行增加审批语义或绕过 Pi 的应答通道。
- 研究背景与更广的桌面/移动接缝见 `docs/source-research.md`；跨仓库协议仍未实现，本文只提出待审合同。

## 拟定边界

```text
Pi GUI Mobile
  -> 类型化 remote client（只发送闭集 operation / resource id）
  -> 独立 Remote Gateway（TLS、设备身份、速率/重放/撤销、字段投影）
  -> 桌面既有项目/会话/runtime/approval 服务
  -> 既有 Pi stdio RPC bridge
```

禁止形成 `mobile -> 现有本地 HTTP/WebSocket -> 通用转发`、通用 Pi RPC proxy、shell/file API、任意 endpoint/header/query forwarding 或模型供应商代理。Pi 仍由桌面启动与持有；移动端不直接启动 Pi、不接触 `PI_GUI_TOKEN`、模型 API key、OAuth token、PI 进程环境或原始日志。

## 建议的协议结构

| 面 | 初步资源/操作 | 约束 |
|---|---|---|
| 协商 | `GET /remote/v1/manifest` | 返回协议版本、桌面能力闭集与服务身份，不含路径、凭据或运行环境原文；版本不匹配 fail closed。 |
| 配对 | 创建一次性配对 ticket、显式确认设备、查询/撤销设备 | 仅桌面本地用户主动打开远程开关后允许；ticket 短有效期、单次消费；并发消费只有一个成功。设备有独立身份、最小 scope、可单独撤销。 |
| 项目 | 列表、选定项目摘要 | 客户端只传 opaque project id；桌面从登记表解析路径。没有任意路径列举/读取。 |
| 会话 | 列表、打开、创建/聚焦、历史快照 | 每次请求由桌面重验项目与 session 所有权、workspace epoch 和 runtime owner；跨项目/已过期 owner 拒绝。只返回字段白名单。 |
| 实时 | 有界事件流、游标续传、快照重置 | 单调 revision/sequence；断线补发、间隙与过期游标返回显式 reset；每条事件按设备 scope 与当前资源 owner 投影。不得透传原始 SSE。 |
| 对话控制 | 发送消息、停止 | 仅显式闭集操作；由桌面现有 admission/stop 屏障处理。没有通用 `command`、任意 Pi RPC 或文件/终端操作。 |
| 审批 | 读取待处理请求、应答指定请求 id | 只允许当前 owner 下真实 pending 的 `extension_ui_request`；一次性应答、超时/取消/撤销后拒绝；method 与 payload 遵循 Pi 原协议。无证据的 risk/scope 保持 unknown。 |

Scope 候选（需在 M0 逐项定稿）：`projects.read`、`sessions.read`、`chat.send`、`chat.stop`、`approvals.respond`。配对默认只给读取能力；发送/停止/审批分别由桌面用户明确启用，不能通过一个“全权限”布尔值隐式扩大。服务端每次操作再次检查 scope 与资源归属，客户端按钮状态不是授权。

## 身份、TLS、重放与撤销（待 M0 选型）

最低合同：远程连接必须 TLS；配对凭证按设备区分、短效/可轮换/可撤销；请求具备唯一 request id、时效与防重放；服务端使用有界重放窗口并对并发配对/请求做原子判定；速率与并发连接有上限。日志仅记录固定 reason、设备内部不透明 id 的不可逆短摘要和操作类别，不记录 pairing code、凭据、查询、正文、绝对路径或原始错误。

候选方案是移动端生成设备密钥、桌面登记公钥，使用 method/path/body digest/timestamp/nonce 的签名请求；密钥保存在 iOS Keychain/SecureStore，服务端维护有界 nonce 使用记录。TLS 身份绑定、证书引导、桌面重启时设备记录持久性、Windows 存储 ACL 与密钥备份/恢复均未验证，**此候选不是已选定方案**。不得使用公网中继或需要付费/Apple 会员的方案；若免费 Tailscale HTTPS 是唯一可接受候选，须先记录依赖与限制并在 M5 实证。

撤销在桌面是权威状态：原子标记设备撤销，拒绝所有新请求，关闭该设备的 SSE/长连接并使待处理配对/请求失效。撤销与正在处理的写操作之间的线性化点、进程重启及多设备竞态要由负向测试确定。

## 拒绝条件与安全不变量

1. 远程默认关闭；切换开关只监听 loopback 本地管理面，不能通过远程接口开启自身。
2. 本地 `/api/*` 的 Origin + 本地 token 规则保持不变。远程认证使用独立 listener/handler 与独立凭证存储。
3. 未知协议版本、字段、operation、scope、事件种类、资源归属、设备身份、工作区 epoch、游标连续性或撤销状态一律拒绝/重同步，不降级成通用转发。
4. 无客户端文件路径；项目/会话 id 只由桌面解析。每次访问都验证规范目录、登记状态和所属项目。
5. 不序列化原始 Pi/RPC/SSE payload；所有请求与响应经过类型化白名单，敏感配置和凭据永不进入投影。
6. 审批始终由 Pi 原生 request/response 与现有桌面 owner 检查完成；远程不引入第二套审批真相。
7. 设备撤销立即断流；退出/禁用/本地开关关闭后 listener 不再接受连接。

## M0 尚须补证的决策

- 从固定桌面基线确认哪个 composition root 可以装配独立远程 listener，而不侵入或重写现有认证/router。
- 项目、Classic 会话和 Runtime conversation 的共同资源标识，以及现有 endpoint 的 owner/写入语义映射；任何缺少稳定来源的能力留作 unknown。
- API v1 的精确 schema、字段上限、游标/reset 语义、速率/并发/时限、设备 key 生命周期、撤销线性化点、错误码与兼容升级策略。
- TLS/证书引导与免费私网连接方案；Windows 单用户 ACL；iOS SecureStore 在 SideStore 重签/升级时的生命周期。
- 审批在旧 Classic 路径与 Runtime Registry 的覆盖差异；不得仅凭存在 `/api/command` 推断所有调用都有同等 admission。
- fixture 集成和 threat model；安全审查应覆盖伪造/重放/跨项目访问/epoch 漂移/并发配对/撤销竞态/过期审批/日志泄漏。

## 阶段状态与允许动作

当前正式状态仍为 M-1 blocked；M-1-device 和 M0 依赖不改写。此文只完成架构预研草案，**不冻结 API v1、不启动正式远程实现、不形成 M0 验收证据**。先恢复 M-1 原生候选验证或由负责人重新调整路线；M0 需在依赖与独立安全审查通过后才能冻结。桌面实现仍须独立工作区、准确 commit、桌面自身测试与审查，绝不修改当前桌面 dirty 工作区。

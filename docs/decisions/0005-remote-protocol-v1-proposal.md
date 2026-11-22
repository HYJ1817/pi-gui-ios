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
| 协商 | 仅 versioned route（`/remote/v1/...`） | 无 manifest；未知 major version/path 一律 fail closed。服务身份由配对引导信道的 pin 提供，不经远程端点。 |
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

## 现有桌面接口/owner 映射（source-grounded，非远程 API）

固定 commit `af0432a0bc3b04c717a63ede3cc457e859401833` 的接口只能作为桌面内部能力证据，不可直接作为移动协议：

| 固定源码 | 已观察到的桌面语义 | M0 远程设计约束 |
|---|---|---|
| `server/auth.js:33-60` | loopback Origin + Electron 注入 token；空 token 是本地开发模式 | 远程必须单独设备身份/认证，不借用本地 token，不把它发给移动端 |
| `server.js:1719,1875`; `server/router.js:176-187` | 组合根绑定 `127.0.0.1`；`/api/*` 先统一本地鉴权；`/api/events` 接共享事件总线 | 当前请求入口不提供远程认证、设备 scope 或事件隔离，不能改绑 LAN 或作通用反向代理 |
| `server/projects.js:155-174` | 经典项目激活会更改共享 cwd、写桌面项目清单并重启 Pi | 远程选择项目不能暗中改桌面全局活动项目；首期要么绑定独立 Runtime conversation，要么明确拒绝会重启/改全局 cwd 的动作 |
| `server/sessions.js:392-413,480-493,761-765` | 列表只接受桌面已登记项目；会话定位重新读取元数据并核对 cwd；客户端稳定 ID 不等于路径 | 移动请求只传 opaque id；每次调用由桌面重解析且复验登记、cwd、session header 和 owner，禁止接受路径/文件名 |
| `server/runtime-registry.js:7-18,90-115,512-567` | 命令类型闭集；owner 含 backend/project/repo/workspace epoch/conversation/runtime generation/session；过期 owner 返回 stale；审批应答受 pending/owner 与 admission 约束 | 远程不是 `/api/command` 隧道；只做经 desktop service 验证的 typed operation，scope 和完整 owner 在每次请求上绑定，审批 id 单次消费 |
| `server/sse.js:15-29,82-127` | 序号、backlog、全局订阅和 bridge snapshot，且没有设备 ACL 参数 | 远程事件必须在发布前按设备/资源授权投影，设备断开/撤销时移除对应订阅，不能订阅全局 SSE 后转发 |
| `public/approval-model.js:1-31,73-115` | 只有 Pi 实际发出的 Extension UI dialog 才形成审批；risk/scope 没有结构化来源 | 远程确认只是把人的选择转交给原请求，不等于工具沙箱或通用权限审批；无结构化事实时保持 unknown |

需要特别保守的是 Classic 与 Runtime 两套 owner：Classic 以单一 runtime cwd + session header 证明归属；Runtime owner 是绑定 backend instance/workspace epoch/conversation/runtime generation 的闭集对象。不能把其中一套的身份字段复制到另一套，不能在桌面切换/重启后沿用旧 owner。对无法证明的 Classic 远程写入应拒绝，而不是从客户端补足字段。

## 初步威胁模型（供独立审查修改，不是已批准结论）

**资产**：设备私钥/配对 ticket/设备撤销表；桌面已登记项目路径、会话元数据与历史；运行中的 Pi 对话和工具 UI 请求；审批 pending id；事件游标/快照；本地桌面 token、模型/OAuth 凭据（均不应进入远程面）；权限/拒绝审计记录。

**信任区域**：移动端与任意网络视为不可信；远程 Gateway 仅在用户本机开启后接收连接；桌面领域服务负责最终资源/owner/operation 授权；Pi RPC 仍是对话和 Extension UI 请求的权威。系统同用户进程/恶意本机管理员不属于本协议可消除的信任边界。

| 威胁 | 预期缓解 | 必须有的反例测试 |
|---|---|---|
| 未配对 LAN 客户端、跨站浏览器、伪造 Origin | 远程 listener 独立于 loopback listener；TLS + 每设备密钥证明；绑定允许的 host/service identity；Origin 不作为移动客户端身份凭证 | 无凭据、错误证书/主机、错误 method/path/body 签名均拒绝；本地 `/api` 原鉴权继续拒绝 |
| 配对码被拍照/并发重放 | 短效、单次 ticket；桌面本地确认设备名/能力；原子 consume；ticket 只以摘要存储 | 两请求并发兑换仅一个成功；过期/已消费/ticket 摘要损坏拒绝；不记录明文码 |
| 被盗设备、撤销竞态 | 每设备独立 scope 与密钥；撤销是桌面权威事务；关闭该设备全部 SSE 并拒绝新请求；执行中副作用的撤销线性化点另定 | 撤销后新/并发/复连全部拒绝；不影响其他设备；进程重启后仍有效 |
| confused deputy / 跨项目或跨会话 IDOR | opaque id + 服务端项目登记、session header、workspace epoch 与 full owner 再验证；不接受路径、不接受客户端声明的 owner | A 项目设备猜测 B 会话、旧 epoch、Classic/Runtime owner 混用全部拒绝且不调用 Pi/文件 API |
| 重复发送 prompt/Stop 请求 | request id + 时效/nonce/replay window；写操作 idempotency 行为按语义明示；复用桌面已有 stop barrier/admission | 相同 nonce 重放、并发相同 operation、旧 bridge generation 不产生重复副作用 |
| 非授权事件/历史泄漏 | 资源 owner 过滤先于事件序列化；projection allowlist；按设备隔离 cursor/backlog；snapshot 同样过滤 | 另一项目运行、全局事件、未知事件字段和过期游标不得跨 scope 返回；reset 不丢权限检查 |
| 陈旧/伪造审批 | 服务端查原始 pending dialog 的 request id、Pi method、owner、到期/撤销状态；只转发允许的原生 payload | 双应答、超时后应答、切会话后旧 owner 应答、未知 id 均 fail closed；从不产生“总是允许” |
| 资源耗尽/协议降级 | 请求体/帧/队列/连接数上限、速率限制、超时；未知版本/字段/operation 拒绝，不回退到 local API | 超限、恶意慢客户端、未知协议 major、未知字段和游标回退不会扩大授权或拖垮桌面 |
| 诊断与缓存泄漏 | 固定错误码、最少字段、不给客户端路径/PI token/原始日志；移动快照按 owner/设备缓存、撤销或 owner 变更立刻失效 | synthetic secret marker 扫描响应/日志/截图/缓存；设备 A 数据从 B 账号无法读取 |

## 初始 v1 功能边界候选

为了先实现闭环而非通用远控，建议 M0 评估一个窄的首版：项目清单只返回不透明 id 与安全展示名；列出/创建一个**独立 Runtime conversation**；snapshot + 有界游标事件；发送 prompt、确认 Stop、转接真实 pending Extension dialog。初版不支持 Classic `activatePath` 远程调用、不接受任意 shell/file/process/MCP/provider-config 命令、不支持写项目文件、不提供通用 RPC。若既有 Runtime APIs 不能实现其中某项而不破坏 owner/admission，则删去该项或先补桌面端契约，不另建旁路。

此候选需要在 M0 通过桌面实现/fixture 对照：Runtime conversation 创建是否会写登记文件、项目列表是否泄露路径、事件是否能按 owner 安全投影、审批应答是否可以由移动端发起且仍经过现有服务端 pending 验证。未从固定源码确认的细节仍标为待证。

## M0 尚须补证的决策

- 从固定桌面基线确认哪个 composition root 可以装配独立远程 listener，而不侵入或重写现有认证/router。
- 项目、Classic 会话和 Runtime conversation 的共同资源标识，以及现有 endpoint 的 owner/写入语义映射；任何缺少稳定来源的能力留作 unknown。
- API v1 的精确 schema、字段上限、游标/reset 语义、速率/并发/时限、设备 key 生命周期、撤销线性化点、错误码与兼容升级策略。
- TLS/证书引导与免费私网连接方案；Windows 单用户 ACL；iOS SecureStore 在 SideStore 重签/升级时的生命周期。
- 审批在旧 Classic 路径与 Runtime Registry 的覆盖差异；不得仅凭存在 `/api/command` 推断所有调用都有同等 admission。
- fixture 集成和 threat model；安全审查应覆盖伪造/重放/跨项目访问/epoch 漂移/并发配对/撤销竞态/过期审批/日志泄漏。

## 设计收敛（machine contract 草案）

以上威胁模型与候选已收敛为机器可读合同 `docs/contracts/remote-v1.json`（status=`design-contract`），并由 `scripts/lib/remote-protocol-contract.mjs` + `tests/remote-contract.test.mjs`（33 项，`verify.mjs protocol-contract`）提供合成测试。该合同**仍是设计合同**：不冻结 API、不代表独立安全审查通过、不授权 M1 实现。权威签名消息与当前语义以 `docs/contracts/remote-v1.json` 为准（本条是叙述性摘要）。当前固定的设计点：

- **传输与身份**：独立 listener + HTTPS；不修改现有 `/api` 的 loopback+token 规则；远程默认关闭、只能由本机本地管理面开启（`remoteSetting`、`localAdminControl`）。
- **配对**：POST 单次配对交换，6 位码 + `pairingSessionId` + Ed25519 设备密钥证明（`proofSignature` 签名 `remote-v1-pair\n` 域分隔消息）+ `serviceFingerprint`；默认仅授予读取 scope，写 scope 需桌面用户逐项启用；限 `maxPendingPairings`/`maxDevices`、原子消费、率限。
- **签名请求**：7 个签名头（device/epoch/request-id/timestamp/nonce/body-sha256/signature，另有固定 content-type/accept 规则），消息 = `version\ndeviceId\nserviceId\nreplayEpoch\nrequestId\nMETHOD\npath?canonicalQuery\ntimestamp\nnonce\nbodySha256`（权威定义见 `signedRequest.signedMessage`）；Ed25519；`signatureClockSkewSeconds=60`；每设备原子 nonce 存储 + 单调 acceptedTimestampFloor（replay 容量/掉状态 fail-closed，跨 skew 窗口保留）。版本协商仅 versioned route（无 manifest）。
- **操作闭集（8 个）**：`GET projects`、`GET projects/{projectId}/sessions`、`POST projects/{projectId}/conversations`、`GET conversations/{conversationId}/snapshot`、`POST messages`、`POST stop`、`GET approvals`、`POST approvals/{requestId}/respond`。路径参数只接受不透明 ID 模式；POST body 必须是 canonical JSON（排序键、紧凑分隔符）以便 body digest 可验。
- **事件流**：单设备 cursor、6 种闭集事件（`snapshot/message.append/conversation.status/approval.pending/approval.settled/reset`），gap→显式 reset，per-device backlog 上限，`mustFilterByCurrentResourceOwner` 与 `mustRevalidateAuthorizationBeforeReplay` 为合同要求。
- **错误码闭集（17 个）**：`unauthorized/pairing_*/rate_limited/scope_denied/stale_owner/stale_revision/unknown_resource/operation_rejected/replay_rejected/sequence_gap/server_busy/unavailable/invalid_request/payload_invalid/internal_error`（`cursor_expired` 仅为 reset reason，不再是 wire error）；不允许回传原始错误文本/路径/凭据。
- **Scope 词表（7 项）**：`projects.read / sessions.read / sessions.create / chat.send / chat.stop / approvals.read / approvals.respond`；服务端每次操作重验 scope 与 owner。

**桌面装配点（worktree 对照，非改动授权）**：在干净 worktree `C:/pi-GUI-remote-protocol`（`feat/mobile-remote-protocol-v1` @ `3850e781`，main CI 44918456748 通过）上复核组合根。装配候选仍是 `server.js` 组合根处新增第二个 HTTP server（独立 listener、独立 router、不共享本地 `auth.js` token 路径），与 `af0432a0` 基线 `server.js:1719,1875` 一致；不改动现有 `/api/*` 分派。桌面仓库未做任何提交。该 worktree 的 `npm test` 在本机 Windows 有 3 个 `prepareCredentialStorage` 环境性失败（Windows 权限语义，与远程工作无关），记录为 deferred/unverified。

**仍为 unknown（不得视为已选）**：TLS 证书引导/自签 vs Tailscale HTTPS（pinned-fingerprint 已定为合同要求，但具体证书/私网引导方案未定）；iOS SecureStore 在 SideStore 重签下的密钥生命周期；设备记录在 Windows 上的 ACL 与重启持久性；审批在 Classic vs Runtime 两条路径的最终覆盖差异；独立功能审查与独立安全审查证据（工具缺失时按边界记为 pending，不伪造）。

**独立评审后的加固（contract 当前内容，非额外承诺）**：首轮独立功能/安全评审均以 fail 返四，已按发现补齐——transport.tls 改为强制 bootstrap 指纹 pin（拒绝 hostname-only），QR 同时携带 TLS 指纹与桌面 Ed25519 服务公钥用于配对应答验签；`deviceGrants` 服务端设备→资源授予（default-deny，列表过滤，原子准入复检 device/scope/grant/owner/revision）；事件帧签名 + 每事件 scope（approval.* 要 `approvals.read`）+ cursor 绑定 (deviceId, streamGeneration, serviceId)；`projectionPolicy` 自由文本值级泄漏扫描；approvals.respond 方法×决策×value 矩阵；signed message 绑定 deviceId+serviceId；严格 UTF-8/重复参数/cursor 语法；nonce 保留跨 skew 窗口且容量/掉状态 fail-closed；pairing 会话预校验先于本地确认、预算/原子消费/应答新鲜度；幂等 client id 语义；pre-auth 统一 `unauthorized` 闭合映射；版本仅走 versioned route。仍待独立复审确认修复有效。

## 阶段状态与允许动作

负责人已授权对 M0 做 **design-only** 例外推进；这只表示可以在 M-1 尚未完成时读双方源码、收敛 proposal、威胁模型与合同草案。正式依赖仍未满足：M-1-infrastructure = blocked，M-1-device = pending；M0 不得据此标记 accepted/completed。只有 M0 所需 protocol/unit/独立功能/安全审查证据满足后，才可考虑 M1 实现。此草案不冻结 API v1、不授权 M1 实现，不改动桌面 dirty 工作区。

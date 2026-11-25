# ADR 0011 · M5 原生 pinned HTTPS/SSE 与 Tailscale 私网入口

日期：2026-11-25。状态：proposed；实现、macOS/iOS 构建、跨仓库集成与独立功能/安全审查前不启用真实连接。

## 依据与范围

负责人在 M4 完成后授权启动 M5。移动基线 6cab5c61e5bbc5250922c45d2f769a23bf4e4114；桌面基线 HYJ1817/pi-gui 的 feat/mobile-remote-protocol-v1@74d252f57554dca33245f7d0050e8ead310ec124。两端冻结 remote-v1 契约逐字节相同。ADR 0010 的秘密 cursor MAC、随机代际盐、授权转换使 cursor 空间失效、首帧连续性与连接状态要求一并落实。

恢复时 M4 及其 M0–M3 递归依赖的实际 gate 均为空；M-1-infrastructure 的旧证据已失效，按既有状态机回 testing。不得据旧 completed 标签宣称新原生实现通过。M-1 无新增依赖边；软件准备按 ADR 0006 继续，最终仍须补原生与安装证据。

## 决策

1. 首选官方 Tailscale 系统客户端承载网络，保留 remote-v1 自有端到端 TLS。桌面只可绑定回环或明确的 tailnet IP；不绑定通配地址，不暴露原有 /api。若使用转发，仅转发固定 TLS 端口的原始 TCP，不能用 HTTPS 终止替换服务证书。具体部署不在 CI/Agent 中登录、启用或改写真实 Tailscale 配置。
2. 暂不新增 libtailscale、WireGuardKit、Go 运行时或 Network Extension。官方 libtailscale/Swift（BSD-3-Clause）确有用户态路径，但会增加二进制、状态密钥、前后台恢复及依赖审查范围；仅在确需避免系统 VPN 与 SideStore LocalDevVPN 冲突时另行验证。参考：tailscale.com/docs/features/tsnet、github.com/tailscale/libtailscale/tree/main/swift、tailscale.com/docs/reference/faq/other-vpns、docs.sidestore.io/docs/installation/install。
3. 移动原生适配器使用已有 ExpoModulesCore 桥接 Apple Foundation、Network、Security、CryptoKit；无新增第三方密码库。设备 Ed25519 私钥由原生生成并保存在 ThisDeviceOnly Keychain，永不经过 JS；JS 只持有随机的本机 profile handle、设备公钥和合同元数据。配对草稿有界、短效、单次消费，失败不持久化凭据。
4. 每条 Network.framework TLS 连接绑定一个可信 bootstrap endpoint、证书 SHA-256 和服务 Ed25519 公钥，显式关闭 TLS session resumption/false start/renegotiation。理由：URLSession 不能直接保证每次恢复连接都重新提供对端证书，不能用 hostname/旧会话缓存替代逐连接 pin。TLS 验证在发送 HTTP 字节之前完成；仅提供固定 HTTP/1.1 remote-v1 请求和有界 Content-Length/chunked 响应解析，不实现通用 HTTP 客户端。拒绝重定向、Cookie、认证挑战降级及通用 URL/代理能力。所有网络原始错误投影成闭集本地错误。
5. endpoint 仅允许完整 *.ts.net 名称或 Tailscale IPv4/IPv6 地址；拒绝 userinfo、query、fragment、非根 base path、通配地址、任意公网/LAN 主机。合成回环测试仅在独立测试构建中允许，不成为生产开关。
6. TLS pin 仍是证书 DER 的 SHA-256，不改为 hostname/CA/SPKI。证书或服务公钥变化必须由本机用户重新配对；不静默更新。先以原生探针验证当前 Ed25519 TLS 证书；若平台不兼容，只能显式处理 TLS 身份迁移，业务 Ed25519 签名与双 pin 继续保留。不得全局开启 ATS arbitrary loads。
7. HTTPS 请求保留 canonical UTF-8 原始 body、method 和 path/query。SSE 严格增量解析 UTF-8 和完整帧，有界缓冲；注释心跳不推进 cursor。传输已连通与流已验签是不同状态；快照水位线约束首个普通事件，重连必须重新签名。网络层不盲重试 mutation。
8. 默认没有可用生产 profile，也不在 App 启动时自动连接。独立安全审查前只运行临时 synthetic fixture；App 原有离线演示保持可用。安全相关未验证项不能由普通环境延期规则替代。

## 桌面配合

- 秘密随机 cursor MAC key 与进程代际绑定；reset 为每订阅瞬时帧，不写共享 journal。
- emission 按设备实时 scope/owner 过滤，不为静态未授权资源消费序号；投递/重放复检失败立即 reset，不跳帧。
- grant、owner、revoke、re-pair 均使旧 cursor 空间失效；过期设备即使没有新事件也关闭长连接。
- 本机管理面提供完整可信 bootstrap，不新增远程 manifest；短效码只一次性显示。
- 原生自动传输头与 desktop 闭集解析先做真实字节兼容检查，不放宽重复签名头、未知路由或任意业务字段限制。

## 验证与剩余门禁

按 npm test 唯一入口补负向与跨仓库真实 TLS 合成测试；原生核心在标准 macOS Runner 编译/运行，Simulator/unsigned IPA 使用既有锁与隐私/权限验证。新增本地 Expo 源码 pod 的锁必须来自真实 macOS pod install 候选并经独立审查，不手写伪造解析结果、不关闭部署锁。

真实 tailnet 登录/异地连通、真机网络切换/性能与 SideStore 刷新/覆盖升级均保持 pending/unverified；真机只在 M6 软件与安全审查完成后的最终一次清单执行。本 ADR、合成测试或 Simulator 不能代替设备结果。M5 不因软件准备完成而自动 accepted/completed。

回滚：删除未启用的生产 profile/禁用连接入口，回退各仓库对应原子提交；不更改已配对设备的 pin，不恢复已撤销凭据，不修改桌面本地 HTTP token 与主 listener。

## 第二轮审查补救（2026-11-25，桌面 b67adb4d / 移动 ee07785）

第二轮独立审查（功能+安全）确认第一轮全部修复为 CONFIRMED-FIXED，并发现新一轮缺陷。补救（每案均由审查实证驱动）：

1. **撤销复位帧缺失（重要）**：`dropDevice` 此前裸关闭订阅，契约 deviceLifecycle.revocation 要求的 `reset(authorization_changed)` 从未上链路。修复：每个订阅在关闭前恰好收到一帧复位（bypass 写入——这是唯一一帧因授权死亡而必须送达的帧）。回归钉死于 remote-gateway。
2. **重放连续性（重要）**：`authorizeResource` 的 owner-revision 精确相等复检误杀契约重放快路径——revision 在帧入日志后合法前进，而一切授权承载转换已按代际全域失效游标。移除精确相等复检；epoch-invalidation 仍是唯一授权语义。回归钉死：revision 前进后重放不复位、授权转换仍复位。
3. **游标表分歧**：桌面实现外来游标走复位路径（与网关测试一致），移动沙盒拒绝 malformed。严格语法拒绝实验曾造成网关套件挂起，已回退并记录分歧——这是审查流程真实抓获"修复引入回归"的第二例。
4. **device_inactive 词表泄漏**：listener 映射经 wireErrorCode（unauthorized）。
5. **owner epoch 持久化**：RegistryClock epochs 落盘，重启不再回归 1（重放保护下限）；4096 上限驱逐窗口已在安全审查中评估。
6. **不可物化重放**：日志中超大/不可签名帧重放时先 reset(sequence_gap) 再关闭——裸关闭曾让客户端无限盲重连。
7. **移动端配对语义**：pairing_expired 不再塌陷为可重试 pairing_rejected。

**延期（诚实记录于 docs/acceptance/m5-deferred-items.md）**：生产发布管线空壳（IMPORTANT-2，组成根未接线 stream.publish、domain 消息列表硬编码空）、合同副本字节漂移风险、证书轮换、配对预算顺序（评估后接受为设计）。


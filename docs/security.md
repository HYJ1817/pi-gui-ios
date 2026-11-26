# 安全边界

当前 App 仅为 [synthetic runtime](architecture.md)；P3 尚未接通生产链路。`SyntheticCryptoProvider` 的确定性材料只能测试，不能用于生产配对。原生 HTTPS/SSE/Keychain 准备代码存在不等于已启用。

真实远程能力必须保持以下边界：

- 桌面本机用户主动启用，默认关闭；独立 listener/route/credentials，不把整个 localhost HTTP/WebSocket 绑定到通配地址或代理公开，不开放任意 shell/文件/通用 RPC。
- Tailscale 私网只提供网络可达性，不能替代 TLS 与应用鉴权。原生边界限制 tailnet endpoint，逐连接验证证书 pin 和服务身份；拒绝任意证书、静默 pin 更新、重定向及全局 ATS 放开，身份变化须重新配对。
- 一次性短效配对、每设备身份和最小 scope；请求签名/重放防护、项目/会话归属、owner/revision 和审批授权逐项校验。撤销立即阻止新请求并关闭连接，重连不得恢复已撤销授权；未知协议/字段/身份状态 fail closed。
- 私钥不经过 JS；原生准备用 ThisDeviceOnly Keychain，JS 仅持 handle、公钥/合同元数据，不能声称已集成 SecureStore。不发送模型 API Key、OAuth Token、`PI_GUI_TOKEN`、原始错误/配置/环境变量；长效秘密不放 URL，不绕过桌面审批。
- 请求/响应/事件有白名单与大小、队列/连接预算；畸形输入、过期/重复审批、慢客户端和重连不能突破权限、泄漏数据或造成无界缓冲。协议变化须记录 ADR、双方提交及集成证据。

安全验证须包含过期/并发/重复配对、签名与重放、跨设备/项目/会话越权、撤销竞态、旧审批、超限输入、背压、TLS/端点替换和日志泄密等负向用例。独立安全审查与真实集成证据不足时，可继续默认关闭的隔离准备，不能启用或验收高风险功能；普通环境延期规则不能降低这些断言。

测试仅用临时 synthetic fixtures，不写真实会话/设置。公开日志/CI 仅含合成数据、闭合事件码/类型/计数，不含 payload、真实路径、异常 message、设备标识、配对码、密钥或用户日志。哈希不等于脱敏或防恶意写入签名，见 [持久化规则](testing.md#证据持久化)。CI 不注入模型/Apple 账户或签名材料，不扩大 token 权限。

真实 Tailscale/SideStore 网络、重签/升级/撤销行为留在 [最终一次用户设备验收](acceptance/M-1-device-checklist.md)；未执行保持 pending/unverified，Simulator/原生探针/IPA 不能代替。

# 安全模型与威胁清单

高权限桌面是信任边界。第一阶段仅 Tailscale 私网 + TLS；Tailscale 不替代应用鉴权。默认关闭，桌面主动启用；独立 listener/route/credentials；不暴露整个 localhost backend。设备在有限项目/会话范围获得最小权限，撤销立即阻止请求并断连。

必须验：并发/过期/重复配对、窃取/重放请求、跨设备/项目/会话越权、旧 revision/审批、撤销竞态、畸形/超长 payload、慢连接/背压、TLS 错误、DNS/端点替换、日志与产物泄密。协议不匹配拒绝。不允许接受任何证书、禁止全局 ATS 放开、禁止把长效秘密放 URL。

移动凭据保存在 SecureStore；不传模型 API Key、OAuth Token、桌面内部 token。日志只记闭合事件码/类型/计数，不记 payload、真实路径或异常 message。CI 只用 fixtures，不注入模型账户、Apple 身份、签名私钥或配对信息。

M-1 离线探针不实现网络开关或配对。M0 定稿后由独立安全 Agent 检查；M1 认证隔离及撤销任务缺少独立审查不能 completed。

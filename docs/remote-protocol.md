# Remote API v1 · M0 冻结合同，实现随任务推进

> 权威定义：`docs/contracts/remote-v1.json`（status `frozen-v1`）+ 参考验证器 `scripts/lib/remote-protocol-contract.mjs` + 33 项合成测试 `tests/remote-contract.test.mjs`。移动 client/凭据/事件/UI 设计文档见 `docs/design/`（已随 M0 冻结为 v1 设计基线）。本文件为叙述性摘要，细节以合同为准。

协议名 pi-gui-remote，major 1 已随 M0 冻结。M-1 不发真实网络请求；桌面侧合同实现与工作分支 commit 记录入控制层 `desktop` 字段，移动/桌面 protocolVersion 不一致时一律 fail closed。初始桌面基线为 main af0432a0bc3b04c717a63ede3cc457e859401833，远程实现发生在独立工作分支 `feat/mobile-remote-protocol-v1`。

目标入口：显式启用的独立 TLS listener；只接受 remote/v1 白名单，不映射现有 /api/*。短效单用 bootstrap 在桌面明确授权下配对每设备公钥/凭据，凭据可撤销；私钥仅 SecureStore，客户端不接收 PI_GUI_TOKEN、模型/OAuth 凭据。

握手交换 protocol major/capabilities；不匹配拒绝。mutation 带 requestId、设备身份、目标项目/会话、expectedRevision、timestamp/nonce 和请求证明；服务端核验授权、重放、归属、并发冲突。高风险操作必须沿现有审批服务，不新增 bypass。令牌/证明算法须 M0 独立安全审查后冻结，不能自创未审算法。

操作范围候选：读取被授权项目/会话/模型摘要；发送消息/取消任务；展示和回应已有审批。禁止任意路径文件、终端、凭据、更新/扩展安装、通用 RPC 转发。消息/工具结果采用明确投影与限长；错误是闭合 code，不传原始异常。

同步候选：snapshot revision + 单调 event cursor；重连带 last cursor；间隙回快照；requestId 幂等；多设备使用 expectedRevision；撤销关闭活跃连接且后续请求立即 401。游标保留/背压/重启语义 M0/M4 实测后记录。

# device-network 延期记录（M5-tailscale）

日期：2026-11-25。状态：**deferred / unverified** — 这不是通过证据。

## 范围

M5-tailscale 要求的 `device-network` 证据覆盖：真实 iPhone/iPad 上 Tailscale 私网 TLS 握手、认证、网络切换（Wi‑Fi↔蜂窝）、撤销后的实际拒绝行为与性能体验。

## 决策依据

ADR 0006：所有真机验收集中在最后一次性清单由用户操作。中间不请求或代操作真机；Simulator 与 IPA 结构检查不替代真实网络验收。

## 已执行的替代验证（均非替代通过）

- 单元/故障注入/集成测试（合成网关与桌面真实 TLS 网关，127.0.0.1）。
- macOS Runner 编译并运行真实 Network.framework/CryptoKit 探针（m5-native-probe），含激活代际、SSE 边界、Keychain 拒绝路径。
- 桌面 `remote-gateway.cjs` 端到端 TLS + 撤销关闭流测试 15/15。

## 未验证项与恢复条件

- 真机 tailnet 内 TLS  pinning 端到端；NAT 切换后流恢复；撤销在真实设备上的即时性；性能/电量。
- 恢复条件：M6 完成后最终真机清单中由用户执行 SideStore 安装与网络验收，证据通过 `agent-task.mjs evidence` 导入后方可视为验证。

## 风险声明

在此证据补齐前，M5-tailscale 不得 accepted/completed；远程功能保持默认关闭，不对未验证网络环境做任何行为承诺。

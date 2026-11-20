# 源码研究记录 · 2026-11-21

只读引用，不改参考仓库。主 Agent 和独立研究 Agent 均读实际源码；独立研究任务完成，结果存本记录。T3 MIT，未复制其业务实现；参考许可证说明见 THIRD_PARTY_NOTICES.md。

## 固定基线

- T3 pingdotgg/t3code ccc1feb15572c422fbdce26ba6077b91459cfd47。
- Pi GUI HYJ1817/pi-gui af0432a0bc3b04c717a63ede3cc457e859401833（远端 main）。用户现有桌面 dirty 工作区未改。
- npm 实测 Expo 58.0.26、RN 0.88.1、React 19.3.0、TS 6.0.3、GlassEffect 58.0.5、Router 58.0.32；完整解析结果以 package-lock 为准。

## T3 源码证据

- apps/mobile/src/Stack.tsx:553、features/layout/createWorkspaceStackNavigator.ios.tsx:539/617：共享路由映射紧凑原生栈、宽屏分栏和 sheet；native/V5StackHeader.ios.tsx:337 使用 screens HeaderConfig。本项目按已定路线用 Expo Router，不移植 screens fork。
- apps/mobile/src/components/ui/GlassSurface.tsx:51 调用 expo-glass-effect 的真实 GlassView；native/native-glass.ts 探测 iOS API；GlassBackdrop.tsx:7 的旧系统 blur 降级不照搬，本项目显式实色降级。
- apps/mobile/src/features/connection/pairing.ts 实际解析直连和 hosted pairing URL；features/connection/ConnectionsNewRouteScreen.tsx:135 / packages/client-runtime/src/connection/onboarding.ts:120 先描述环境、比对身份、再兑换 bootstrap。
- apps/mobile/src/persistence/mobile-secure-storage.ts 调用 Expo SecureStore；features/cloud/dpop.ts:146 原生 P-256 proof；connection/catalog-store.ts:62 保存凭据。
- packages/client-runtime/src/authorization/remote.ts:327 换短效 RPC ticket，再用 proof 握手；apps/server/src/persistence/AuthPairingLinks.ts:227 条件更新原子消费配对；auth/dpop.ts:91 和 shared/src/dpop.ts:123 校验方法/URL/时效/哈希及 jti 重放。
- apps/server/src/auth/PairingGrantStore.ts:828、EnvironmentAuth.ts:1311、ws.ts:3751：撤销设备/同公钥会话并结束已打开 RPC；RpcAuthorization.ts:297 逐操作 scope 检查。
- packages/client-runtime/src/state/shell.ts:665、state/threads.ts:666 与 server/src/ws.ts:1037/1347：afterSequence 补持久事件接实时流；间隙/裁剪/预算超限重新取快照。

## Pi GUI 接缝与风险

- server/auth.js:47、server/router.js:173/315、server.js:1875：本地 Origin+令牌边界；electron/main.cjs:97/340 生成/注入本地令牌；rpc-bridge.js:271 不传给 Pi 子进程。不能整体代理或公开 listener。
- server.js:1390、server/sessions.js:392/761、session-history.js:42：不透明会话 ID、登记项目和文件身份验证；最小远程桥应调用窄领域方法后白名单投影。
- server/sse.js:98 是内存环形补发；runtime-registry.js:618 有完整 owner/cursor/pending/gap 接缝；不能假定重启后持久重放已经存在。
- public/approval-model.js:24、approval.js:85、session-runtime.js:264：复用 extension_ui_request 和 pending ID/owner。Classic rpc-bridge.js:630 的回复前 pending 服务端校验需 M1 补证，不能直接暴露。
- 工具可否拦截取决于扩展实际询问；远程不承诺已有服务未提供的统一审批能力。

## 当前选择与未决

M-1 离线 native probe；M0 再冻结 TLS/主机身份、DPoP/设备私钥生命周期、只读/写入 scope、classic/runtime 审批差异和缓存撤销策略。T3 云账户/relay 不引入，本项目首期 Tailscale 私网+TLS。建议先只读配对再逐项开放写入，但最终 M3 核心功能范围不缩水。

## 官方资料核对

2026-11-21 实际取回 Expo SDK 58 GlassEffect/Router 文档、actions/runner-images 的 macOS-26 清单、Maestro cli-2.12.1 release 元数据与 SHA256、Maestro reports 文档、SideStore app-sources 文档。最初旧 SideStore /sources URL 404 后由官方 sitemap 找到 /app-sources。CI 运行输出为环境支持情况最终证据，网页清单不算已运行。

Windows：Node v24.22.1/npm 11.19.1；11 项控制层测试、TS、Metro iOS bundle、Doctor 20/20 首轮成功。Windows expo prebuild --platform ios --no-install 明确拒绝生成 iOS，交 macOS CI，不标成功。

依赖修复：Router 的间接可选 React DOM peer 自动选到 19.3.1，与模板 React 19.3.0 冲突；实测后显式固定 react-dom 19.3.0，不用 --force/--legacy-peer-deps。仅满足工具链 peer，本项目没有网页主实现。

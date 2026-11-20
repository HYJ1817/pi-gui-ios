import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, envelope, writeEnvelope, renderProjections, withLock, createCheckpoint } from './lib/control.mjs';
withLock(ROOT, () => {
if (existsSync(resolve(ROOT, '.agent/control.json'))) throw new Error('Control already exists; use resume');
const make = (id, phase, title, dependsOn, requiredEvidence, acceptance) => ({ id, phase, title, status: 'pending', dependsOn, requiredEvidence, acceptance, evidence: [] });
const tasks = [
  make('M-1-infrastructure', 'M-1', '恢复控制层、Windows 原生探针、macOS/Simulator/Maestro/unsigned IPA 验证', [], ['unit', 'typecheck', 'bundle', 'doctor', 'ci', 'ui', 'ipa', 'independent-review', 'independent-security', 'independent-handoff'], '所有自动化、真实 UI 及独立审查通过；不包含 SideStore 人工验收'),
  make('M-1-device', 'M-1', '一次集中 SideStore 免费签名安装与真机验收', ['M-1-infrastructure'], ['device-install', 'device-upgrade'], '真实 iPhone 安装/运行/刷新/覆盖升级及可用 iPad 验证；不以 Simulator 或 IPA 结构代替'),
  make('M0-architecture', 'M0', '冻结架构、协议和安全模型', ['M-1-device'], ['unit', 'independent-review', 'independent-security', 'protocol-contract'], '双方源码证据、ADR、权限和兼容契约通过独立安全审查'),
  make('M1-remote', 'M1', '桌面远程授权、配对、撤销', ['M0-architecture'], ['unit', 'integration', 'independent-review', 'independent-security'], '隔离入口、TLS、重放、撤销断连、最小权限及桌面 canonical 验证'),
  make('M2-shell', 'M2', '原生设计系统与 iPad 导航布局', ['M1-remote'], ['unit', 'ui', 'independent-review'], '双设备、主题、辅助功能真实渲染验收'),
  make('M3-core', 'M3', '会话、消息、任务、模型、工具及审批', ['M2-shell'], ['unit', 'integration', 'ui', 'independent-review', 'independent-security'], '桌面/移动完整合成闭环，保持桌面审批'),
  make('M4-sync', 'M4', '实时同步、断线补发、多设备一致性', ['M3-core'], ['unit', 'integration', 'fault-injection', 'independent-review'], '乱序、间隙、重启、重复与冲突不破坏状态'),
  make('M5-tailscale', 'M5', 'Tailscale 异地与真机安全兼容', ['M4-sync'], ['integration', 'device-network', 'independent-review', 'independent-security'], '异地 TLS/私网认证、网络切换、真机兼容通过'),
  make('M6-distribution', 'M6', 'IPA、版本检测、SideStore 源与发布候选', ['M5-tailscale'], ['unit', 'ipa', 'device-upgrade', 'independent-review', 'independent-security'], '更新兼容通过；正式发布和 main 合并另需用户授权'),
];
tasks[0].status = 'in_progress';
const data = { phase: 'M-1', currentTask: tasks[0].id, branch: 'agent/m-1-bootstrap', protocolVersion: 1, desktop: { repo: 'HYJ1817/pi-gui', branch: 'main', commit: 'af0432a0bc3b04c717a63ede3cc457e859401833', protocolVersion: null }, ci: [], blockers: [], delegates: [], tasks, checkpoint: null, nextAction: '完成控制层故障测试与 Expo 58 离线探针；触发并实际分析 macOS CI，之后独立审查/恢复交接。' };
const control = envelope('control', 1, data); writeEnvelope(ROOT, '.agent/control.json', control); renderProjections(ROOT, control);
console.log('Initialized M-1 schema v2 control revision 1; no acceptance claimed.');
});
createCheckpoint(ROOT, '初始化项目控制层；尚无通过证据');

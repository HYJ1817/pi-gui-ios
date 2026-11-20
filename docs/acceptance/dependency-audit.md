# 初始依赖安全核对

实际命令：`npm audit --omit=dev --json`，exit 1。原始结构化报告见 npm-audit-initial.json。

结果：0 critical、0 high、3 moderate（同一条 minimatch advisory 经 @expo/fingerprint → expo 传播，不能当作三条独立漏洞）。固定树为 expo 58.0.26 / @expo/fingerprint 0.21.10 / minimatch 10.2.6。

GHSA-g3hv-75wg-m249 / CVE-2026-118764 要求攻击者控制 glob 且 optimizationLevel >= 2，导致 globParts 放大与 CPU/内存拒绝服务。实际读取官方 GitHub Advisory；修复在 minimatch 11.0.1。

实际读取已安装 Expo 源码：@expo/fingerprint/build/Options.js:167-171 明确说明此调用保持默认优化等级1且 fingerprint config 不暴露等级2；utils/Path.js:84-101、128 以 {dot:true} 构造 matcher。本应用不导入 fingerprint、不接收网络 glob、不在移动端执行 Node 构建工具。本阶段判断：**当前构建调用没有该 advisory 的已证实触发路径，保留为上游依赖观察项，不声称 audit 通过。**

不运行 audit fix --force：npm 建议降级 Expo 52，破坏已定原生路线；也不擅自跨主版本 override minimatch 10→11。后续 Expo 兼容更新时重核，若新增任何可控 glob/等级2调用则重新评估并阻断相关任务。独立安全审查仍独立执行，本文不替代它的结论。

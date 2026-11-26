# 独立审查与验收

执行者遵循 [AGENTS.md](AGENTS.md)。审查者独立上下文、默认只读，查实际 diff/源码/原始测试和 CI 材料，不采信实现者总结。普通功能需独立复审；身份/权限/撤销、恢复/证据、CI/安装需相应独立安全或故障审查。审查不授予合并/发布权限。

发现写明 Blocker/Important/Nit、文件:行号、触发/实际/预期、复现证据与影响/处置。未运行写“未执行”，保留失败/工具缺口。按 AGENTS 有界排障，不弱化断言；非阻断 nit 不自动重启全项目验收。

完成前须有依赖与当前源码/作用域真实证据、无未解决阻断，并覆盖相关安全负向用例。UI 需 iPhone/iPad、深浅色、大字/Reduce Transparency 真图；simctl 参数截图不证明触控端到端，synthetic 不证明桌面接线。恢复变更覆盖损坏/中断、dirty/Git 漂移、CI running/failed、证据失效/路径安全，并由无历史独立 Agent 实际恢复并检查。高风险缺审查不得启用或验收。

结果集中到已有验收报告：范围/提交、真实命令/结果、必要产物、精确 CI/独立审查身份、缺口/回滚/结论，遵守 [持久化规则](docs/testing.md#证据持久化)，不复制状态或上传私有日志。测试、功能验收、合并/发布分别判断；真机/SideStore 由用户按 [一次性清单](docs/acceptance/M-1-device-checklist.md) 确认，未执行 pending/unverified。

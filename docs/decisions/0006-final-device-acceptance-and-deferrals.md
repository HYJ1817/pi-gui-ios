# ADR 0006 · 软件优先，最终集中真机验收与中间延期策略

日期：2026-11-21。状态：负责人明确授权的执行顺序调整；不把延期/跳过项变成通过证据，也不放宽安全不变量。

## 决策

M0–M6 软件实现、可行自动化测试、Simulator/IPA 验证与独立安全审查先行。iPhone/iPad 真机/SideStore 安装、运行、刷新/覆盖升级和实际网络体验统一留到最后，由用户集中执行一次；Agent 不在中途请求或代操作真机。真机清单执行前相关证据保持 pending/unverified，Simulator 与 IPA 结构检查不作替代。

Agent 自主排查一般环境、工具、Runner 与非核心兼容问题：每个失败类别最多三次有目标尝试；仍失败则保留错误/CI 事实，记录原因、影响、未验证项与恢复条件，标记 deferred/unverified 并继续其他不依赖的工作。不得删失败证据、伪造报告或将未运行写成通过。

认证、凭据、权限、项目/会话归属、撤销、审批、隐私与数据完整性不是可普通跳过的边界。独立审查或工具暂不可用时，可继续隔离 fixture、客户端类型、默认关闭的服务/协议代码；不得暴露 listener、启用写操作、称安全通过、合并或发布，直到安全审查和负向验证完成。用户 waiver 不等于独立 review/security/handoff 证据。

## 顺序与状态

- M-1-infrastructure 保留 blocked：CI 44906133898/1 在 Pods install 前失败；本地修正了候选 Gemfile 摘要转录错误，但按负责人指示不再反复尝试。当前恢复 `bootstrap-required`。失败 run 不覆盖。
- M0–M6 的软件依赖与安全门禁继续按任务契约推进；M0 design-only 例外可先行，正式阶段只有真实证据齐全才可 accepted/completed。
- M-1-device 依赖调整到 M6-distribution 之后，只代表集中执行时机变更，不代表已安装/运行/升级成功。
- `C:/pi-GUI` 当前有用户 dirty 工作区，保持只读。未来桌面实现只能在独立 worktree/分支，遵守桌面项目约束，使用 synthetic fixture 并分别提交、测试和审查。

## 记录

每个 deferred 项在 `docs/acceptance/` 记录阶段、run/commit、已运行/未运行验证、风险与恢复条件。设备缺口在最终清单执行前保持 pending；远程安全边界在独立安全审查通过前保持关闭。

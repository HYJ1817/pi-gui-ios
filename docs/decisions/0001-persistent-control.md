# ADR 0001 · 单一权威恢复控制层

日期：2026-11-21；状态：采用；具体 schema、证据和检查点边界已由 ADR 0004 的 v2 修订，首审 v1 不通过。

control.json 是唯一任务与运行状态权威。state.json/tasks.json/PROGRESS/HANDOFF 是同 revision/digest 的派生投影，不能各自手改。ROADMAP 是静态验收契约，验收记录是不可伪造的外部证据引用，均不抢占任务状态权威。

所有 JSON 状态带 schemaVersion、kind、revision、updatedAt、data 和 SHA256 integrity；schema 存 .agent/schemas。先原子提交 control，再生成镜像，投影写到一半可重建，不自动覆盖权威损坏。检查点保留有效 control 快照、HEAD、分支、dirty 清单、source fingerprint 和证据。

源码指纹覆盖非忽略源码/锁文件/CI/测试脚本，排除生成状态、验收报告、检查点与产物，避免自引用。证据必须带 source fingerprint/commit/报告 SHA256/结果；缺失、被篡改、源码变化均不通过 completed 门禁。摘要用于意外损坏与过期检测，不是对恶意仓库写入者的安全签名。

任务转换由脚本校验；不自动 clean/reset。恢复默认只读诊断，--repair-projections 仅重建可推导文件。恢复脚本可 --remote 用 gh 检查 CI/远端，网络失败是 unknown 不是 pass。

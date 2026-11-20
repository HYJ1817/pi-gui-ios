# ADR 0004 · 证据与恢复控制层 v2

日期 2026-11-21；状态：实现已做，独立复审待完成。

首审用真实 fixture 证实 v1 的 --passed 登记、词法路径、弱 schema 和检查点顺序不足。控制信封升级 schemaVersion 2。旧权威先完整备份，旧证据不迁移为通过；显式迁移脚本只接受校验过的 v1 和实际 CI API 身份。

.agent/schemas/*.schema.json 是运行时数据合同的唯一真相。依赖零外部包的受限 JSON Schema 校验器覆盖仓库实际使用的全部断言关键字；未知断言报错，不声称是通用 JSON Schema 引擎。control、state、tasks、checkpoint、CI、evidence 共用定义，写前完整验证并预渲染；无效数据不得推进权威 revision。

证据是单一 kind/task 的结构化原始报告。登记只导入原报告结果/commit/源码指纹，不再接受 --passed 或盖新戳；必须对应存在的 Git commit 源码树，自动命令 exit=0、日志摘要；CI 绑定实际仓库/工作流/run/attempt/head/success 和 API receipt；独立审查保留真实工具 receipt，其原始 JSON summary 必须明确通过/提交/指纹/未解决问题为0；设备安装必须单列真实用户确认。UI 必须含双设备/三外观真实截图和逐张图审，不以文字断言替代。信封摘要防误损坏/过期，不是抵抗有权改整个仓库的恶意写入者的签名。

所有 acceptance/completed 推进递归重验依赖；源码/日志/报告变化、未提交源码、分支漂移和已知 blocker 均拒绝。源码摘要现包含控制 schema，排除状态投影、验收报告和检查点以免自引用。源码 commit 可落后于仅状态/验收文档提交，但其被测源码树必须完全相同。

状态写、证据读逐级 lstat + realpath，拒绝符号链接/junction/非普通文件和离开专用目录的路径；临时文件 O_EXCL/O_NOFOLLOW（宿主支持时）、fsync 和读回校验。此边界防误指向和静态重解析点，不声称能抵御同一 OS 用户恶意并发替换所有父目录的攻击；远程服务不暴露这些本地维护脚本。

检查点在同一写锁内先保存、读回并验证快照，再提交其摘要引用；投影修复先持锁重读。v2 检查点入 Git，跨 clone 可恢复；v1 本地历史不删除。resume 核对快照存在性、外层及内层摘要，缺失时明确失败。恢复脚本只接受显式有效检查点，备份损坏权威、保留 dirty 源码、不 reset/切分支，失效已验收任务回 testing。

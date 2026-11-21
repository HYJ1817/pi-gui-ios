# a8b8360 · 第三轮原生依赖清单复验

独立任务 `b861b32f` 于 2026-11-21 08:33 UTC 正常结束。安全审查和功能审查均判失败，两份报告指向同一个阻断。交接子项通过，三项结果按原文存档。审查源码为 `a8b8360fb0c814a612b07302273a7338e1c112d5`，源码指纹为 `30ef203a01cec72eb524df2b8313f2c0941acb1e15d2e524e826d40bb92a2f1e`。[原始结果](review-a8b8360-result.json) · [来源与摘要](review-a8b8360-provenance.json)

## 未解决的阻断

`INV-UNREVIEWED-POSIX-LINK`。在依赖树中，清单按原生后缀分类后才判定部分链接。普通名称的未批准 POSIX 符号链接可能被静默跳过，导致清单漏记链接对应的原生文件，影响候选清单的完整性。审查者核对了目录和文件两个分支，并用模拟 POSIX 目录项的探针确认存在静默遗漏。Windows 实际创建符号链接的尝试返回 WinError 1314，真实 macOS/POSIX 验证待完成。[遍历实现](../../scripts/ci/native-dependencies.py#L142)

`INV-FRAMEWORK-CASE` 已经通过第三轮定向复验。独立运行的两次 Ruby 合成候选均包含 framework 资源，资源变化会改变清单摘要。源码复核确认六条 Hermes 别名的路径和目标按原始拼写匹配。`INV-HARDLINK`、`INV-PREFIX`、`INV-ENUM` 在此前报告覆盖的范围内已处置。[第二轮记录](review-d2d1720-disposition.md)

## 验证情况

| 检查 | 实际结果 |
| --- | --- |
| Windows `npm test` | 224/224 通过，0 跳过，技术栈合同通过。[报告](local-unit.json) |
| TypeScript、iOS JS bundle、Expo Doctor | 四份 Windows 规范报告与日志摘要均已核验，含单测报告。三项命令均退出 0，Doctor 20/20。[TS](local-typecheck.json) · [Bundle](local-bundle.json) · [Doctor](local-doctor.json) |
| 恢复与验收门禁 | `node scripts/agent-resume.mjs --remote` 恢复成功，源码指纹与审查提交一致。状态转为 `blocked` 后，`node scripts/agent-validate.mjs --task M-1-infrastructure` 返回 `passed: false` 和退出码 1，列出阻断及缺失的验收证据。 |
| 远端 CI | 最新运行 `44877767639/1` 在 `86cadda` 上因 `NATIVE_PREBUILT_LINK_REJECTED` 失败。候选列表为空，固定诊断未提供具体路径。[运行](https://github.com/HYJ1817/pi-gui-ios/actions/runs/44877767639) · [诊断](ci-44877767639-analysis.md) |
| 待验证 | 真实 macOS POSIX 测试、四份候选锁审核、locked 原生构建与缓存、iPhone/iPad Simulator 与图审、unsigned arm64 IPA、SideStore 安装。 |

## 恢复条件

按仓库的三轮修补上限，`M-1-infrastructure` 进入 `blocked`。下次用 `node scripts/agent-resume.mjs --remote` 核验此状态。[恢复方案草案](native-inventory-recovery-proposal.md) 细化了链接分类顺序、有限的 npm 命令链接来源核验、目标摘要与负向验证矩阵，尚未实现。恢复原生路线需要显式判定两个依赖树中的链接，再按现有门禁审查源码和执行真实 macOS 验证。工具链兼容性已做静态核对。当前 npm 11.19.1 的 `bin-links` 6.0.2 在 POSIX 为包命令创建 `.bin` 符号链接，锁文件中有 41 个带 `bin` 声明的包、42 个候选命令路径，并有三处重复声明。后续方案须在真实安装树上核对这些链接与 Hermes 别名的来源、目标和边界。应拒绝无法证明来源的链接，保持候选生成和最终 IPA 的现有门禁。 [审查规则](../../REVIEW.md) · [原生门禁](../decisions/0003-native-build-integrity.md)

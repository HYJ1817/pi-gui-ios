# 原生依赖清单 · 恢复方案草案

状态：只读调查与设计提案，尚未实现。当前源码仍为 a8b8360，M-1-infrastructure 保持 blocked。本文件是验收调查记录，后续采纳的设计须写入 ADR 0003。[失败处置](review-a8b8360-disposition.md) · [独立原结果](review-a8b8360-result.json)

## 已确认的根因

当前遍历在原生后缀分类后才拒绝部分 POSIX 链接。因为 os.walk 不跟随目录链接，普通名称的未知链接会既不被拒绝也不被记录，导致审查清单不完整。已知 Hermes 路径前缀预检仅覆盖两个 framework，不能代替对整棵依赖树的链接判定。

POSIX npm 安装还会在 node_modules/.bin 中创建合法命令链接。本机 npm 11.19.1 的 bin-links 6.0.2 源码确认：link-bins 为每个 bin 声明计算相对目标，非 Windows 分支最终调用 symlink。静态解析本项目 package-lock 得到 41 个带 bin 声明的包、42 个候选命令路径，有三处同名声明冲突：

| 命令路径 | 两个锁文件所有者 |
| --- | --- |
| node_modules/.bin/fingerprint | @expo/fingerprint、expo |
| node_modules/.bin/expo-modules | expo、expo-modules-cli |
| node_modules/.bin/expo-modules-autolinking | expo、expo-modules-autolinking |

例如 expo 声明的 node_modules/.bin/expo 计算目标为 ../expo/bin/cli。这些是工具源码与锁文件声明的静态结果；本轮未在 POSIX 上安装或枚举实际链接，不能据此批准整个 .bin 目录或断言 npm 在三个冲突处选择了哪个所有者。调查脚本只读锁文件与本机 npm 发行文件，未安装包或执行链接目标。

## 建议的判定顺序

1. 遍历两个依赖树时，对每个遇到的目录项先 lstat，统一识别 POSIX 链接、Windows 重解析点和非普通文件。链接必须得到显式分类，之后才进行原生后缀或 magic-byte 检测。任何枚举、lstat 或读取错误使本次清单生成失败。
2. 依赖布局例外仍限于六条精确的 Hermes 别名。保留当前路径、target、固定物理目标、父链、完整三条组约束；物理文件要求普通文件且 nlink=1。
3. 对 npm 命令链接，先从受审核的 package-lock 计算有限路径和相对 target 候选。对实际出现的链接逐项核对；已知冲突处只能匹配锁文件中的一个候选所有者。再核对目标确属该包、所有祖先无链接、目标为单链接普通文件。嵌套 node_modules 的 .bin 必须由其实际层级计算；任何工作区/目录链接、悬空、循环、外部目标、错误 target 或无法归属的链接均拒绝。
4. 对获准的每条命令链接，记录实际 path、target、所有者以及物理目标摘要和大小。目标文件无论扩展名是什么，都进入绑定范围。普通原生文件仍保持大小写无关分类、实际拼写记录、magic-byte 发现与完整资源摘要。候选与 locked 模式必须比较相同清单合同，旧清单不能自动获得新例外。
5. 最终 IPA 的无链接政策、权限规则和公开产物边界沿用现有门禁。公开报告仅含固定诊断与已审候选。新链接政策在源码复审和真实安装树验证后才可用于候选生成。

## 必须补充的验证

| 场景 | 要验证的结果 |
| --- | --- |
| Pods/npm 中普通名称的目录、文件和悬空 POSIX 链接 | 在内容分类前拒绝，候选生成失败 |
| 未批准链接指向包含 .a、framework 资源、无后缀 Mach-O 的树 | 均不能静默遗漏或获得批准 |
| 六条 Hermes 别名与大小写、缺项、逃逸、硬链接变体 | 合法组记录全部物理文件；变体拒绝 |
| 从锁文件声明生成的 npm bin 链接与三个冲突 | 仅有限路径和 target 可进入后续核验；实际目标被摘要绑定 |
| bin 指向文件变化、原生二进制、目标为链接或目录 | 文件变化使摘要变化；不合类型或祖先链接拒绝 |
| macOS 上真实 npm ci 后的安装树 | 列出实际链接并逐一核对，发现合同外结构即停止 |
| Windows junction、硬链接和遍历故障 | 保留既有负向行为，未知链接不受文件名影响 |
| 生产 finish 和 locked 模式 | 失败不产生新的可审核候选；有效合成清单与每个摘要绑定 |

下一次验证应先运行可复现的 POSIX 链接用例和现有 canonical npm test，通过后再考虑一次真实 macOS 候选生成。Simulator、UI、device IPA 和 SideStore 继续使用各自验收门禁。

## 来源定位

本机 npm 发行目录的 bin-links 6.0.2：lib/link-bins.js、lib/link-bin.js、lib/link-gently.js、lib/bin-target.js。上述版本和四份源码摘要保存在 [链接调查数据](native-inventory-link-research.json)。它们只说明本机工具实现，真实 CI 工具和安装结果仍须独立核对。

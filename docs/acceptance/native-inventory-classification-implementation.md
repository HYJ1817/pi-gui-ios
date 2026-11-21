# 依赖清单链接分类重构 · 实施与验证记录

用户在获知第三轮失败与 M-1 blocked 后明确要求继续。原结果和封存提交 8ca9bc4 保留。本轮按恢复方案实施全项目链接判定，保留原生候选、locked 构建、UI、IPA 与人工安装门禁。

## 修改

- scripts/ci/native-dependencies.py：每个目录项先判定链接；未知普通名称 POSIX 链接同样拒绝。六条 Hermes 别名政策保持。
- npm 命令链接路径/目标/所有者由 package-lock v3 有限派生；拒绝重复 JSON 键、不安全声明、工作区链接。实际锁有42个候选命令路径和3处同名声明，实际所选目标写入清单。
- CocoaPods 的 Public/Private 头文件与 modulemap 链接仅允许规范相对文件目标，basename 一致，源位于 Pods、npm 或既有 codegen 目录；目标及祖先无链接，普通文件且 nlink=1。源码依据见 cocoapods-link-source-research.json。
- schemaVersion3 记录链接类别、命令所有者与物理源；全部物理目标字节进入去重清单。目标字节、链接文本或所有者变化均使旧 locked 审核失效。
- tests/native-inventory.test.mjs 新增锁文件、目录项、Windows junction 和 POSIX 链接回归。既有 fixture 改用最小合法 npm v3 锁；原有 Hermes、硬链接、遍历故障、大小写与候选资源断言保留。
- ADR0003 记录此轮依据、有限政策和证据边界；verify-ipa.py、package-ipa.sh、权限与上传规则未改。

## 已执行

1. 修复前运行4个普通名称链接遗漏差分：4 tests / 0 pass / 4 fail，证实两个依赖树的目录/文件分支均会遗漏。
2. 初版修复后74项定向回归：70 pass / 4 fail。4项失败为 Windows 模拟目录项未提供 readlink；将未知路径拒绝前置后，24项新增用例全通过。
3. Windows canonical npm test：248 tests / 248 pass / 0 fail / 0 skipped，技术栈合同通过。使用既有便携 Ruby3.3.8 / Bundler2.6.9，真实 Ruby 生产锁校验与候选回归也在该入口执行。
4. CocoaPods1.16.2 四份公开源码只读获取并计算 SHA256，记录相对文件链接调用；未执行下载内容。

原始规范报告将在提交后由 scripts/verify.mjs 生成并导入，不能用上面的文字代替证据门禁。源码冻结后进行一次新上下文的安全/功能/恢复审查。代码复审通过后才触发一次受 canonical POSIX 测试前置约束的 macOS 候选 bootstrap。

## 未执行

新增用例的真实 POSIX 分支、实际 macOS npm/Pods 安装树、四候选锁生成/审核、locked 原生及缓存验证、Simulator/UI/图审、device IPA、SideStore。Windows 模拟元数据只覆盖遗漏代码分支；真实 junction/硬链接负向结果不当作 POSIX 正向结果。

回滚使用开发分支 revert；失败继续保留 blocked/testing 与原始证据。没有 main 合并或发布授权。

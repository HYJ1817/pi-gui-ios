# 44bff1c · 独立失败审查处置

## 原结果与停止

被审提交44bff1c4d11fc52ea776c5fd60436e6a3c93923c，指纹2ff040fe195eb2eddda53c5fb73287350a16a43cb1e8805278d898a4eed295af；独立任务cad17c30实际completed，完整summary已保存review-44bff1c-result.json，来源review-44bff1c-provenance.json。security fail（2 Blocker）、functional review fail（1 Blocker）；handoff pass只证明恢复后202项通过，不覆盖失败。没有导入失败结果为通过证据，没有推送44bff1c、没有新CI。

## 发现、复现与窄修复

| 标识 | 原锚点 | 触发与影响 | 处置 |
| --- | --- | --- | --- |
| INV-HARDLINK | scripts/ci/native-dependencies.py:121 | 物理Versions/1/hermesvm硬链接外部同字节inode，清单不变而可继续verify_locked；原magic sniff也可能先读4字节 | 对任何待读非symlink项，在sniff/digest前检查普通文件且st_nlink=1；别名自身与普通文件目标也拒绝多链接。目录不要求nlink1。 |
| INV-PREFIX | scripts/ci/native-dependencies.py:94 | macosx等无framework后缀前缀替换为POSIX目录symlink，walk不跟随也不拒绝，可漏掉整个已知framework | 在Pods遍历前按固定两个根逐组件检查存在前缀。lstat识别悬空symlink，严格检查祖先与目录类型，不靠exists/resolve跳过链接。 |
| INV-ENUM | scripts/ci/native-dependencies.py:90 | Resources scandir EACCES被默认忽略，部分清单可被当作审核基线 | walk onerror立即抛固定GateError，不返回部分清单；无原始路径/消息发布。 |

补回归后、生产修复前实际 `node --test tests/native-links.test.mjs`：11 tests / 5 pass / 6 fail。三个硬链接fixture实际用os.link创建并确认st_nlink2，读取guard捕获原实现尝试读取；三个scandir EACCES故障均显示原实现静默接受不完整清单。Windows仍无POSIX symlink权限，前缀POSIX缺陷此时只有代码证据，未伪造运行。

生产修复后，native-links与ipa-ci定向34/34通过。随后补六个真实Windowsjunction前缀用例，带walk前guard，及macOS六个真实前缀symlink、目标hardlink负向；其完整回归结果由后续精确提交规范报告记录。真实POSIX执行仍只由macOS canonical门禁取得，不将Windows故障注入写成macOS执行。

## 证据、门禁与回滚

源码变化使旧44bff1c四报告和handoff对新源码失效；须新提交后重新verify生成原始报告，再对新精确commit独立复审。只有三项独立通过后才解除对应本地调查/修复阻塞；仍不批准真实native锁，仍不计候选exit78为CI/native通过。

最终IPA校验器、打包/私有暂存、候选发布谓词、token权限与远程默认关闭不变。没有实际候选、locked native、UI/IPA或SideStore证据。若有新问题仅开发分支新增修复/revert，不reset/clean/强推、合并main或发布。

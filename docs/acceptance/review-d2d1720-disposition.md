# d2d1720 · 大小写分类阻断处置

## 原结果与范围

独立任务7d21bf3e实际completed；完整原summary保存为review-d2d1720-result.json，来源review-d2d1720-provenance.json。审查对象d2d1720c000c9acc6ec9684ce42bbf685aa45ddd，指纹e7d35a7e0eb3b9576d95fc41fe2d0a907c9e515073e3a9007c3bffb6cd90cd07。

独立确认INV-HARDLINK、INV-PREFIX、INV-ENUM在被审代码中解决：四个真实硬链接在读前拒绝、16个真实Windowsjunction负向、scandir入口与迭代共六故障拒绝；真实POSIX仍未执行。authority移除这三个已处置的具体源码阻断，但不删除整体NATIVE-PREBUILT-LINK调查门禁、真实native锁或后续验收要求。

security/review仍fail，唯一新Blocker为INV-FRAMEWORK-CASE（两类报告同一发现不重复计数）；handoff214项pass不覆盖fail。没有推送d2d1720，没有新CI。

## 发现与实际差分

原锚点scripts/ci/native-dependencies.py:131（目录亦在120行）：大小写不敏感磁盘可让已知路径指向hermesvm.Framework，但suffix分类大小写敏感。二进制经magic被记录，Resources/Info.plist却漏掉；独立真实Ruby合成finish产生不完整四候选，资源变更未改摘要。不是实际macOS候选，不能把该探针写成CI成功。

新增回归修复前实际定向9 tests / 0 pass / 9 fail：5个Pods/npm framework/xcframework大小写变体均漏资源；4种大写归档扩展名均漏记。Windows fixture实际samefile确认不同大小写查找同一目录，不mock文件系统。

窄修复只改三处suffix分类为casefold；实际文件路径和六别名path/target始终exact，摘要保留实际拼写。资源变更必须改变清单并使旧locked review失败，case-variant link不会获准。

修复后native-links与ipa-ci定向50/50、0fail/0skip。包含生产finish+真实Ruby3.3.8/Bundler2.6.9两次生成纯synthetic候选，各exit78、approved=false、完整2个物理文件；Info.plist变化使候选清单hash不同。fixture清理，不安装CocoaPods、不触发CI、不写真实设置。随后规范canonical结果由新提交报告记录。

## 有限复验与剩余门禁

44bff1c为第一次别名实现审查，d2d1720为第二次，本修复后新精确提交为第三次：若独立复验仍未通过，停止同类机械修补，保存发现/根因/日志与阻塞，不继续第四轮和CI试绿。

三项原结果与失败证据保留；新的源码须重新四类规范报告和独立安全/功能/恢复复验，不能继承旧handoff或把fail转pass。即使通过仍需macOS canonical真实POSIX、四候选独立审核、locked native/cache、真图/UI、最终arm64IPA、SideStore。最终IPA/发布白名单/权限不改；M-1仍不得accepted/completed。

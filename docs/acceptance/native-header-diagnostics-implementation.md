# ef2c3b7 · 头文件有限集合与固定诊断修订

源码提交ef2c3b77f2de2860e286a03c617d884537c344df，指纹346c5097e03fd2f3f49dd6b973992fe6eff59c6997b7dec9c4153395ea626109。基于CI44891582412实际失败后的固定来源调查，补齐CocoaPods/FileAccessor引用的头文件集合，并对拒绝附加固定上下文/谓词诊断。真实被拒绝路径仍未获证据，未把后缀差分当作CI根因，未重跑CI。

修改scripts/ci/native-dependencies.py、tests/native-inventory.test.mjs、新增tests/fixtures/cocoapods-header-extensions.json并记录ADR0003。保留所有目标/父链/单链接普通文件与哈希/owner规则、未知链接拒绝；不改最终IPA、权限、ATS、安装和上传门禁。

实际差分：9种公开头文件集合修前5pass/4fail，遗漏.tpp/.def/.inl/.inc；修后39项定向全通过，包括生产CLI失败时只输出固定枚举、不泄漏private marker或实际路径、无候选生成，以及移除无该来源依据的.h++。macOS新增9种真实文件链接及目标字节漂移条件用例，当前未执行。

四份规范报告已由agent-task核验后导入：Windows npm test 263/263、0fail/0skip、技术栈合同通过；TS、iOS JS bundle成功，Doctor20/20。初次55秒工具等待超时未生成新报告，实际检查确认无残留测试进程；随后用本地忽略目录中的单一后台包装执行相同scripts/verify.mjs unit，约57秒正常退出0，生成现存规范报告/原始日志并验证来源指纹。另一次进程检查命令的shell引用错误仅导致查询失败，修正后核对完成，没有中止他人进程。

CI44891582412的298/298真实POSIX成功属于上一指纹b31ec8e，当前ef2c3b7不继承其CI通过。其失败与API、SHA绑定的三安全JSON、原始数字提取记录仍保留在ci-44891582412-*。M-1仍reviewing，独立3cf20d98正在复审当前精确源码；完成事件到来前不改源码、不推送、不重跑。新的原生锁候选、locked构建、UI、IPA与SideStore仍未通过。

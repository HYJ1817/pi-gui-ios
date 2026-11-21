# bd20d01 · 精确 RN 路径修复独立复核

## 身份与原始结果

- 被审提交：bd20d0169d3e14994fc30788ee5ee7c416c621fa。
- 源码指纹：6e34173f27c8ed05355263a0e724a042d25d3a9a7b6c1561cb4266da0858edc8；登记前工作树与真实提交均重新核对一致。
- 独立任务：163e28bb-cb98-4c9b-bf1d-f627b765bff2；实际执行模型 xingchiapi/gpt-6.1-sol；2026-11-21T06:33:02.170Z 至 06:42:30.105Z。
- 原始完整 summary 与来源：review-bd20d01-receipt.json。已读取真实 completed task_status，再核对其完整 summary；不拼接历史末段、不改写 decision 或提交身份。
- 回执 SHA256：4d135ed794028e5d7ee4ca3c9e9d4684a6d4344225fda6e1ab3c12b1642fd84f。
- independent-security / independent-review / independent-handoff 均 pass，未解决 Blocker/Important 均为 0。三个 schema-v2 登记报告分别引用同一完整原结果，不将其扩展为 native 验收。

## 实际检查与失败记录

独立审查读取实际 diff、生产 Ruby 校验器、RN0.88.1 两个 facade helper 与调用点。真实 Ruby/Bundler/Psych 为 3.3.8/2.6.9/5.1.2；直接调用 RN 方法得到14个路径，与有限生产允许表一致。

独立合成探针共173次实际校验：29组接受并二次验证幂等、87个当前负向拒绝、28个旧版差分拒绝。覆盖 pod/path 错配、subspec 根路径、podspec 冒用、source 类型、逃逸路径、Symbol/对象/别名、URL 来源；拒绝不修改输入、不回显私有标记。第一次临时探针因 Windows ESM import 路径失败，修正 file URL 后成功；原回执保留两次真实退出码。

独立诊断探针确认19种固定阶段码可保留，未知私有标记不回显。与0148a3f比较，控制层恢复、IPA、Expo模板、候选发布与 workflow 边界未变化。

审查者从文档恢复并实际执行 `node scripts/agent-resume.mjs`，退出0，schema-v2检查点通过且 warnings/failures 为空；随后运行 `npm test`：197 tests / 197 pass / 0 fail / 0 skipped，技术栈合同通过。工作树与提交源码指纹在审查结束未变。

## 三轮停止条件处置与下一次 CI 边界

CI44874304419只公开了 POD_ENTRY_LOCAL_PATH 固定拒绝码，不含原始锁。源码与合成差分能够解释缺失的14条 RN facade 路径，不能声称逐字段观测了 CI 原锁。

三轮停止后的要求现已满足：停止机械重跑、核对锁定源码、真实 Ruby 差分、窄边界修复、canonical 回归、精确提交独立安全/功能/恢复审查。仅解除该调查/复核前置阻塞，允许一次有证据依据的 macOS bootstrap；不放宽任意 build 路径，不改变 bootstrap-required 策略。

下一次推送包含已审源码与证据/状态记账，必须登记实际 CI head/run/attempt；不能假设记账后 head 仍是 bd20d01。若生成候选，应按设计 exit78 并停止后续 native/UI/IPA，再独立审核真实候选来源、版本、路径和预编译字节。不得将 exit78 或代码审查 pass 记为 CI/native 通过。

## 剩余门禁与回滚

真实候选锁、预编译清单及独立批准仍缺失；locked pod install/native构建、cache命中/污染、iPhone/iPad真图及交互、最终arm64 device IPA、SideStore均未完成。M-1保持 testing，依赖业务阶段不启动。

如后续证据否定本修复，仅在开发分支新增 revert；不得 reset/clean、强推、合并main或正式发布，不通过削弱来源/路径/权限断言试绿。

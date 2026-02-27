# SOP Preflight Counterexample Gate v1

目标：在开工前，用“反例门禁”把高风险/高不确定任务降级或拦截，避免错误方向与不可逆损失。

## 何时必须执行
- risk=high 的任务（外发/花钱/改配置/重启/删数据/权限变更）
- 影响生产环境、会造成用户可见故障的变更
- 涉及隐私数据或合规风险

## 输入
- 任务描述 + Route Card（若已有）
- 拟执行动作列表（命令/改哪些文件/发给谁）

## 反例检查（Counterexamples）
逐条回答“如果发生，会不会造成不可接受后果”。

1) 做错对象：在错误环境/错误仓库/错误账号上操作？
2) 破坏性：动作不可回滚或回滚成本极高？
3) 误外发：把不该发的内容发到外部（邮件/群/社媒）？
4) 成本失控：token/费用/时间超预算？
5) 权限越界：执行了未获授权的操作（重启/删库/改安全配置）？
6) 证据不足：没有可验证的验收标准/测试回归？

## 决策输出（Gate Record）
结论必须是以下之一：
- PASS：允许执行
- DOWNGRADE：允许但降级（缩小范围/只读/先做 dry-run/先写文档）
- BLOCK：禁止执行，必须先补信息或人工批准

复制模板：

```md
## Gate Record
- decision: PASS/DOWNGRADE/BLOCK
- reasons: <3 条以内>
- required_changes: <若 DOWNGRADE/BLOCK>
- approvals_needed: <需要谁确认>
- rollback_plan: <如何回滚>
- verification: <如何验收>
```

## 最小要求
- 任何 BLOCK 都必须说明“缺什么信息/谁来补/何时复查”。

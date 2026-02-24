# Linear-Codex Dev SOP (v1)

## 1. 任务入口标准 (Task Entry Standard)
Linear 每个任务必须包含以下 6 段：
- 背景 (Context)
- 目标 (Goal)
- 范围外 (Out of Scope)
- 验收标准 (Acceptance Criteria)
- 风险 (Risks)
- 回滚 (Rollback)

## 2. 执行标准 (Execution Standard)
- Codex 只能按工单实现。
- 任何超范围改动必须先写回工单“变更提案” (Change Proposal)。

## 3. 交付标准 (Delivery Standard)
必须提交“四件套”：
- diff 摘要 (Diff Summary)
- 测试结果 (Test Results)
- 风险点 (Risk Points)
- 回滚步骤 (Rollback Steps)

## 4. 状态标准 (Status Standard)
Todo -> In Progress -> In Review -> Done。
每次状态变更必须包含一句证据更新。

## 5. 故障托底 (Fault Tolerance)
- 卡住超过 20 分钟自动升级 (Auto-upgrade)。
- 由决策者重新介入。

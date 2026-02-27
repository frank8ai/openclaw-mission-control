# SOP Router v1

目标：把“一个任务”稳定路由到正确的 SOP/执行路径，并产出可审计的 Route Card。

## 何时使用
- 任何新任务进入系统时
- 任务出现争议（做什么/不做什么/先后顺序）时

## 输入
- 任务描述（1-3 句话）
- 约束：时间/预算/权限/是否可外发
- 期望交付物（可选）

## 输出（Route Card 模板）
复制下面模板到任务记录（文件/issue/卡片均可）：

```md
## Route Card
- task: <一句话>
- owner: <agent/human>
- priority: P0/P1/P2
- risk: low/medium/high
- constraints: <time/budget/access>

### Chosen Track
- sop: <SOP 名称或路径>
- why: <为什么选它>
- stop_condition: <何时停止/转人工>

### Deliverables
- artifacts: <将落盘到哪些路径>
- verification: <如何验收>

### Next 3 actions
1) ...
2) ...
3) ...
```

## 路由决策树（最小可执行版）
1) 如果涉及“外部发送/花钱/改配置/重启/权限变更” → 标记 `risk=high`，必须先走 Preflight Gate。
2) 如果任务是“排障/恢复服务/线上异常” → 优先走 Runbook/AutoFix 类 SOP。
3) 如果任务是“新增功能/重构/多文件改动” → 走工程化 SOP（计划→实现→验证→回滚）。
4) 如果任务是“研究/方案对比/调研” → 走 Research SOP（结论优先，长文落盘）。
5) 不确定 → 先产出 Route Card，要求补充输入（缺什么就问什么）。

## 验收标准
- 必须产出 Route Card
- SOP 路径/交付物/验收步骤清晰可执行

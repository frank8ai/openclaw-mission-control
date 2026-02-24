# CLAW-182 Explainer: 分层写入契约是什么意思？价值在哪里？

## 定义（What）
分层写入契约（Layered Write Contract）= 把一次“给系统/LLM/自动化引擎的写入”按重要性分成多个层（L0/L1/L2...），并且为每一层规定可验证的规则：
- 写什么（schema/字段/段落顺序）
- 什么时候写（触发条件、freshness）
- 写到哪里（source of truth / 引用链接）
- 写多长（maxChars/maxItems 硬上限）
- 拿不到时怎么办（fallback/降级策略）

一句话：把 prompt/上下文从“堆一坨”变成“有结构、有上限、能降级”的输入协议。

## 分层（Layers）
常见从高到低优先级：
- L0 必需约束：任务ID、目标、输出格式、禁止事项（不满足就不执行）
- L1 关键事实：现状、依赖、关键风险（直接影响决策）
- L2 证据片段：少量日志/代码引用（指向来源，不整段粘贴）
- L3 背景材料：历史讨论/旁枝信息（可选，严格上限）
- L4 可回溯工件：路径/URL/run id（用于复盘与取证）

## 价值（Why）
- 控成本：先写 L0/L1，信息足够就停止；避免 L3/L4 无限膨胀。
- 降漂移：把“噪声/历史包袱”隔离到低层，减少模型被带偏。
- 可调试：输出不对时能定位是缺 L1 事实还是 L2 证据污染。
- 可回滚：低层砍掉不影响核心执行；保住 L0/L1 就能稳定运行。
- 可扩展：新信息只需要挂到对应层，不用重写整套 prompt。

## mission-control / autopilot 的一个例子（How）
`docs/sop/autopilot-prompt-contract.md` 就是分层写入契约的具体化：
- 强制顺序：Instruction → SOP → Issue Metadata → Handoff → Core Context → Output Contract
- 总长度与分段 caps：防止上下文失控
- 防注入：不直接塞 raw logs，只保留摘要/引用

效果：同一个工单在不同时间/不同会话里，核心指令保持稳定，证据与背景可控增减。

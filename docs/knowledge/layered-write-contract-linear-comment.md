CLAW-182｜分层写入契约（Layered Write Contract）解释稿

分层写入契约 = 把一次“给自动化/LLM 的上下文写入”拆成多个优先级层，并对每层规定可验证的规则（写什么/顺序/长度上限/拿不到怎么降级）。

1) 它是什么意思（定义）
- 不是“把信息堆进 prompt”，而是把信息当作输入协议：L0/L1 必须稳定，L2/L3/L4 可控增减。
- 每层都有硬上限（maxChars/maxItems），并且约定引用证据的方式（路径/URL/runId），避免整段 raw logs 污染。

2) 价值在哪里（为什么要做）
- 控成本：先写 L0/L1，信息足够就停止；低优先级层严格截断。
- 降漂移：把历史包袱/噪声隔离到低层，减少模型被带偏。
- 可调试：输出异常时能定位是缺关键事实（L1）还是证据污染（L2）。
- 可回滚：砍掉 L3/L4 不影响核心执行；保住 L0/L1 即可稳定运行。
- 可扩展：新增信息只需要挂到对应层，无需重写整段上下文。

3) mission-control 的具体例子
- `docs/sop/autopilot-prompt-contract.md` 固定段落顺序：Instruction → SOP → Issue Metadata → Handoff → Core Context → Output Contract。
- 通过总长度与分段 caps 控制上下文膨胀；通过“摘要+引用”避免 raw logs 注入。

一句话总结：分层写入契约把 prompt 变成“结构化、可降级、可审计”的输入协议，让 autopilot 长时间运行更稳、更省、更容易定位问题。

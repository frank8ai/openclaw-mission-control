# Linear Task Template - Second Brain Improvements (v1)

Use this template for tasks whose goal is to improve the "Second Brain" (memory / context / retrieval / learning loop).

## Context
- What problem are we seeing in real usage?
- Where did it show up? (channel/session/feature)
- Why does it matter? (impact on recall quality, latency, user trust)

## Goal
- What capability is improved?
- What does "better" mean in measurable terms?

## Out of Scope
- What is explicitly NOT being changed?
- What future work is deferred?

## Acceptance Criteria
- Behavioral: what should happen / not happen.
- Quality: precision/recall targets if relevant.
- Safety: no private data leakage; no unsolicited external actions.
- Regression: existing flows still work.

## Risks
- False positives/negatives in memory writes.
- Over-retention (bloat) and privacy risks.
- Model/tooling drift.

## Rollback
- How to disable the new behavior quickly.
- What config flag / code path to revert.

## Delivery Checklist (SOP)
- Diff Summary
- Test Results
- Risk Points
- Rollback Steps

# CLAW-183 - Second Brain Autonomy Scope (v1)

## Context
This issue is a standing directive: for any work that clearly improves the "Second Brain" (memory / context / retrieval / learning loop), the autopilot may execute without asking.

## Goal
Define an explicit, auditable scope boundary so autonomous execution is safe and predictable.

## Out of Scope
- External posting or messaging (Discord/Telegram/email)
- Irreversible deletions/purges of user data or memory stores
- Config changes that alter security posture, permissions, billing, or token budgets
- Broad product changes unrelated to Second Brain (unless covered by another Linear issue)

## Acceptance Criteria
- A reviewer can look at a proposed change and classify it as In-scope or Out-of-scope using this doc alone.
- In-scope changes must still follow `docs/sop/linear-codex-dev-sop.md` (Diff Summary, Test Results, Risk Points, Rollback Steps).

## Risks
- Scope creep causing unintended behavior changes.
- Over-retention or privacy leaks if write paths expand.
- Regression risk from refactors without clear tests.

## Rollback
- Revert the specific change/commit.
- If gated by a flag/config, disable that flag/config and verify write/read paths return to baseline.

## In-scope (auto-execute)
- Memory quality improvements: dedupe, chunking, recall ranking, summarization quality
- Context compression & prompt slimming (section caps, truncation rules)
- Write guards: schema validation, PII redaction safeguards, safe defaults
- Observability for memory/retrieval: audit metrics, smoke tests, regression checks
- Refactors limited to Second Brain internals that preserve external behavior except for improved correctness/quality

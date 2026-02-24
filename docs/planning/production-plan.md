# Production Planning (Draft)

## Context
We need a concrete production-readiness plan captured in Linear so Codex can execute work items end-to-end and report back when complete.

## Goal
- Define production readiness checklist + prioritized Linear tasks.
- Ensure each task follows `docs/sop/linear-codex-dev-sop.md` (6 required sections).
- Create an execution order that is safe (low-risk first) and measurable (tests + verification).

## Out of Scope
- Large product feature changes unrelated to reliability/operability.
- Vendor/legal/compliance decisions requiring human sign-off.

## Acceptance Criteria
- A written production plan exists in-repo.
- The plan yields a set of Linear tasks grouped by theme (reliability, security, observability, release process).
- Each task has clear verification and rollback steps.

## Risks
- Over-scoping: plan becomes a wishlist, not executable tasks.
- Hidden dependencies between tasks cause churn.

## Rollback
- Revert plan doc changes.
- For any production-hardening change: ensure tasks include explicit rollback per SOP.

## Task Backlog Template (to copy into Linear)
Use this template for each production task:

- Context:
- Goal:
- Out of Scope:
- Acceptance Criteria:
- Risks:
- Rollback:

## Proposed Task Groups
1) Reliability
- Automated healthcheck + alerting thresholds
- Cron/job watchdog tuning + false-positive suppression

2) Security
- Secrets audit (no tokens in repo/logs)
- Dependency vulnerability scan and patch flow

3) Observability
- Structured logging conventions
- Key metrics summary report (daily/weekly)

4) Release Process
- Versioning + changelog discipline
- "release" runbook with verification + rollback

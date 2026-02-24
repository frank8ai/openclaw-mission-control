# Production Planning - OpenClaw Mission Control

## Scope
Production-related planning and rollout tasks tracked in Linear.

## Principles
- Plan first in Linear: tasks must have Context/Goal/Out of Scope/AC/Risks/Rollback.
- Small, auditable diffs; minimize blast radius.
- Every rollout has: KPI targets, stop conditions, rollback.

## Current Workstreams (seed)
- Cron reliability (silent/false-positive handling, circuit breakers)
- Linear autopilot reliability (circuit open, retries, idempotency)
- Second Brain improvements (memory quality, context compression, write guards)

## Definition of Done (per task)
- SOP 7 sections filled in Linear.
- PR/commit with Diff Summary + Test Results + Risk Points + Rollback Steps.
- Evidence link(s) to logs/runs.

## Backlog Hygiene
- Prefer converting broad directives into small tasks with explicit acceptance criteria.
- Track incidents separately from improvements.

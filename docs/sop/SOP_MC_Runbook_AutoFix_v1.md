# SOP: Mission Control Runbook AutoFix v1

## Invoke
- trigger from blocked incident context (`watchdog` / `status-sync` / `sla-check`)

## Goal
- Provide deterministic fix suggestions for known fault patterns.

## Scope v1
- Suggestion-first (safe mode):
  - no direct destructive action
  - no credential mutation

## Steps
1. Detect known fault signature:
  - model failover/switching
  - timeout loop
  - queue backlog saturation
2. Map signature to runbook card:
  - checks
  - command sequence
  - rollback step
3. Attach suggestion to:
  - issue comment
  - ops escalation issue description
4. Require explicit confirmation for any write action.

## Acceptance
- Known faults always get a runbook suggestion block.
- Suggestion includes verification + rollback guidance.

## v2 target
- Semi-automatic execution with approval token + full audit trail.

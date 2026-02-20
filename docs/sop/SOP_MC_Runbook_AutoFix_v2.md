# SOP: Mission Control Runbook AutoFix v2

## Invoke
- `npm run tasks -- runbook-exec --card <card> [--issue CLAW-123]`
- execute mode:
  - `--execute --confirm "CONFIRM <code>"`

## Goal
- move known-fault handling from suggestion-only to guarded semi-automatic execution
- keep rollback safety and full audit visibility

## Supported cards (v2)
- `model-failover`
- `cron-recover`
- `queue-backlog`
- `issue-refresh`

## Safety gates
1. Default dry-run:
  - no mutation unless `--execute` is provided
2. Config gate:
  - execute mode requires `runbook.allowExecute=true`
3. Token gate:
  - execute mode requires one-time confirmation token
4. Allowlist gate:
  - each planned action must exist in `runbook.allowedActions`
5. Scope gate:
  - total actions must not exceed `runbook.maxActionsPerRun`

## Steps
1. Select runbook card by incident signature.
2. Optionally pass `--issue` to bind context and infer cron target.
3. Run dry-run first and review plan output.
4. Execute with confirmation token when plan is approved.
5. Check:
  - command result
  - issue state/comment evidence (`status-sync`)
  - audit trail

## Outputs
- run summary: `data/control-center/runbook-exec.json`
- audit lines: `data/control-center/audit.jsonl`

## Acceptance
- Dry-run returns deterministic action plan.
- Execute path fails closed when any gate is not satisfied.
- Successful actions are logged with duration and command details.
- Failed actions are logged and surfaced immediately.

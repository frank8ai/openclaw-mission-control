# SOP: Mission Control Audit + Permissions v1

## Invoke
- write actions in control center CLI:
  - `run|enable|disable|kill`
  - `runbook-exec --execute`

## Goal
- keep operations read-only by default
- require explicit confirmation for mutation
- keep immutable audit trail for every control and automation action

## Policy
1. Default mode:
  - read commands run without confirmation
  - write commands are blocked without token
2. Confirmation:
  - operator runs `npm run tasks -- confirm`
  - token format: `CONFIRM <code>`
  - token is one-time and TTL-bound (`control.confirmTtlMinutes`)
3. Kill safety:
  - `kill` must pass whitelist gate (`control.killWhitelist`)
4. Runbook safety:
  - execute mode disabled by default (`runbook.allowExecute=false`)
  - every runbook action must pass `runbook.allowedActions`

## Steps
1. Generate one-time code.
2. Execute approved write action with `--confirm`.
3. Verify action result from stdout + runtime state.
4. Confirm audit line is appended to `data/control-center/audit.jsonl`.
5. If action fails, record remediation in linked Linear issue.

## Acceptance
- Any write without valid token is rejected.
- Expired/used token is rejected.
- `kill` rejects non-whitelisted subagent IDs.
- Runbook execute path refuses actions outside allowlist.
- Audit log contains event type, timestamp, and action detail.

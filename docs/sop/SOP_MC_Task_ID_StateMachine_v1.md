# SOP: Mission Control Task-ID + State Machine v1

## Invoke
- `npm run tasks -- status-sync`

## Goal
- Ensure every running runtime task is mapped to a Linear issue.
- Auto transition issue states:
  - `Triage -> In Progress -> In Review -> Done/Blocked`
- Post evidence comments when state changes.

## Inputs
- `data/control-center/runtime-issue-links.json`
- OpenClaw runtime signals:
  - sessions
  - subagents
  - cron job states
  - github-sync snapshot

## Steps
1. Load runtime-linked issues from binding file.
2. Collect signals per issue:
  - active sessions/subagents
  - cron warnings
  - github open/merged PR signals
3. Decide target state:
  - cron warning -> `Blocked`
  - merged PR -> `Done`
  - open PR -> `In Review`
  - active runtime -> `In Progress`
4. Transition issue state via Linear API.
5. If state changed, post evidence comment.
6. Persist sync state to `data/control-center/status-sync.json`.
7. Append audit line to `data/control-center/audit.jsonl`.

## Acceptance
- `status-sync --json` shows processed issues and target states.
- At least one linked issue can auto move to `In Progress`.
- State change triggers one evidence comment with logs/signals.

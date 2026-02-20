# SOP_MC_Briefing_Automation_v1

## Purpose

Generate and distribute a stable daily/weekly operations briefing from Mission Control.

## Scope

- Command: `npm run tasks -- briefing daily|weekly`
- Optional send: `--send --channel <channel> --target <target>`
- Data inputs:
  - runtime report (`report`)
  - cycle/due reminder snapshot (`remind` data layer)
  - SLA watch (stale In Progress / blocked over threshold)

## Preconditions

- `LINEAR_API_KEY` configured for reminder data pull.
- If sending messages, OpenClaw messaging channel and target are available.

## Procedure

1. Generate briefing locally:
- `npm run tasks -- briefing daily`

2. Validate sections:
- Runtime Snapshot
- Today/This Week Focus
- Risks / Blockers
- Next Actions

3. Send briefing:
- `npm run tasks -- briefing daily --send`
- `npm run tasks -- briefing weekly --send`

4. Enable cron schedule if needed:
- `npm run tasks -- schedule --apply`

## Safety

- Read-first by default.
- Optional escalation behavior controlled by config/flags.

## Verification

- JSON mode works: `npm run tasks -- briefing daily --json`
- Message length bounded by `briefing.maxSendLength`.

## Rollback

- Disable briefing schedule lines:
- `npm run tasks -- schedule --apply --without-briefing`


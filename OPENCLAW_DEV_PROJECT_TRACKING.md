# OpenClaw Dev Project Tracking

Updated: 2026-02-20

## Goal

Use this file as the single tracking page for ongoing OpenClaw development work.

Primary focus:

- Track what is in progress
- Track what is blocked
- Track where to view live runtime status

## Project Scope

- Runtime observability for `cron + sessions + subagents`
- Read-only mission control views for operators
- Upstream-ready PR split and merge progress

## Current Upstream Links

- Alignment issue: https://github.com/openclaw/openclaw/issues/21600
- Docs proposal PR: https://github.com/openclaw/openclaw/pull/21601
- PR1 (runtime summary API): https://github.com/openclaw/openclaw/pull/21612
- PR2 (runs history + failure aggregation API): https://github.com/openclaw/openclaw/pull/21639
- PR3 (control UI filter/search/time-range): https://github.com/openclaw/openclaw/pull/21644

## Project Repositories

- Mission Control repo: https://github.com/frank8ai/openclaw-mission-control
- Upstream fork (integration work): https://github.com/frank8ai/openclaw

## How To View Ongoing Work

### 1) View active development projects (delivery status)

Use the issue + PR links above as the source of truth for:

- In review
- Changes requested
- Merged
- Follow-up tasks

### 2) View runtime status now (live operations)

- Dashboard ops page: `http://localhost:3000/ops`
- CLI quick status:
  - `npm run tasks -- now`
  - `npm run tasks -- jobs`
  - `npm run tasks -- agents`
  - `npm run tasks -- report`

## Current Status Snapshot

- Mission Control prototype: complete and running locally
- Independent repo: pushed
- Upstream split PR plan: in progress
- API layer:
  - PR1 ready
  - PR2 ready
- UI layer:
  - PR3 ready

## Update Template (append below)

Use this template for each update:

```md
### YYYY-MM-DD HH:mm
- What changed:
- Current state:
- Blockers:
- Next action:
- Links:
```

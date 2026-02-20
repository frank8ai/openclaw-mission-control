# OpenClaw Mission Control: Official Submission Package (v1-first)

## Repository

- Public repo: https://github.com/frank8ai/openclaw-mission-control
- Branch: `main`

## Goal

Ship a practical Mission Control surface for OpenClaw operators:

- real-time runtime visibility across `cron + sessions + subagents`
- health reporting and anomaly detection
- safe control actions (kept gated/off by default)

## Delivered in this repo

### Dashboard

- Runtime task aggregation with active/warning summary
- Cross-agent ongoing-task visibility (including non-main agents)
- Todos / approvals / tools panels with source + fallback hints
- Artifact actions: `Copy path / Open / Download`
- Operations page: `/ops` runtime health overview

### API

- Unified observability envelope for core reads:
  - `GET /api/todos`
  - `GET /api/approvals`
  - `GET /api/tools`
  - `GET /api/subagents`
  - shape: `{ ok, source, error?, ...payload }`

### CLI control center

- `tasks now|jobs|agents|sessions|report|watchdog`
- confirmation-gated writes:
  - `tasks run`
  - `tasks enable`
  - `tasks disable`
  - `tasks kill` (whitelist only)
- cron schedule installer (report + watchdog)

## Suggested upstream plan

### v1 (easier to merge)

- Read-only overview for tasks/cron/sessions/subagents
- Runs history + failure aggregation
- Clear filtering/search/time-range UX

### v2 (harder, high-value)

- Control actions: run-now / enable-disable / kill
- Required safeguards:
  - permission checks
  - secondary confirmation
  - audit trail
  - secure-default disabled

## Notes

- This package is structured to be split into small PRs.
- v2 control actions are intentionally not proposed for immediate upstream merge.

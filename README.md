# Mission Control

Local-first Next.js dashboard + CLI control center for OpenClaw operations.

## What this includes

### Dashboard (existing MVP)

- Todo list with local JSON persistence (`data/mission-control/todos.json`)
- Subagent tracker UI (tries local OpenClaw API, falls back to stub data)
- Content approval queue (`tweet` / `thumbnail` / `script`)
- Tool cards:
  - Generate briefing stub
  - Create research pack stub
  - Trigger cron stub
- Tool activity artifacts support `Copy path / Open / Download`

### Control Center CLI (new)

- `tasks agents`: list backend subagents (`label/status/start/elapsed`)
- `tasks report`: runtime health report with Top 5 anomalies + human actions
- `tasks watchdog`: incident loop for cron failures/timeout/silence, with optional Linear auto issue creation
- `tasks run|enable|disable|kill`: control actions with one-time confirmation token
- `tasks schedule`: generate/install crontab for:
  - Daily report at `09:00` and `18:00`
  - Watchdog every `5` minutes

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## CLI usage

```bash
# 30-second answer: what is happening and what next
npm run tasks -- now

# List cron jobs
npm run tasks -- jobs

# List subagents
npm run tasks -- agents

# Health report (text)
npm run tasks -- report

# Health report (json)
npm run tasks -- report --json

# Watchdog (local incident records only)
npm run tasks -- watchdog

# Watchdog + auto-create Linear issues
npm run tasks -- watchdog --auto-linear
```

## API response contract

Read APIs return a consistent envelope for observability:

```json
{
  "ok": true,
  "source": "mission-control-store",
  "...": "payload fields"
}
```

When fallback/error occurs, APIs return:

```json
{
  "ok": false,
  "source": "mission-control-store",
  "error": "..."
}
```

Covered endpoints:

- `GET /api/todos`
- `GET /api/approvals`
- `GET /api/tools`
- `GET /api/subagents` (already had this shape)

### Write actions (with confirmation)

```bash
# 1) generate one-time code
npm run tasks -- confirm

# 2) use code for write action
npm run tasks -- disable <jobId> --confirm "CONFIRM <CODE>"
npm run tasks -- enable <jobId> --confirm "CONFIRM <CODE>"
npm run tasks -- run <jobId> --confirm "CONFIRM <CODE>"
npm run tasks -- kill <subagentId> --confirm "CONFIRM <CODE>"
```

`kill` is blocked unless the subagent ID is in whitelist.

## Scheduling

Preview crontab block:

```bash
npm run tasks -- schedule
```

Install crontab block:

```bash
npm run tasks -- schedule --apply
```

Install with report push target:

```bash
npm run tasks -- schedule --apply --channel discord --target channel:1468117725040742527
```

## Linear integration

Set env vars before running watchdog auto-create:

```bash
export LINEAR_API_KEY="lin_api_..."
export LINEAR_TEAM_KEY="OPS"
# optional
export LINEAR_TEAM_ID=""
export LINEAR_PROJECT_ID=""
```

Then:

```bash
npm run tasks -- watchdog --auto-linear
```

Incident trigger conditions:

- same cron `consecutiveErrors >= 2`
- timeout detected from last error text
- silent/stale schedule behavior

Issue body includes:

- `jobId` + job metadata
- latest error summary
- run log location (`~/.openclaw/cron/runs/<jobId>.jsonl`)
- suggested fix steps

## Config

Copy template and edit:

```bash
cp config/control-center.example.json config/control-center.json
```

Fields:

- `timezone`
- `report.channel` / `report.target`
- `control.killWhitelist`
- `watchdog.*`
- `linear.*`

## Storage files

Runtime files created by CLI/dashboard:

- `data/control-center/confirmations.json`
- `data/control-center/incidents.json`
- `data/control-center/report-cron.log`
- `data/control-center/watchdog-cron.log`
- Dashboard files under `data/mission-control/`:
  - `todos.json`
  - `approvals.json`
  - `subagents.json`
  - `tool-actions.json`
  - `cron-events.json`
  - `stubs/*.md`

## Operations page

`/ops` now shows runtime health snapshot:

- runtime active/warnings/sessions/subagents summary
- fallback/error states for runtime/subagents/todos/approvals/tools
- latest runtime tasks list

## Build check

```bash
npm run build
```

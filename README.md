# Mission Control

Local-first Next.js dashboard + CLI control center for OpenClaw operations.

Tracking page for ongoing OpenClaw development projects:

- `OPENCLAW_DEV_PROJECT_TRACKING.md`

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
- `tasks triage`: external input to Linear Triage issue
- `tasks remind`: due-soon + current-cycle reminders
- `tasks ingest-server`: webhook intake (`/triage`) + GitHub PR state sync (`/github/pr`)
- `tasks github-hooks`: install git hooks to enforce/add Linear ID in branch/commit
- `tasks github-sync`: poll GitHub PRs and sync Linear state (In Review/Done) without webhook dependency
- `tasks todoist-sync`: pull Todoist tasks and create Linear triage issues
- `tasks calendar-sync`: capture Google Calendar events from logged-in browser tab
- `tasks run|enable|disable|kill`: control actions with one-time confirmation token
- `tasks schedule`: generate/install crontab for:
  - Daily report at `09:00` and `18:00`
  - Watchdog every `5` minutes
  - Due-soon reminder daily + cycle reminder weekly

## Quick start

```bash
npm install
npm run control:start
```

Open `http://localhost:3000`.

`control:start` startup flow:

- auto-sync Linear SoT for team `openclaw` (`scripts/linear_sot_setup.py --apply`)
- auto-verify Linear SoT (`scripts/linear_sot_verify.py`)
- then start Next.js dev server

If you want only the dashboard without Linear bootstrap:

```bash
npm run dev
```

If you want only Linear sync/verify:

```bash
npm run linear:sync
npm run linear:verify
```

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

# One-line intake -> Linear Triage
npm run tasks -- triage --title "Fix Discord manual model switch" --source discord --labels needs-spec

# Reminder report from Linear
npm run tasks -- remind all --send

# Start webhook server for external systems
npm run tasks -- ingest-server --port 8788

# Install git hooks (branch/commit must contain Linear ID)
npm run tasks -- github-hooks --repo /Users/yizhi/.openclaw/workspace

# Poll GitHub PRs -> Linear state sync
npm run tasks -- github-sync

# Todoist -> Linear triage sync
npm run tasks -- todoist-sync

# Google Calendar snapshot sync (requires logged-in tab in openclaw browser profile)
npm run tasks -- calendar-sync
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
npm run tasks -- schedule --apply --channel discord --target channel:123456789012345678
```

Disable reminder cron lines:

```bash
npm run tasks -- schedule --without-reminders
```

Disable integration poll lines:

```bash
npm run tasks -- schedule --github-poll-minutes 0 --todoist-poll-minutes 0 --calendar-poll-minutes 0
```

## Linear integration

Set env vars before running watchdog auto-create:

```bash
export LINEAR_API_KEY="lin_api_..."
export LINEAR_TEAM_KEY="CLAW"
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

### External intake (Discord / forms / mail / Notion / Todoist)

Start webhook server:

```bash
npm run tasks -- ingest-server --port 8788
```

Create triage issue via webhook:

```bash
curl -X POST "http://127.0.0.1:8788/triage" \
  -H "Content-Type: application/json" \
  -d '{
    "source":"discord",
    "title":"修复 Discord 手动切模型不可切换",
    "description":"主代理任务反馈",
    "labels":["needs-spec","urgent"],
    "url":"https://discord.com/channels/..."
  }'
```

### GitHub -> Linear state sync

`/github/pr` endpoint supports GitHub `pull_request` webhook:

- PR opened/reopened/ready_for_review/review_requested -> move issue to `In Review`
- PR merged -> move issue to `Done`

Linear ID is extracted from PR title/body/branch, for example `CLAW-123`.

You can secure webhook with:

```bash
export GITHUB_WEBHOOK_SECRET="your_secret"
```

If webhook can not reach localhost, use polling mode:

```bash
npm run tasks -- github-sync
```

`github.token` will auto-read from `~/.openclaw/credentials/github-token.txt` when available.

### Todoist -> Linear sync

Todoist token can be provided by env/config:

```bash
export TODOIST_API_TOKEN="..."
npm run tasks -- todoist-sync
```

If token is not set, CLI tries to extract it from a logged-in Todoist tab in `openclaw` browser profile and persists to local `config/control-center.json`.

### Google Calendar sync

Capture events from current logged-in Google Calendar tab (browser profile `openclaw`):

```bash
npm run tasks -- calendar-sync
```

Optional: create Linear triage issues from captured events:

```bash
npm run tasks -- calendar-sync --to-linear
```

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
- `ingest.*`
- `reminders.*`
- `github.*`
- `todoist.*`
- `calendar.*`

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

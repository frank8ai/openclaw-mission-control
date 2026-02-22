# Mission Control

Local-first Next.js dashboard + CLI control center for OpenClaw operations.

Tracking page for ongoing OpenClaw development projects:

- `OPENCLAW_DEV_PROJECT_TRACKING.md`
- SOP index for mission-control automation:
  - `docs/sop/SOP_INDEX.md`
- Audit entry guide:
  - `docs/AUDIT_GUIDE.md`

## What this includes

### Dashboard (existing MVP)

- Todo list with local JSON persistence (`data/mission-control/todos.json`)
- Subagent tracker UI (tries local OpenClaw API, falls back to stub data)
- Runtime issue linkage view (group active tasks by Linear issue when available)
- Content approval queue (`tweet` / `thumbnail` / `script`)
- Tool cards:
  - Generate briefing stub
  - Create research pack stub
  - Trigger cron stub
- Tool activity artifacts support `Copy path / Open / Download`

### Control Center CLI (new)

- `tasks agents`: list backend subagents (`label/status/start/elapsed`)
- `tasks report`: runtime health report with Top 5 anomalies + human actions
- `tasks briefing`: daily/weekly briefing template (report + cycle + SLA watch), optional send
- `tasks watchdog`: incident loop for cron failures/timeout/silence, with optional Linear auto issue creation
- `tasks triage`: external input to Linear Triage issue
- `tasks remind`: due-soon + current-cycle reminders
- `tasks ingest-server`: webhook intake (`/triage` + `/discord/message`) + GitHub PR state sync (`/github/pr`)
- `tasks github-hooks`: install git hooks to enforce/add Linear ID in branch/commit
- `tasks github-sync`: poll GitHub PRs and sync Linear state (In Review/Done) without webhook dependency
- `tasks todoist-sync`: pull Todoist tasks and create Linear triage issues
- `tasks todoist-backsync`: mark Todoist tasks done when linked Linear issue reaches Done
- `tasks calendar-sync`: capture Google Calendar events from logged-in browser tab
- `tasks status-sync`: auto status machine (`Triage -> In Progress -> In Review -> Done/Blocked`) for linked runtime issues
- `tasks queue-drain`: retry ingest queue and move exhausted items to DLQ
- `tasks queue-replay`: replay DLQ payloads back to queue (single/batch, optional immediate drain)
- `tasks queue-stats`: inspect queue/DLQ health, retry buckets, and top sources
- `tasks ingest-test`: acceptance checks for idempotency + DLQ + replay loop
- `tasks binding-coverage`: coverage report + auto-repair for session/subagent -> Linear issue mapping
- `tasks webhook-metrics`: webhook p95/volume/replay-protection metrics
- `tasks webhook-test`: acceptance check for replay protection + latency budget
- `tasks executor-test`: acceptance check for lock, retry classes (`rate_limit/lock_conflict/timeout/unknown`)
- `tasks state-machine-rules`: config-driven rule versions + validate/rollback
- `tasks audit-rollback`: rollback auditable local JSON writes by audit id
- `tasks sla-check`: stale issue SLA check (Blocked/In Progress) with owner mention + escalation issue
- `tasks linear-autopilot`: pull one runnable Linear issue and let configured execution agent execute exactly one next step, then auto comment/state update (supports `--issue CLAW-123`, `--agent <id>`, `--agent auto`)
- `tasks linear-engine`: run multiple `linear-autopilot` steps for one issue until `done/blocked/max-steps`
- `tasks eval-replay`: export replay artifact for eval/distillation workflow
- `tasks runbook-exec`: run SOP runbook cards in dry-run or guarded execute mode
- `tasks trigger`: one-click run for sync/report/watchdog jobs with confirmation token
- `tasks autopr`: guarded low-risk auto PR flow (dry-run default)
- `tasks run|enable|disable|kill`: control actions with one-time confirmation token
- `tasks approve`: one-time approval token for high-risk write actions (`run/enable/disable/kill/trigger/autopr/runbook-exec`)
- `tasks schedule`: generate/install crontab with mode switch:
  - `minimal` (default): `discord-intake-sync` + `queue-drain` + `linear-autopilot`
  - `full`: report/watchdog/github/todoist/calendar/status/sla + reminders/briefing + minimal loop

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

## Runtime Issue Linking (P0)

Mission Control links active runtime tasks to Linear in two ways:

1. Auto-detect issue IDs from task text (e.g. `CLAW-123`)  
   - default allowed team key: `CLAW`
   - optional override: `CONTROL_CENTER_ISSUE_TEAM_KEYS="CLAW,OPS"`
2. Manual binding file (recommended for Discord sessions without issue ID in text):  
   `data/control-center/runtime-issue-links.json`

Example manual binding:

```json
{
  "byTaskId": {
    "session:main:agent:main:discord:channel:1468117725040742527": "CLAW-123"
  },
  "bySessionId": {
    "0e75fa5e-7182-4d13-8f1d-639655d081a5": "CLAW-123"
  },
  "bySessionKey": {
    "agent:codex:discord:channel:1473998332031533157": "CLAW-124"
  },
  "bySubagentId": {
    "subagent-1": "CLAW-125"
  },
  "byCronId": {
    "e9598af8-438a-4b04-a532-817343723772": "CLAW-126"
  }
}
```

Reference template: `config/runtime-issue-links.example.json`

After writing the file, refresh `/` or `/ops`. Linked issue cards and summary counters are updated automatically.

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

# Idempotent intake (source + sourceId)
npm run tasks -- triage --title "..." --source discord --source-id discord:msg:123

# Reminder report from Linear
npm run tasks -- remind all --send

# Daily briefing template
npm run tasks -- briefing daily --send

# Weekly briefing template
npm run tasks -- briefing weekly --send

# Start webhook server for external systems
npm run tasks -- ingest-server --port 8788

# Install git hooks (branch/commit must contain Linear ID)
npm run tasks -- github-hooks --repo /Users/yizhi/.openclaw/workspace

# Poll GitHub PRs -> Linear state sync
npm run tasks -- github-sync

# Todoist -> Linear triage sync
npm run tasks -- todoist-sync

# Linear Done -> Todoist complete
npm run tasks -- todoist-backsync

# Google Calendar snapshot sync (requires logged-in tab in openclaw browser profile)
npm run tasks -- calendar-sync

# Runtime-linked issue status machine + comment trail
npm run tasks -- status-sync

# Retry queued ingest items
npm run tasks -- queue-drain

# Replay DLQ item(s) back to queue
npm run tasks -- queue-replay --all --drain

# Queue/DLQ health snapshot
npm run tasks -- queue-stats --json

# Ingest acceptance checks
npm run tasks -- ingest-test --json

# Runtime binding coverage report (auto-repair + orphan auto-bind)
npm run tasks -- binding-coverage --json

# Webhook metrics / acceptance checks
npm run tasks -- webhook-metrics --json
npm run tasks -- webhook-test --json

# Executor stability acceptance checks
npm run tasks -- executor-test --json

# Status machine rules (config-driven versions)
npm run tasks -- state-machine-rules --json
npm run tasks -- state-machine-rules --validate --json

# Stale SLA checks + escalation
npm run tasks -- sla-check

# Execute one Linear issue step via configured execution agent (auto comment/state)
npm run tasks -- linear-autopilot

# Execute one specific Linear issue step
npm run tasks -- linear-autopilot --issue CLAW-128 --json

# Execute using auto agent selector (round-robin over available agents, with optional allow/deny list in config)
npm run tasks -- linear-autopilot --issue CLAW-128 --agent auto --json

# Execute multiple steps for one specific issue
npm run tasks -- linear-engine --issue CLAW-128 --max-steps 5 --json

# Backfill around a specific Discord message id (one-time import of historical directives)
npm run tasks -- discord-intake-sync --around <MESSAGE_ID> --backfill --limit 60

# Trigger one-click control job (requires confirm token)
npm run tasks -- trigger github-sync --confirm "CONFIRM <CODE>"

# High-risk write approval token
npm run tasks -- approve --action trigger

# Guarded auto PR (dry-run default)
npm run tasks -- autopr --issue CLAW-123

# Eval replay artifact for distillation
npm run tasks -- eval-replay --emit-plan

# Runbook v2 (default dry-run)
npm run tasks -- runbook-exec --card cron-recover --issue CLAW-123

# Runbook v2 execute mode (requires confirm token + runbook.allowExecute=true)
npm run tasks -- runbook-exec --card cron-recover --issue CLAW-123 --confirm "CONFIRM <CODE>" --execute

# Rollback auditable local writes by audit id
npm run tasks -- audit-rollback --audit-id <AUDIT_ID> --confirm "CONFIRM <CODE>" --approval "APPROVE <CODE>"
```

## Auditable data artifacts

All control-plane evidence is stored in `data/control-center/`:

- `ingest-queue.json` / `ingest-dlq.json`: unified ingest queue + DLQ
- `ingest-ledger.json`: idempotency ledger (`source + sourceId + eventType`)
- `runtime-issue-links.json`: forward + reverse runtime binding indexes
- `binding-coverage.json`: latest coverage report (`orphan` target = 0)
- `webhook-metrics.json`: webhook latency/replay metrics
- `webhook-replay-index.json`: replay protection index
- `executor-stability.json`: executor resilience reports
- `status-machine-versions.json`: config-driven state-machine versions
- `audit.jsonl`: immutable audit trail with `auditId`
- `rollback-journal.json`: rollback snapshots keyed by `auditId`
- `approvals.json`: one-time approval tokens for high-risk writes

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
npm run tasks -- trigger github-sync --confirm "CONFIRM <CODE>"
npm run tasks -- autopr --issue CLAW-123 --confirm "CONFIRM <CODE>" --execute
npm run tasks -- runbook-exec --card queue-backlog --issue CLAW-123 --confirm "CONFIRM <CODE>" --execute
```

`kill` is blocked unless the subagent ID is in whitelist.
`autopr --execute` is blocked unless `autopr.allowExecute=true`.
`runbook-exec --execute` is blocked unless `runbook.allowExecute=true`.

## Scheduling

Preview crontab block:

```bash
npm run tasks -- schedule
```

Preview minimal mode explicitly:

```bash
npm run tasks -- schedule --mode minimal
```

Preview full mode explicitly:

```bash
npm run tasks -- schedule --mode full
```

Install crontab block:

```bash
npm run tasks -- schedule --apply
```

Install minimal mode (default):

```bash
npm run tasks -- schedule --apply --mode minimal
```

Install full mode:

```bash
npm run tasks -- schedule --apply --mode full
```

Install minimal mode with auto agent selector for autopilot lane:

```bash
npm run tasks -- schedule --apply --mode minimal --agent auto
```

Install with report push target:

```bash
npm run tasks -- schedule --apply --mode full --channel discord --target channel:123456789012345678
```

Disable reminder cron lines (full mode):

```bash
npm run tasks -- schedule --mode full --without-reminders
```

Disable briefing cron lines (full mode):

```bash
npm run tasks -- schedule --mode full --without-briefing
```

Disable integration poll lines (full mode):

```bash
npm run tasks -- schedule --mode full --github-poll-minutes 0 --todoist-poll-minutes 0 --calendar-poll-minutes 0
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
- failure signature + runbook card
- executable next-step commands
- possible causes list

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

Create triage issue from Discord webhook payload directly:

```bash
curl -X POST "http://127.0.0.1:8788/discord/message" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId":"123456789",
    "channelId":"987654321",
    "guildId":"1122334455",
    "content":"CLAW-123 discord 上手动切换模型不可用，报 timeout",
    "author":"frank",
    "url":"https://discord.com/channels/1122334455/987654321/123456789"
  }'
```

### GitHub -> Linear state sync

`/github/pr` endpoint supports GitHub `pull_request` webhook:

- PR opened/reopened/ready_for_review/review_requested -> move issue to `In Review`
- PR merged -> move issue to `Done`
- on state transition, webhook posts evidence comment back to Linear

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

Close Todoist tasks from Linear completion:

```bash
npm run tasks -- todoist-backsync
```

### SourceId idempotency (dedupe)

To avoid duplicate issues from multi-channel intake (Discord/Todoist/Calendar/webhook), provide:

- `source`
- `sourceId`

The pair is indexed at:

- `data/control-center/triage-source-index.json`

If the same `source + sourceId` arrives again, Mission Control returns the existing issue instead of creating a duplicate.

If `source` exists but `sourceId` is missing, Mission Control now derives a deterministic fallback sourceId from payload fingerprint (title/text/description/sourceUrl/author), then applies the same dedupe logic.

Additional dedupe layer:

- `data/control-center/triage-signature-index.json`

This suppresses repeats with the same intake signature (especially repeated repo+error alerts).

### Ingest queue + DLQ

When triage creation fails (e.g. Linear transient error), payload is queued automatically. This now covers webhook and non-webhook intake paths (`discord-intake-sync`, `todoist-sync`, `calendar-sync`, `memo-save`, `sla-check` escalation, and circuit-ops issue open).

Files:

- queue: `data/control-center/ingest-queue.json`
- dead letter: `data/control-center/ingest-dlq.json`

Manual retry:

```bash
npm run tasks -- queue-drain

# inspect queue / dlq distribution
npm run tasks -- queue-stats
```

Queue behavior:

- exponential backoff
- max retries configurable via `intakeQueue.maxRetries`
- exceeds max retries -> moved to DLQ
- queue dedupe by `source:sourceId` to prevent duplicate pending entries

### SLA automation

`sla-check` scans open issues and applies stale rules:

- `Blocked` over threshold -> owner mention + optional escalation issue
- `In Progress` stale over threshold -> owner mention reminder

`remind` can include SLA watch and optional blocked auto-escalation:

```bash
npm run tasks -- remind all --auto-escalate --send
```

State file:

- `data/control-center/sla-check.json`

### Briefing automation

`briefing` combines runtime health report + cycle focus + SLA watch into one daily/weekly message.

```bash
npm run tasks -- briefing daily --send
npm run tasks -- briefing weekly --send
```

### Runtime status machine

`status-sync` reads linked runtime signals and moves issue state automatically:

- active runtime -> `In Progress`
- open PR signal -> `In Review`
- merged PR signal -> `Done`
- cron warning signal -> `Blocked`

On state change, it posts a Linear comment with session/cron/github evidence.

Audit trail:

- `data/control-center/audit.jsonl`

### Runbook semi-auto (v2)

`runbook-exec` provides guarded recovery cards with strict allowlist:

- `model-failover`
- `cron-recover`
- `queue-backlog`
- `issue-refresh`

Safety defaults:

- default mode is dry-run
- execute mode requires one-time `CONFIRM` token
- execute mode requires `runbook.allowExecute=true`
- each action is validated against `runbook.allowedActions`

### Google Calendar sync

Capture events from current logged-in Google Calendar tab (browser profile `openclaw`):

```bash
npm run tasks -- calendar-sync
```

Optional: create Linear triage issues from captured events:

```bash
npm run tasks -- calendar-sync --to-linear
```

If an event is already mapped to a Linear issue, `calendar-sync --to-linear` updates that issue title/description with latest snapshot text.

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
- `briefing.*`
- `github.*`
- `todoist.*`
- `calendar.*`
- `statusMachine.*`
- `intakeQueue.*`
- `sla.*`
- `runbook.*`
- `execution.*` (including `agentId`, `agentPreferred`, `agentAllowlist`, `agentDenylist`)

`execution.agentId` behavior:

- fixed agent id (for example `codex`, `coder`, `main`)
- `auto` / `any` / `*`: round-robin across available agents (optionally constrained by allow/deny list)

## Storage files

Runtime files created by CLI/dashboard:

- `data/control-center/confirmations.json`
- `data/control-center/incidents.json`
- `data/control-center/status-sync.json`
- `data/control-center/triage-source-index.json`
- `data/control-center/triage-signature-index.json`
- `data/control-center/ingest-queue.json`
- `data/control-center/ingest-dlq.json`
- `data/control-center/sla-check.json`
- `data/control-center/runbook-exec.json`
- `data/control-center/audit.jsonl`
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

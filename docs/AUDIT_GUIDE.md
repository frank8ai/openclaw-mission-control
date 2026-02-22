# Mission Control Audit Guide

This guide lists where to find source code, runtime evidence, and how to replay key checks for audit.

## Repository

- Repository root:
  - `/Users/yizhi/.openclaw/workspace/mission-control`
- Git remote:
  - `https://github.com/frank8ai/openclaw-mission-control.git`
- Main orchestration code:
  - `scripts/tasks.js`

## Core Config

- Runtime config:
  - `config/control-center.json`
- Config template:
  - `config/control-center.example.json`

## Primary Evidence Directory

- All control-plane runtime artifacts:
  - `data/control-center/`

High-value files:

- Execution and audit:
  - `data/control-center/linear-autopilot.json`
  - `data/control-center/audit.jsonl`
  - `data/control-center/executor-stability.json`
  - `data/control-center/runtime-issue-links.json`
- Queue and reliability:
  - `data/control-center/ingest-queue.json`
  - `data/control-center/ingest-dlq.json`
  - `data/control-center/ingest-ledger.json`
- Acceptance and evidence snapshots:
  - `data/control-center/acceptance-report-2026-02-22.md`
  - `data/control-center/evidence-p0-1-ingest-test.json`
  - `data/control-center/evidence-p0-2-executor-test.json`
  - `data/control-center/evidence-p0-3-binding-coverage.json`
  - `data/control-center/evidence-p1-4-webhook-test.json`
  - `data/control-center/evidence-p1-5-state-validate.json`
  - `data/control-center/evidence-p2-6-audit-rollback.json`

## Scheduling Modes

- Minimal loop (default):
  - `discord-intake-sync`
  - `queue-drain`
  - execution loop (`linear-autopilot` or `linear-engine`)
- Full loop:
  - Includes report/watchdog/github/todoist/calendar/status/sla/reminders/briefing in addition to minimal loop.

Apply mode:

```bash
cd /Users/yizhi/.openclaw/workspace/mission-control
npm run tasks -- schedule --apply --mode minimal
npm run tasks -- schedule --apply --mode full
npm run tasks -- schedule --apply --mode minimal --agent auto
npm run tasks -- schedule --apply --mode minimal --execution-loop engine --engine-max-steps 3 --agent auto
```

Inspect installed block:

```bash
crontab -l | sed -n '/OPENCLAW_CONTROL_CENTER_BEGIN/,/OPENCLAW_CONTROL_CENTER_END/p'
```

## Focused Re-run Commands

Run one autopilot step against any runnable issue:

```bash
npm run tasks -- linear-autopilot --json
```

Force a specific issue:

```bash
npm run tasks -- linear-autopilot --issue CLAW-128 --json
```

Force auto agent selector (round-robin over available agents):

```bash
npm run tasks -- linear-autopilot --issue CLAW-128 --agent auto --json
```

Run a bounded multi-step execution loop for one issue:

```bash
npm run tasks -- linear-engine --issue CLAW-128 --max-steps 5 --json
```

Run a bounded multi-step execution loop with auto-picked runnable issue:

```bash
npm run tasks -- linear-engine --max-steps 3 --agent auto --json
```

Key acceptance checks:

```bash
npm run tasks -- ingest-test --json
npm run tasks -- executor-test --json
npm run tasks -- binding-coverage --json
npm run tasks -- webhook-test --json
npm run tasks -- state-machine-rules --validate --json
```

## Scope Note

This repository is focused on mission-control orchestration and evidence.
If the auditor also needs the broader workspace context, the parent workspace is:

- `/Users/yizhi/.openclaw/workspace`

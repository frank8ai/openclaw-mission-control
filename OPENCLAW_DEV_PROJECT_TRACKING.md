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

## Automation Checklist (SOP Routed)

1. `taskId <-> session/subagent` 绑定与按 issue 展示
- Status: `Done`
- Evidence:
  - `src/lib/openclaw-runtime.ts`
  - `src/components/mission-control-dashboard.tsx`
  - `src/app/ops/page.tsx`

2. 自动状态机流转 + 自动评论留痕
- Status: `Done`
- Evidence:
  - `scripts/tasks.js` (`status-sync`)
  - `data/control-center/status-sync.json`

3. 去重与幂等（sourceId）
- Status: `Done (v1)`
- Evidence:
  - `scripts/tasks.js` (`triage` + intake adapters)
  - `data/control-center/triage-source-index.json`

4. 可靠投递层（queue + retry + DLQ）
- Status: `Done (v1)`
- Evidence:
  - `scripts/tasks.js` (`queue-drain`, ingest enqueue)
  - `data/control-center/ingest-queue.json`
  - `data/control-center/ingest-dlq.json`

5. SLA 自动化（stale/blocked）
- Status: `Done (v1)`
- Evidence:
  - `scripts/tasks.js` (`sla-check`)
  - `data/control-center/sla-check.json`

6. 自动修复 Runbook
- Status: `Done (v1 suggestion mode)`
- Evidence:
  - `docs/sop/SOP_MC_Runbook_AutoFix_v1.md`
  - `scripts/tasks.js` (`status-sync` suggested runbook hints)

7. 审计与权限（write actions）
- Status: `Done (v1)`
- Evidence:
  - `scripts/tasks.js` audit appends
  - `data/control-center/audit.jsonl`

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

## SOP Execution Log

### 2026-02-20 21:18
- SOP Route Card:
  - task: 将 OpenClaw 正在运行的 session/subagent 与 Linear issue 绑定，并在 Mission Control 按 issue 视角展示。
  - owner: codex
  - classification: asset-compound
  - priority: P0
  - risk: medium (状态可视化改造，读取本地状态+Linear API，不改生产写操作)
  - chosen_sop: `SOP/SOP_Router_v1.md` + `SOP/SOP_Preflight_Counterexample_Gate_v1.md` + `SOP/SOP_Task_Tagging_High_Leverage_v1.md`
  - asset_output:
    - type: `code` + `doc`
    - path: `src/lib/openclaw-runtime.ts`, `src/components/mission-control-dashboard.tsx`, `src/app/ops/page.tsx`, `README.md`, `OPENCLAW_DEV_PROJECT_TRACKING.md`
  - stop_condition: 如出现 issue 误识别（false positive）或 runtime 接口延迟明显升高，先回退自动识别并仅保留手动绑定。

- Preflight Counterexample Gate:
  - minimal_success: 在 `/` 和 `/ops` 页面看到 `Linked Issues`，并显示 linked/unlinked 计数；未绑定任务清晰标注。
  - counterexamples:
    - C1 execution: 运行态来源差异导致没有可绑定字段。
      - mitigation: 以 `taskId/sessionKey/sessionId/subagentId/cronId` 多键绑定，任一命中即可。
    - C2 quality: 自动识别把模型名（如 `gpt-5`）误判为 issue。
      - mitigation: 只允许指定 team key（默认 `CLAW`）格式进入自动识别，并支持手动覆盖。
    - C3 risk: Linear API 不可用时导致页面异常。
      - mitigation: 线性查询失败降级为本地任务展示，不阻断 runtime 快照。
  - decision: PASS
  - preflight: PASS + 风险可控且有降级策略

- Task Tagging:
  - tags: Asset, Growth, Risk
  - DoD: 你可在 30 秒内看见“有哪些 issue 在跑、哪些任务没绑定、每个 issue 的运行/告警数量”。

- Verification:
  - `npm run lint` 通过
  - `GET /api/runtime/tasks` 返回 `issues` + 新 summary 字段（`linkedIssues/linkedTasks/unlinkedActive`）

### 2026-02-20 21:42
- What changed:
  - Added `status-sync` (auto transitions + evidence comments).
  - Added sourceId idempotency index.
  - Added ingest retry queue + DLQ (`queue-drain`).
  - Added SLA stale checks (`sla-check`) with optional escalation issue.
  - Added audit trail (`audit.jsonl`) for state/control/queue events.
  - Added mission-control SOP set under `docs/sop/`.
- Current state:
  - P0 and P1-v1 automation loop is runnable by cron.
  - Runbook now in suggestion mode (safe, non-destructive).
- Blockers:
  - v2 runbook semi-auto execution not implemented yet.
- Next action:
  - implement runbook mapping + guarded semi-auto command execution.
- Links:
  - `docs/sop/SOP_INDEX.md`

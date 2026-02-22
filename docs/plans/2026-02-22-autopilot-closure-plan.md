# 2026-02-22 Mission Control Autopilot Closure Plan

## Scope

Close the remaining automation gaps that block a reliable end-to-end loop:

1. Intake reliability: all non-webhook issue creation paths should have queue/DLQ fallback.
2. Idempotency hardening: provide deterministic sourceId fallback when source exists but sourceId is missing.
3. Observability: expose queue health and source distribution in machine-readable output.
4. Operational docs: update README and SOP with the new flow and verification commands.

## Acceptance Criteria

### AC-1 Unified queue fallback

- Discord intake sync, Todoist sync, Calendar sync, and memo-save linear creation paths use a shared helper.
- When direct `createTriageIssueFromInput` fails and intake queue is enabled:
  - payload is enqueued to `ingest-queue.json`,
  - a structured result indicates `queued=true`,
  - audit event is written with source context.
- Existing webhook behavior remains compatible.

### AC-2 Idempotency fallback

- If `source` is present but `sourceId` is empty, system computes deterministic sourceId based on source + normalized issue content fingerprint.
- Returned issue payload includes a marker that sourceId was auto-derived.
- Existing explicit sourceId behavior is unchanged.

### AC-3 Queue observability

- Add queue stats command returning JSON summary:
  - queued count, dlq count,
  - retry buckets,
  - top sources in queue and DLQ.
- Include concise non-JSON terminal output for operators.

### AC-4 Documentation

- README includes:
  - unified intake reliability behavior,
  - queue stats command usage,
  - idempotency fallback notes.
- SOP index links to the new plan/SOP update.

## Implementation Order

1. Build shared triage creation helper with queue fallback.
2. Route all identified non-webhook intakes to the helper.
3. Add deterministic sourceId fallback in triage creation path.
4. Add queue stats command and CLI help.
5. Update docs.
6. Validate with lint + targeted command checks.

## Verification Commands

```bash
npm run lint
npm run tasks -- queue-stats --json
npm run tasks -- todoist-sync --json
npm run tasks -- calendar-sync --json
npm run tasks -- discord-intake-sync --json
```

## Delivery Notes

- This plan is intended to be completed in one pass with one merge commit.
- Any external API instability should degrade to queue/DLQ without dropping intake payloads.

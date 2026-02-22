# SOP: Mission Control Intake Reliability v2

## Objective

Guarantee that triage intake payloads are not dropped when Linear write fails, across both webhook and non-webhook sources.

## Coverage

- `ingest-server` (`/triage`, `/discord/message`)
- `discord-intake-sync`
- `todoist-sync`
- `calendar-sync`
- `memo-save --create-linear`
- `sla-check` blocked escalation issue creation
- `linear-autopilot` circuit-open ops issue creation

## Required Behavior

1. Use shared triage creation wrapper with queue fallback.
2. On failure:
   - enqueue into `data/control-center/ingest-queue.json`,
   - include `source`, `sourceId`, and queue id in audit event.
3. Retry via `queue-drain` with backoff and DLQ transfer at max retries.
4. Prevent duplicate queue entries using `source:sourceId` dedupe key.

## Operator Commands

```bash
# health snapshot
npm run tasks -- queue-stats --json

# delivery retries
npm run tasks -- queue-drain --json
```

## Acceptance Checklist

- Queue fallback works for all paths in Coverage.
- `queue-stats` reports queue count, dlq count, retry buckets, top sources.
- Duplicate failures for the same `source:sourceId` do not create duplicate queue items.
- Audit log contains queue enqueue/dedupe/dlq transitions.

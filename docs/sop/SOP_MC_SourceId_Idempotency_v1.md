# SOP: Mission Control sourceId Idempotency v1

## Invoke
- `npm run tasks -- triage --source <src> --source-id <id> ...`

## Goal
- Prevent duplicate issues from multi-entry intake (Discord/Todoist/Calendar/Webhook).

## Inputs
- `source`
- `sourceId`

## Steps
1. Normalize dedupe key:
  - `dedupeKey = lower(source) + ":" + normalize(sourceId)`.
2. Check index file:
  - `data/control-center/triage-source-index.json`
3. If key exists:
  - return existing issue (`deduped=true`)
  - do not create new issue.
4. If key not found:
  - create issue in Linear
  - write key -> issue mapping to source index.
5. Ensure adapters pass sourceId:
  - manual triage
  - webhook triage
  - todoist sync
  - calendar sync

## Acceptance
- Second call with same `source + sourceId` returns same identifier.
- No duplicate issue created for repeated payload.

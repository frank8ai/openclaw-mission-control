# SOP: Mission Control Queue + DLQ v1

## Invoke
- ingest path auto enqueue on failure
- manual drain: `npm run tasks -- queue-drain`

## Goal
- Avoid losing intake payloads when external APIs fail.

## Storage
- queue: `data/control-center/ingest-queue.json`
- DLQ: `data/control-center/ingest-dlq.json`

## Steps
1. On ingest triage failure:
  - enqueue payload with retry metadata.
2. Queue drain worker:
  - pick ready items (`nextAttemptAtMs <= now`)
  - attempt delivery
  - on success: remove from queue
  - on failure: increase attempts + exponential backoff
  - if attempts >= maxRetries: move to DLQ
3. Write audit lines for enqueue/deliver/retry/dlq.
4. Schedule periodic drain with cron.

## Acceptance
- Failed intake can be retried without payload loss.
- Exhausted payloads land in DLQ for manual inspection.
- `queue-drain --json` shows delivered/retried/dlq counts.

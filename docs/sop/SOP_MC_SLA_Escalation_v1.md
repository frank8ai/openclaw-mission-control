# SOP: Mission Control SLA Escalation v1

## Invoke
- `npm run tasks -- sla-check`

## Goal
- Auto detect stale issues and force owner update/escalation.

## Rules
- `Blocked` stale threshold: default 8h
- `In Progress` stale threshold: default 24h
- Comment cooldown: default 24h

## Steps
1. Query open team issues from Linear.
2. Compute stale age from `updatedAt`.
3. Filter stale targets:
  - blocked stale
  - in-progress stale
4. Post SLA comment on issue:
  - include stale age + threshold
  - mention owner (or fallback `@owner`)
5. For blocked stale items:
  - create escalation triage issue (deduped by `sourceId`).
6. Persist state:
  - `data/control-center/sla-check.json`
7. Append audit records.

## Acceptance
- `sla-check --json` reports checked/stale/commented/escalated.
- Repeated runs do not spam same comment inside cooldown.

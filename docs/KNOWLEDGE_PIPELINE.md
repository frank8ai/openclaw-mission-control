# Knowledge Pipeline (Discord -> Obsidian + Linear)

This repo supports a "dual-track" capture pipeline:

- Linear: execution (tasks, milestones, ownership, status)
- Obsidian (Markdown): knowledge (plans, decisions, comparisons, sources)

## Goals

- Low-friction capture from Discord discussions.
- Every captured memo has:
  - a durable Markdown page (for reading/searching)
  - a Linear issue link (for execution)
  - a Source link back to the original Discord message

## Storage

- Workspace Obsidian vault (default):
  - `/Users/yizhi/.openclaw/workspace/Obsidian`

- Knowledge pages directory (default):
  - `Obsidian/Knowledge/` (created if missing)

## Capture Trigger (recommended)

- In Discord: append `#memo` or `#save` to a message (human convention)
- Then call:

```bash
cd /Users/yizhi/.openclaw/workspace/mission-control
npm run tasks -- memo-save \
  --channel-id <discord_channel_id> \
  --message-id <discord_message_id> \
  --title "<memo title>" \
  --labels "research,decision" \
  --create-linear \
  --json
```

This:
- fetches the target message (+ context window)
- writes a Markdown memo into the Obsidian vault
- creates (or updates) a Linear Triage issue and links to the memo

## Memo Template (generated)

- Title
- TL;DR
- Background
- Proposal / Options
- Next Steps (v1/v2/v3)
- Risks
- Links
  - Linear issue
  - Discord source

## Notes

- Do NOT store secrets in memos. Use placeholders like `[REDACTED]`.
- Prefer short, actionable memos (1-2 screens).

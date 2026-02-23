---
name: codex-deep-search
description: "Use Codex CLI live web search for deep research tasks, save artifacts locally, and optionally notify Telegram/OpenClaw on completion."
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["bash", "codex"] },
      },
  }
---

# Codex Deep Search

Use Codex CLI (`codex --search exec`) to run deep web research with minimal manual steps.

## What this skill does

- Runs Codex with live web search enabled.
- Saves prompt/output artifacts to local files for auditing and reuse.
- Supports optional Telegram callback.
- Supports optional OpenClaw wake event on completion.
- Supports SOP-guided search modes (`auto|web|deep|off`).

## Local defaults (already set for this machine)

- `RESULT_DIR=/Users/yizhi/.openclaw/workspace/data/codex-deep-search`
- `OPENCLAW_BIN=$(command -v openclaw)`
- `CODEX_BIN=$(command -v codex || true)`
- `OPENCLAW_CONFIG=/Users/yizhi/.openclaw/openclaw.json`

## Quick start

```bash
bash skills/codex-deep-search/scripts/search.sh \
  --prompt "Compare 3 local inference frameworks available in 2026 and provide tradeoffs and rollout advice" \
  --task-name "local-infer-compare" \
  --sop auto \
  --timeout 300
```

SOP mode examples:

```bash
# Normal web research (HQ-Web-Research gates)
bash skills/codex-deep-search/scripts/search.sh \
  --prompt "Summarize current model fallback best practices" \
  --sop web

# Decision-grade high-impact research (HQ-Deep-Research gates)
bash skills/codex-deep-search/scripts/search.sh \
  --prompt "Design migration strategy for production model routing with rollback KPIs" \
  --sop deep \
  --timeout 600
```

With Telegram callback:

```bash
bash skills/codex-deep-search/scripts/search.sh \
  --prompt "帮我整理最近一周 AI coding agent 关键发布" \
  --task-name "ai-agent-weekly" \
  --telegram-group "-1001234567890" \
  --sop auto \
  --timeout 180
```

## Background mode example

```bash
nohup bash skills/codex-deep-search/scripts/search.sh \
  --prompt "你的深度检索问题" \
  --task-name "my-research" \
  --telegram-group "<your-telegram-chat-id>" \
  --sop auto \
  --timeout 120 > /tmp/codex-search.log 2>&1 &
```

## Outputs

Each task creates a folder:

`/Users/yizhi/.openclaw/workspace/data/codex-deep-search/<task-name>/`

Files:
- `prompt.txt` - final prompt sent to Codex
- `raw_output.log` - full CLI output
- `last_message.txt` - final assistant message
- `meta.env` - execution metadata

## Notes

- Requires Codex CLI login to be ready (`codex login`).
- If `timeout/gtimeout` is unavailable, the script runs without hard timeout limit.
- Use `--dry-run` first when validating arguments.
- Default SOP mode is `auto`:
  - auto -> `web` for normal research
  - auto -> `deep` for high-impact/security/architecture-like prompts

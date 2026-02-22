# Local Model Distillation Guide

This document defines how Mission Control collects and exports local data for OpenClaw resident-model training.

## Scope

Collect both:

- coding/execution turns (`sft_turn`)
- operation/rule traces (`ops_event`)

Target: improve local coding-agent reliability in OpenClaw workflows (not general-purpose model parity).

## Data Sources

- replay artifact: `data/control-center/eval-replay/replay-*.json`
- agent sessions: `~/.openclaw/agents/<agent>/sessions/*.jsonl`
- Codex CLI sessions: `~/.codex/sessions/**/*.jsonl`
- operation audit trail: `data/control-center/audit.jsonl`

`distill-export` uses replay as the base and supplements with latest live sessions to reduce missing recent runs.

## Export Commands

All data (SFT only):

```bash
npm run tasks -- distill-export --include-audit false --json
```

Codex-focused data (SFT only):

```bash
npm run tasks -- distill-export --agent codex --include-audit false --json
```

Codex-focused data with operation rules:

```bash
npm run tasks -- distill-export --agent codex --include-audit true --json
```

Disable Codex CLI ingestion if needed:

```bash
npm run tasks -- distill-export --include-codex-cli false --json
```

Artifacts are written to:

- `data/control-center/distill/dataset-*.jsonl`
- `data/control-center/distill/dataset-*.manifest.json`

## Data Quality Rules

- keep both success and blocked/failed trajectories
- keep tool-call traces (`includeToolTrace=true`) for execution-policy learning
- keep audit events (`includeAudit=true`) for operation-rule learning
- redact sensitive strings before writing dataset rows

## Current Snapshot (2026-02-22)

From local exports:

- all agents, SFT only:
  - rows: `1310`
  - sessions processed: `37`
  - sessions missing file: `6`
  - Codex CLI rows: `608`
  - chars (input+output): `1296878`
- codex only, SFT only:
  - rows: `637`
  - (`codex` from OpenClaw sessions: `29`, `codex-cli`: `608`)
  - chars (input+output): `393583`
- codex only, SFT + ops_event:
  - rows: `658` (`637` SFT + `21` ops_event)

## Distillation Readiness

Practical readiness bands for local workflow tuning:

- pilot: `500+` high-quality SFT rows (already reached globally)
- v1 stable resident model: `5k-20k` SFT rows + consistent failure/rule traces
- strong domain-specialized performance: `50k+` high-quality rows + strict replay-based eval gates

Note: reaching "Qwen-30B-level" in broad coding intelligence is not realistic via small local distillation.  
For OpenClaw-specific task distribution, system-level quality can still exceed larger single-pass baselines with enough trajectory + verification data.

# Model Tier Routing Policy (v1)

## 1. Model Tiers
- **Medium (Default)**: `minimax-portal/MiniMax-M2.5`
  - Used for all standard sync jobs and normal autopilot runs.
- **X-High (Escalation)**: `sub2api/gpt-5.3-codex-x-high`
  - Used only for issues with specific escalation labels.

## 2. Routing Rules
- **Normal Flow**: Default to Medium cost model.
- **Escalation Trigger**: If any of the following labels are present on the Linear issue:
  - `blocked`
  - `fix-complexity`
  - `p0` (optional, based on priority)
- **Fallback**: If the selected model fails, standard OpenClaw fallback chain applies.

## 3. Implementation Plan
- [x] Add `modelRouting` configuration to `control-center.json` (merged into `DEFAULTS`).
- [x] Update `scripts/tasks.js` to calculate the required model tier based on issue labels.
- [x] Use agent rotation/selection to enforce tiering.
- [x] Log the selected model tier in autopilot comments.


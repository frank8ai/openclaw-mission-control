# Developer Operations SOP (Version A: Best Practice Direct)

## 1. Overview
Standardize the workflow for processing Linear issues using Codex sub-agents.

## 2. Prerequisites
- Workspace access to `/Users/yizhi/.openclaw/workspace/mission-control`
- `LINEAR_API_KEY` configured in environment.

## 3. Workflow Steps
1. **Intake**: Pull issue details from Linear using `mcp__linear-server__get_issue`.
2. **Analysis**: Check the current codebase for existing logic and constraints.
3. **Execution**: Implement changes. Strictly adhere to the issue description.
4. **Verification**: Run `npm run build` and `npm run lint` to ensure no regressions.
5. **Reporting**: Post a comment back to Linear with a summary of changes and paths modified. Update state to `In Review`.

## 4. Safety
- Do not run `rm -rf` or destructive commands without confirmation.
- Use `git status` before and after changes to track state.

## 5. Escalation
- If blocked by missing credentials, ask the user once and wait.
- If a step fails twice, stop and report the error.

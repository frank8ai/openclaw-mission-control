# Developer Operations SOP (Version B: Meta-SOP Compliant)

## 1. Metadata
- **Version**: 1.0
- **Author**: Autopilot
- **Last Updated**: 2026-02-23
- **Scope**: Task execution within `/Users/yizhi/.openclaw/workspace/mission-control`

## 2. Prerequisites
- Workspace root: `/Users/yizhi/.openclaw/workspace/mission-control`
- Node.js environment (v22+)
- `LINEAR_API_KEY` set in the gateway environment.

## 3. Trigger
Initiate when a Linear issue ID (e.g., `CLAW-123`) is assigned for execution.

## 4. Main Flow
1. **Intake**: Call `mcp__linear-server__get_issue` with the target ID.
   - *Success Exit*: Issue title and description are retrieved.
2. **Setup**: Execute `cd /Users/yizhi/.openclaw/workspace/mission-control`.
   - *Success Exit*: Current working directory matches repo root.
3. **Analysis**: Execute `grep -r "$KEYWORD" src/` to locate relevant logic.
   - *Success Exit*: List of target files identified.
4. **Implementation**: Modify files using the `edit` or `write` tool.
   - *Success Exit*: Target logic updated; files saved.
5. **Compilation**: Execute `npm run build`.
   - *Success Exit*: Process exits with code 0.
6. **Linting**: Execute `npm run lint`.
   - *Success Exit*: Process exits with code 0.
7. **Delivery**: Call `mcp__linear-server__create_comment` with a diff summary and evidence paths.
   - *Success Exit*: Comment ID received.

## 5. Branching Logic
- **IF** `npm run build` fails (exit code != 0):
  - **THEN** Execute `git restore .` and stop.
  - **ELSE** Proceed to Step 6.

## 6. Error Recovery
- **Lock Conflict**: IF `linear-autopilot.lock.json` exists:
  - **THEN** Wait 60 seconds and retry Step 1.
  - **ELSE** Stop and report process ID.

## 7. Artifacts
- Modified source files in `src/`.
- Summary report in `data/control-center/runs/`.

## 8. Verification
Execute `git diff --name-only` to confirm only expected files were changed.

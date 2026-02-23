# Autopilot Prompt Contract (CLAW-114)

## 1. Goal
Ensure that the autopilot prompt remains concise, relevant, and cost-effective by enforcing a strict structure and preventing context bloat.

## 2. Structure
The prompt MUST include the following sections in order:
1. **Instruction**: Role definition and task constraints (e.g., "Do exactly ONE concrete next step").
2. **Standard Operating Procedure (SOP)**: Link to the active dev SOP.
3. **Issue Metadata**: Identifier, Title, URL, State, Priority, Labels.
4. **Session Handoff Context** (If applicable): Source session, reason, metrics, and tail summaries of recent attempts.
5. **Core Context**: 
    - **OBJECTIVE**: Extracted from issue "Goal" or "Objective".
    - **CONTEXT**: Extracted from issue "Context" or "Background".
    - **CONSTRAINTS**: Extracted from issue "Acceptance Criteria" or "Constraints".
    - **RISKS**: Extracted from issue "Risks".
6. **Output Contract**: Definition of the expected JSON response.

## 3. Constraints
- **Total Prompt Length**: Targeted at `< 2000` characters.
- **Section Caps**:
    - Objective/Context/Constraints: Max 400 characters each.
    - Risks: Max 300 characters.
    - Tail Summaries: Last 3 attempts only.
- **No Raw Logs**: Full logs or large file contents must not be injected directly into the prompt description. Use summaries or specific snippets only.

## 4. Regression Prevention
- The `cmdLinearAutopilot` check triggers a trace warning if the built prompt exceeds the bloat threshold.
- Future enhancements: automatically retry building the prompt with stricter truncation if bloat is detected.

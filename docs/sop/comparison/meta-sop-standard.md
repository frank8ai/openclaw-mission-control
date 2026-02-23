# Meta-SOP: Standard for Generating Operational Procedures (Version B Baseline)

## 1. Objective
Provide a rigorous, repeatable framework for creating high-quality SOPs that minimize ambiguity and maximize success rates for autonomous agents.

## 2. Mandatory Structural Components
Every SOP generated via this Meta-SOP MUST include:
1. **Metadata**: Version, Author, Last Updated, Scope.
2. **Prerequisites**: Permissions, paths, or tool availability required.
3. **Trigger**: The specific event or state that initiates the procedure.
4. **Main Flow**: A sequence of atomic, numbered actions. Each action must have a clear "Success Exit" condition.
5. **Branching Logic**: Explicit "If-Then-Else" blocks for common variations.
6. **Error Recovery**: Specific instructions for known failure modes.
7. **Artifacts**: Expected files, logs, or state changes produced.
8. **Verification**: A concrete command or check to confirm total success.

## 3. Linguistic Constraints
- Use **Imperative Mood** (e.g., "Run command X" instead of "You should run...").
- No subjective qualifiers (e.g., avoid "Wait a bit", use "Wait 30 seconds").
- All file paths MUST be absolute or workspace-relative.

## 4. Validation Rules
Before finalization, the generator MUST verify:
- [ ] Are all external tool dependencies listed?
- [ ] Is every step actionable by an agent with the current capability set?
- [ ] Does the rollback/error step handle the most likely failure point?
- [ ] Is there a single, unambiguous way to verify the result?

## 5. Metadata for Scoring
- Record the character count (Token proxy).
- Count the number of nested "If" conditions (Ambiguity proxy).

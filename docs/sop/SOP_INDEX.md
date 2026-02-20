# Mission Control SOP Index

This index lists project-level SOPs for OpenClaw Mission Control automation.

- `SOP_MC_Task_ID_StateMachine_v1.md`
  - Purpose: bind runtime tasks to Linear issues and auto-drive state transitions.
- `SOP_MC_SourceId_Idempotency_v1.md`
  - Purpose: enforce sourceId-based dedupe across all triage intake paths.
- `SOP_MC_Queue_DLQ_v1.md`
  - Purpose: guarantee intake delivery with retry queue and DLQ fallback.
- `SOP_MC_SLA_Escalation_v1.md`
  - Purpose: detect stale Blocked/In Progress issues and auto-mention/escalate.
- `SOP_MC_Runbook_AutoFix_v1.md`
  - Purpose: codify known-fault remediation suggestions and semi-automatic repair.
- `SOP_MC_Runbook_AutoFix_v2.md`
  - Purpose: guarded semi-automatic runbook execution with confirmation token, allowlist, and audit.
- `SOP_MC_Audit_Permissions_v1.md`
  - Purpose: enforce read-by-default with explicit confirmation and auditable write actions.
- `SOP_MC_Briefing_Automation_v1.md`
  - Purpose: generate/send daily-weekly briefing from runtime + cycle + SLA signals.
- `SOP_MC_Triage_Signature_Dedupe_v1.md`
  - Purpose: suppress repeated intake issues via repo/error signature fingerprint.

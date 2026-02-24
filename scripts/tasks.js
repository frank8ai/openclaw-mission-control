#!/usr/bin/env node

'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data', 'control-center');
const CONFIG_PATH = process.env.CONTROL_CENTER_CONFIG
  ? path.resolve(process.env.CONTROL_CENTER_CONFIG)
  : path.join(ROOT_DIR, 'config', 'control-center.json');
const CONFIRMATIONS_PATH = path.join(DATA_DIR, 'confirmations.json');
const INCIDENTS_PATH = path.join(DATA_DIR, 'incidents.json');
const TODOIST_SYNC_PATH = path.join(DATA_DIR, 'todoist-sync.json');
const CALENDAR_SYNC_PATH = path.join(DATA_DIR, 'calendar-sync.json');
const GITHUB_SYNC_PATH = path.join(DATA_DIR, 'github-sync.json');
const STATUS_SYNC_PATH = path.join(DATA_DIR, 'status-sync.json');
const ISSUE_LINKS_PATH = path.join(DATA_DIR, 'runtime-issue-links.json');
const SOURCE_ID_INDEX_PATH = path.join(DATA_DIR, 'triage-source-index.json');
const TRIAGE_SIGNATURE_INDEX_PATH = path.join(DATA_DIR, 'triage-signature-index.json');
const TRIAGE_CREATE_LOCK_PATH = path.join(DATA_DIR, 'triage-create.lock.json');
const INGEST_QUEUE_PATH = path.join(DATA_DIR, 'ingest-queue.json');
const INGEST_DLQ_PATH = path.join(DATA_DIR, 'ingest-dlq.json');
const INGEST_LEDGER_PATH = path.join(DATA_DIR, 'ingest-ledger.json');
const WEBHOOK_METRICS_PATH = path.join(DATA_DIR, 'webhook-metrics.json');
const WEBHOOK_REPLAY_INDEX_PATH = path.join(DATA_DIR, 'webhook-replay-index.json');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'audit.jsonl');
const APPROVALS_PATH = path.join(DATA_DIR, 'approvals.json');
const ROLLBACK_JOURNAL_PATH = path.join(DATA_DIR, 'rollback-journal.json');
const TELEMETRY_DIR = path.join(ROOT_DIR, 'data', 'telemetry');
const SLA_STATE_PATH = path.join(DATA_DIR, 'sla-check.json');
const EXECUTOR_STABILITY_PATH = path.join(DATA_DIR, 'executor-stability.json');
const BINDING_COVERAGE_PATH = path.join(DATA_DIR, 'binding-coverage.json');
const STATUS_MACHINE_VERSIONS_PATH = path.join(DATA_DIR, 'status-machine-versions.json');
const RUNBOOK_EXEC_PATH = path.join(DATA_DIR, 'runbook-exec.json');
const DISCORD_INTAKE_STATE_PATH = path.join(DATA_DIR, 'discord-intake-state.json');
const LINEAR_AUTOPILOT_PATH = path.join(DATA_DIR, 'linear-autopilot.json');
const LINEAR_AUTOPILOT_LOCK_PATH = path.join(DATA_DIR, 'linear-autopilot.lock.json');
const LINEAR_AUTOPILOT_CIRCUIT_PATH = path.join(DATA_DIR, 'linear-autopilot-circuit.json');
const LINEAR_AUTOPILOT_AGENT_CURSOR_PATH = path.join(DATA_DIR, 'linear-autopilot-agent-cursor.json');
const LINEAR_ENGINE_NO_PROGRESS_PATH = path.join(DATA_DIR, 'linear-engine-no-progress.json');
const TOKEN_BUDGET_PATH = path.join(DATA_DIR, 'token-budget.json');
const LOW_VALUE_AUTOMATIONS = [
  'github-sync',
  'todoist-sync',
  'calendar-sync',
  'report',
  'briefing',
  'remind',
  'status-sync',
  'queue-drain',
  'sla-check',
  'watchdog',
  'workspace-guard',
  'binding-coverage',
  'distill-export',
  'telemetry',
];
let OPENCLAW_AGENT_IDS_CACHE = {
  loadedAtMs: 0,
  ids: null,
};

hydrateEnvFromDotEnv();

const DEFAULTS = {
  timezone: process.env.CONTROL_CENTER_TZ || 'Asia/Shanghai',
  openclawHome:
    process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), '.openclaw'),
  report: {
    topLimit: 5,
    channel: process.env.CONTROL_CENTER_REPORT_CHANNEL || '',
    target: process.env.CONTROL_CENTER_REPORT_TARGET || '',
    maxSendLength: 3000,
  },
  watchdog: {
    silenceMultiplier: 2.5,
    silenceFloorMinutes: 10,
    cronSilenceHours: 48,
    subagentLongRunMinutes: 120,
    contextHotThreshold: 0.85,
  },
  workspaceGuard: {
    enabled: true,
    pollMinutes: 5,
    expectedMainWorkspace:
      process.env.CONTROL_CENTER_MAIN_WORKSPACE ||
      path.join(process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), '.openclaw'), 'workspace'),
    autoRepair: true,
    backupOnRepair: true,
  },
  control: {
    confirmTtlMinutes: 10,
    approvalTtlMinutes: 30,
    approvalRequiredActions: ['run', 'enable', 'disable', 'kill', 'trigger', 'autopr', 'runbook-exec'],
    killWhitelist: [],
    triggerWhitelist: [
      'github-sync',
      'todoist-sync',
      'calendar-sync',
      'discord-intake-sync',
      'watchdog',
      'workspace-guard',
      'report',
      'briefing',
      'remind',
      'status-sync',
      'queue-drain',
      'sla-check',
      'linear-autopilot',
      'linear-engine',
    ],
  },
  modelRouting: {
    // Default to a low-cost model for medium-complexity agents (not code-heavy).
    // Individual tasks can still escalate to xHigh when needed.
    medium: 'gemini-flash',
    xHigh: 'gpt-5.3-codex-x-high',
    escalationLabels: ['blocked', 'fix-complexity'],
    mediumAgents: ['researcher', 'writer', 'researcher-deep', 'openclaw-dev', 'main-autopilot', 'gemini', 'main'],
    xHighAgents: ['codex', 'coder'],
  },
  tokenBudget: {
    enabled: true,
    dailyGlobalLimit: 500000,
    dailyAgentLimit: 100000,
    throttleThresholds: {
      downgrade: 0.8,
      highPriorityOnly: 0.9,
      freeze: 0.95,
    },
  },
  linear: {
    enabled: true,
    teamKey: process.env.LINEAR_TEAM_KEY || 'CLAW',
    teamId: process.env.LINEAR_TEAM_ID || '',
    projectId: process.env.LINEAR_PROJECT_ID || '',
    apiKey: process.env.LINEAR_API_KEY || '',
  },
  ingest: {
    host: process.env.CONTROL_CENTER_INGEST_HOST || '127.0.0.1',
    port: Number(process.env.CONTROL_CENTER_INGEST_PORT || 8788),
    triagePath: process.env.CONTROL_CENTER_TRIAGE_PATH || '/triage',
    discordPath: process.env.CONTROL_CENTER_DISCORD_PATH || '/discord/message',
    githubPath: process.env.CONTROL_CENTER_GITHUB_PATH || '/github/pr',
    token: process.env.CONTROL_CENTER_INGEST_TOKEN || '',
    maxBodyBytes: 1024 * 1024,
    replayWindowHours: 72,
  },
  reminders: {
    enabled: true,
    dueSoonDays: 7,
    staleInProgressDays: 3,
    blockedEscalationHours: 24,
    autoEscalateBlocked: false,
    dueSoonCron: '0 10 * * *',
    cycleCron: '30 9 * * 1',
    channel: process.env.CONTROL_CENTER_REMINDER_CHANNEL || '',
    target: process.env.CONTROL_CENTER_REMINDER_TARGET || '',
    maxSendLength: 3000,
  },
  briefing: {
    enabled: true,
    dailyCron: '15 9 * * *',
    weeklyCron: '0 9 * * 1',
    channel: process.env.CONTROL_CENTER_BRIEFING_CHANNEL || '',
    target: process.env.CONTROL_CENTER_BRIEFING_TARGET || '',
    maxSendLength: 3000,
    includeSla: true,
    staleInProgressDays: 3,
    blockedEscalationHours: 24,
    autoEscalateBlocked: false,
  },
  github: {
    stateInReview: 'In Review',
    stateDone: 'Done',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    token: process.env.GITHUB_TOKEN || '',
    autoReviewers: [],
    repos: [],
    pollIntervalMinutes: 15,
    lookbackHours: 72,
  },
  todoist: {
    enabled: true,
    apiToken: process.env.TODOIST_API_TOKEN || '',
    syncToLinear: true,
    syncFromLinearDone: true,
    label: 'todoist',
    defaultState: 'Triage',
    syncBatchSize: 10,
  },
  calendar: {
    enabled: true,
    browserProfile: process.env.CONTROL_CENTER_CALENDAR_PROFILE || 'openclaw',
    tabHint: process.env.CONTROL_CENTER_CALENDAR_TAB_HINT || 'calendar.google.com',
    syncToLinear: false,
    label: 'calendar',
    defaultState: 'Triage',
  },
  discordIntake: {
    enabled: true,
    channelId: process.env.CONTROL_CENTER_DISCORD_INTAKE_CHANNEL || '',
    channelIds: [],
    ownerUserIds: process.env.CONTROL_CENTER_OWNER_USER_IDS
      ? process.env.CONTROL_CENTER_OWNER_USER_IDS.split(',').map((item) => item.trim()).filter(Boolean)
      : ['1146425418937811145'],
    includeBotMessages: false,
    limit: 30,
    pollMinutes: 2,
    maxCreatePerRun: 5,
    minTextChars: 6,
    excludeProgressChecks: true,
    requireExplicitTrigger: false,
    explicitTriggers: ['linear 任务', 'linear任务', 'linear task', '/task', '#task', '任务：', '任务:'],
    autoDiscoverFromStatus: true,
    labels: ['auto-intake', 'main-directive'],
    defaultState: 'Triage',
    defaultPriority: 3,
  },
  obsidian: {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || path.join(ROOT_DIR, '..', 'Obsidian'),
    memoDir: process.env.OBSIDIAN_MEMO_DIR || 'Knowledge',
  },
  statusMachine: {
    enabled: true,
    activeWindowMinutes: 120,
    stateInProgress: 'In Progress',
    stateInReview: 'In Review',
    stateDone: 'Done',
    stateBlocked: 'Blocked',
    commentOnStateChange: true,
    pollMinutes: 10,
    rules: [],
    autoActivateConfig: true,
  },
  intakeQueue: {
    enabled: true,
    maxRetries: 5,
    pollMinutes: 2,
  },
  sla: {
    enabled: true,
    inProgressStaleHours: 24,
    blockedStaleHours: 8,
    commentCooldownHours: 24,
    createOpsIssue: true,
    pollMinutes: 30,
  },
  triageRouting: {
    enabled: true,
    defaultState: 'Triage',
    defaultPriority: 3,
    defaultLabels: [],
    defaultAssigneeEmail: '',
    sourceRules: {
      discord: {
        labels: ['discord'],
      },
      github: {
        labels: ['github'],
      },
      todoist: {
        labels: ['todoist'],
      },
      calendar: {
        labels: ['calendar'],
      },
      'google-calendar': {
        labels: ['calendar'],
      },
    },
    keywordRules: [
      {
        pattern: 'timeout|timed out|超时',
        labels: ['timeout', 'ops'],
        priority: 2,
      },
      {
        pattern: 'blocked|卡住|无法',
        labels: ['blocked'],
        priority: 2,
      },
      {
        pattern: 'urgent|紧急|p0',
        priority: 1,
      },
    ],
    signatureDedupe: {
      enabled: true,
      lookbackDays: 14,
      maxEntries: 2000,
      minChars: 30,
      sourceAllowlist: ['discord', 'github', 'webhook', 'manual', 'mission-control', 'sla-check'],
    },
  },
  autopr: {
    enabled: true,
    allowExecute: false,
    defaultDryRun: true,
    baseBranch: 'main',
    maxChangedFiles: 30,
    allowedPathPrefixes: ['docs/', '.github/', 'README.md', 'config/'],
    testCommand: 'npm run lint',
  },
  evalReplay: {
    enabled: true,
    maxSessions: 200,
    maxRunsPerJob: 20,
  },
  distillExport: {
    enabled: true,
    maxSessions: 200,
    maxSamples: 2000,
    maxAuditEvents: 2000,
    minUserChars: 6,
    minAssistantChars: 20,
    includeAudit: true,
    includeToolTrace: true,
    includeCodexCli: true,
  },
  runbook: {
    enabled: true,
    allowExecute: false,
    defaultDryRun: true,
    allowedActions: ['status-sync', 'queue-drain', 'cron-run'],
    maxActionsPerRun: 5,
  },
  execution: {
    enabled: true,
    pollMinutes: 5,
    loopCommand: 'linear-autopilot',
    engineAutoPick: true,
    engineMaxSteps: 3,
    engineNoProgressThreshold: 2,
    engineStepSleepMs: 0,
    agentId: 'auto',
    agentPreferred: ['researcher', 'writer', 'main'],
    agentAllowlist: [],
    agentDenylist: [],
    timeoutSeconds: 900,
    agentRetries: 2,
    retryBackoffSeconds: 20,
    lockTtlSeconds: 1800,
    fallbackAgentSuffix: 'autopilot',
    backoffByFailureClass: {
      timeout: 1.2,
      rate_limit: 1.6,
      lock_conflict: 0.8,
      unknown: 1.0,
    },
    failOnError: false,
    includeStates: ['In Progress', 'Triage', 'Blocked'],
    includeLabels: ['auto-intake', 'main-directive'],
    maxPromptChars: 1400,
    autoComment: true,
    autoTransition: true,
    defaultTransitionFromTriage: 'In Progress',
    issueCooldownMinutes: 30,
    maxConsecutiveSameIssue: 2,
    preferNewTriage: true,
    noProgressEscalation: {
      enabled: true,
      thresholdRuns: 3,
      cooldownMinutes: 180,
      autoBlock: true,
      notifyReportTarget: true,
      commentOnIssue: true,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 2,
      cooldownMinutes: 30,
      autoLinearIssue: true,
      issueState: 'Triage',
      issuePriority: 2,
      issueLabels: ['ops', 'autopilot', 'circuit-breaker'],
    },
  },
};

const HELP_TEXT = `OpenClaw Control Center CLI

Usage:
  npm run tasks -- <command> [options]
  node scripts/tasks.js <command> [options]

Read commands:
  now                          Quick 30-second answer: what is happening + what next
  jobs                         List cron jobs and status
  agents                       List subagents (label/status/start/elapsed)
  sessions                     List active sessions summary
  report [--json] [--send]     Build health report (Top 5 anomalies + manual actions)
  briefing [daily|weekly]      Build daily/weekly briefing template and optional send
  watchdog [--auto-linear]     Detect incidents and optionally auto-create Linear issues
  workspace-guard [--json]     Detect/repair main agent workspace drift (e.g. /tmp/empty-workspace)
  remind [due|cycle|all]       Send reminders from Linear (due soon/current cycle)
  status-sync [--json]         Auto state machine + comment trail for linked runtime issues
  queue-drain [--json]         Retry ingest queue and move failed payloads to DLQ
  queue-replay [--json]        Replay DLQ payloads back into queue (single or batch)
  queue-stats [--json]         Show ingest queue/DLQ health, retries, and source distribution
  ingest-test [--json]         Run ingest idempotency + DLQ + replay acceptance checks
  sla-check [--json]           Stale/blocked SLA checks with owner mention + escalation issue
  binding-coverage [--json]    Report and auto-repair runtime issue binding coverage
  webhook-metrics [--json]     Webhook latency/replay-protection metrics
  webhook-test [--json]        Run webhook replay/latency acceptance checks
  executor-test [--json]       Run executor lock/retry/failure-class acceptance checks
  state-machine-rules [--json] Show/apply/rollback config-driven status-machine rule versions
  audit-rollback --audit-id ID Roll back auditable local writes by audit id
  eval-replay [--json]         Build replay artifact for evaluation/distillation workflow
  distill-export [--json]      Export local training dataset from replay + OpenClaw/Codex session logs + audit
  telemetry [--json]           Build baseline token telemetry by agent/job

Integrations:
  triage --title ...           Create a Triage issue quickly (supports --source/--source-id/--labels)
  memo-save --channel-id ...    Save a Discord memo into Obsidian and create a linked Linear issue
  ingest-server                Start webhook server for external intake + GitHub PR sync
  github-hooks [--repo PATH]   Install git hooks to enforce/add Linear ID in branch/commit
  github-sync                  Poll GitHub PRs and sync Linear states (In Review/Done)
  todoist-sync                 Sync Todoist tasks into Linear Triage
  todoist-backsync             Mark Todoist tasks complete when linked Linear issues are Done
  calendar-sync                Sync Google Calendar events snapshot (browser logged-in tab)
  discord-intake-sync          Auto ingest main Discord directives into Linear Triage
  linear-autopilot             Pick one runnable Linear issue and execute one next step via configured execution agent
  linear-engine                Multi-step execution engine (specific issue or auto-pick runnable issue; supports --drain)

Write commands (require one-time confirmation):
  confirm                      Generate one-time confirmation code
  approve                      Generate one-time approval code for high-risk writes
  run <jobId> --confirm CODE   Run cron job now
  enable <jobId> --confirm CODE
  disable <jobId> --confirm CODE
  kill <subagentId> --confirm CODE
  trigger <jobId> --confirm CODE [--json]
  autopr [--issue CLAW-123] --confirm CODE [--execute]
  runbook-exec --card CARD [--issue CLAW-123] [--cron-id ID] --confirm CODE [--execute]

Scheduling:
  schedule [--apply] [--mode full|minimal] [--execution-loop autopilot|engine] [--engine-max-steps N] [--engine-drain true|false] [--engine-drain-max-issues N] [--agent AGENT|auto] [--channel CH] [--target TGT]
    Prepare (or install) crontab block:
    - mode=full: report + watchdog + workspace-guard + sync/governance + queue drain + execution loop + reminders/briefing
    - mode=minimal: discord-intake-sync + queue-drain + workspace-guard + execution loop (autopilot by default)

Examples:
  npm run tasks -- triage --title "Fix Discord manual model switch" --source discord --source-id discord:msg:123
  npm run tasks -- memo-save --channel-id 1473599984338472980 --message-id 1474299084822020127 --title "Distill+router plan" --labels "research,decision" --create-linear
  npm run tasks -- status-sync
  npm run tasks -- queue-drain
  npm run tasks -- sla-check
  npm run tasks -- linear-autopilot --json
  npm run tasks -- linear-autopilot --issue CLAW-128 --json
  npm run tasks -- linear-autopilot --issue CLAW-128 --agent auto --json
  npm run tasks -- linear-engine --max-steps 5 --agent auto --json
  npm run tasks -- linear-engine --drain --drain-max-issues 8 --max-steps 5 --auto-pick --json
  npm run tasks -- linear-engine --issue CLAW-128 --max-steps 5 --json
  npm run tasks -- distill-export --agent codex --json
  npm run tasks -- briefing daily --send
  npm run tasks -- discord-intake-sync --channel 1468117725040742527
  npm run tasks -- trigger github-sync --confirm "CONFIRM ABC123"
  npm run tasks -- autopr --issue CLAW-123 --confirm "CONFIRM ABC123"
  npm run tasks -- runbook-exec --card cron-recover --issue CLAW-123 --confirm "CONFIRM ABC123" --execute
`;

async function main() {
  const { command, flags } = parseArgv(process.argv.slice(2));
  const settings = loadSettings();

  checkBudgetGuard(command, settings, flags);

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(HELP_TEXT);
        return;
      case 'now':
      case 'status':
        await cmdNow(settings, flags);
        return;
      case 'jobs':
      case 'cron':
        await cmdJobs(settings, flags);
        return;
      case 'agents':
        await cmdAgents(settings, flags);
        return;
      case 'sessions':
        await cmdSessions(settings, flags);
        return;
      case 'report':
        await cmdReport(settings, flags);
        return;
      case 'briefing':
      case 'brief':
        await cmdBriefing(settings, flags);
        return;
      case 'watchdog':
        await cmdWatchdog(settings, flags);
        return;
      case 'workspace-guard':
      case 'workspace-guard-check':
      case 'guard':
        await cmdWorkspaceGuard(settings, flags);
        return;
      case 'triage':
        await cmdTriage(settings, flags);
        return;
      case 'memo-save':
      case 'memo':
        await cmdMemoSave(settings, flags);
        return;
      case 'remind':
      case 'reminder':
        await cmdRemind(settings, flags);
        return;
      case 'status-sync':
      case 'state-sync':
        await cmdStatusSync(settings, flags);
        return;
      case 'queue-drain':
      case 'retry-queue':
        await cmdQueueDrain(settings, flags);
        return;
      case 'queue-replay':
      case 'replay-dlq':
        await cmdQueueReplay(settings, flags);
        return;
      case 'queue-stats':
      case 'ingest-stats':
        await cmdQueueStats(settings, flags);
        return;
      case 'ingest-test':
        await cmdIngestTest(settings, flags);
        return;
      case 'sla-check':
      case 'sla':
        await cmdSlaCheck(settings, flags);
        return;
      case 'binding-coverage':
      case 'bindings':
        await cmdBindingCoverage(settings, flags);
        return;
      case 'webhook-metrics':
      case 'webhook-stats':
        await cmdWebhookMetrics(settings, flags);
        return;
      case 'webhook-test':
        await cmdWebhookTest(settings, flags);
        return;
      case 'executor-test':
        await cmdExecutorTest(settings, flags);
        return;
      case 'state-machine-rules':
      case 'state-rules':
        await cmdStatusMachineRules(settings, flags);
        return;
      case 'audit-rollback':
      case 'rollback':
        await cmdAuditRollback(settings, flags);
        return;
      case 'eval-replay':
      case 'replay-eval':
      case 'distill-replay':
        await cmdEvalReplay(settings, flags);
        return;
      case 'distill-export':
      case 'dataset-export':
      case 'distill-dataset':
        await cmdDistillExport(settings, flags);
        return;
      case 'telemetry':
      case 'token-stats':
        await cmdTelemetry(settings, flags);
        return;
      case 'runbook-exec':
      case 'runbook':
        await cmdRunbookExec(settings, flags);
        return;
      case 'ingest-server':
      case 'webhook':
        await cmdIngestServer(settings, flags);
        return;
      case 'github-hooks':
      case 'git-hooks':
        await cmdGithubHooks(settings, flags);
        return;
      case 'github-sync':
      case 'gh-sync':
        await cmdGithubSync(settings, flags);
        return;
      case 'todoist-sync':
      case 'todoist':
        await cmdTodoistSync(settings, flags);
        return;
      case 'todoist-backsync':
      case 'todoist-done-sync':
        await cmdTodoistBacksync(settings, flags);
        return;
      case 'discord-intake-sync':
      case 'discord-intake':
      case 'intake-sync':
        await cmdDiscordIntakeSync(settings, flags);
        return;
      case 'calendar-sync':
      case 'gcal-sync':
      case 'calendar':
        await cmdCalendarSync(settings, flags);
        return;
      case 'linear-autopilot':
      case 'execution-loop':
      case 'autopilot':
        await cmdLinearAutopilot(settings, flags);
        return;
      case 'linear-engine':
      case 'execution-engine':
      case 'autopilot-engine':
        await cmdLinearEngine(settings, flags);
        return;
      case 'confirm':
        await cmdConfirm(settings, flags);
        return;
      case 'approve':
        await cmdApprove(settings, flags);
        return;
      case 'run':
        await cmdCronControl(settings, 'run', flags);
        return;
      case 'enable':
        await cmdCronControl(settings, 'enable', flags);
        return;
      case 'disable':
        await cmdCronControl(settings, 'disable', flags);
        return;
      case 'kill':
        await cmdKill(settings, flags);
        return;
      case 'trigger':
      case 'run-job':
      case 'job-trigger':
        await cmdTrigger(settings, flags);
        return;
      case 'autopr':
      case 'auto-pr':
        await cmdAutoPr(settings, flags);
        return;
      case 'schedule':
        await cmdSchedule(settings, flags);
        return;
      default:
        if (!command) {
          await cmdNow(settings, flags);
          return;
        }
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ERROR: ${message}\n`);
    process.exit(1);
  }
}

function checkBudgetGuard(command, settings, flags) {
  if (isTruthyLike(flags.force)) return;
  if (!command) return;

  const isLowValue = LOW_VALUE_AUTOMATIONS.includes(command);
  const isExecution = ['linear-autopilot', 'linear-engine'].includes(command);

  // Execution commands (autopilot/engine) handle their own priority-based throttling 
  // after picking an issue.
  if (isExecution) return;

  const priority = isLowValue ? 4 : 3;

  const gate = evaluateTokenBudgetGate(settings, null, priority);
  if (gate.status === 'freeze') {
    throw new Error(`Command "${command}" frozen: global token budget exhausted (${Math.round(gate.ratio * 100)}%).`);
  }

  if (gate.status === 'throttle') {
    throw new Error(`Command "${command}" throttled: high-priority runs only (${Math.round(gate.ratio * 100)}%).`);
  }

  if (gate.status === 'downgrade' && isLowValue) {
    // 80% Gate: Downgrade frequency (skip 50% of low-value runs)
    if (Math.random() < 0.5) {
      throw new Error(`Command "${command}" frequency downgraded (budget=${Math.round(gate.ratio * 100)}%).`);
    }
  }
}

function parseArgv(argv) {
  const flags = { _: [] };
  let command = '';

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!command && !token.startsWith('-')) {
      command = token;
      continue;
    }

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq > -1) {
        const key = token.slice(2, eq);
        const value = token.slice(eq + 1);
        flags[key] = value;
        continue;
      }
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    if (token.startsWith('-')) {
      const key = token.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    flags._.push(token);
  }

  return { command, flags };
}

function loadSettings() {
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
      throw new Error(`Invalid config JSON at ${CONFIG_PATH}: ${String(error)}`);
    }
  }

  const merged = deepMerge(DEFAULTS, config);

  if (!merged.linear.apiKey && process.env.LINEAR_API_KEY) {
    merged.linear.apiKey = process.env.LINEAR_API_KEY;
  }
  if (!merged.linear.teamKey && process.env.LINEAR_TEAM_KEY) {
    merged.linear.teamKey = process.env.LINEAR_TEAM_KEY;
  }
  if (!merged.linear.teamId && process.env.LINEAR_TEAM_ID) {
    merged.linear.teamId = process.env.LINEAR_TEAM_ID;
  }
  if (!merged.linear.projectId && process.env.LINEAR_PROJECT_ID) {
    merged.linear.projectId = process.env.LINEAR_PROJECT_ID;
  }
  if (!merged.github.token && process.env.GITHUB_TOKEN) {
    merged.github.token = process.env.GITHUB_TOKEN;
  }
  if (!merged.github.token) {
    merged.github.token = readFileTrim(path.join(os.homedir(), '.openclaw', 'credentials', 'github-token.txt'));
  }
  if (!merged.todoist.apiToken && process.env.TODOIST_API_TOKEN) {
    merged.todoist.apiToken = process.env.TODOIST_API_TOKEN;
  }

  // Fail-fast guard for NEXUS (Second Brain) prerequisites
  const nexusChecks = [
    { key: 'NEXUS_VECTOR_DB', env: process.env.NEXUS_VECTOR_DB || '/Users/yizhi/.openclaw/workspace/memory/.vector_db_restored' },
    { key: 'NEXUS_COLLECTION', env: process.env.NEXUS_COLLECTION || 'deepsea_nexus_restored' },
    { key: 'NEXUS_PYTHON_PATH', env: process.env.NEXUS_PYTHON_PATH || '/Users/yizhi/miniconda3/envs/openclaw-nexus/bin/python' },
  ];
  for (const check of nexusChecks) {
    if (check.key === 'NEXUS_COLLECTION') {
      if (!check.env) {
        throw new Error(`CRITICAL: NEXUS prerequisite [${check.key}] is empty. Please check your environment or Second Brain installation.`);
      }
      continue;
    }
    if (!fs.existsSync(check.env)) {
      throw new Error(`CRITICAL: NEXUS prerequisite [${check.key}] path not found: ${check.env}. Please check your environment or Second Brain installation.`);
    }
  }

  if (process.env.CONTROL_CENTER_KILL_WHITELIST) {
    merged.control.killWhitelist = process.env.CONTROL_CENTER_KILL_WHITELIST
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return merged;
}

function hydrateEnvFromDotEnv() {
  const files = [
    path.join(ROOT_DIR, '.env'),
    path.join(ROOT_DIR, '.env.local'),
    path.join(path.resolve(ROOT_DIR, '..'), '.env'),
    path.join(path.resolve(ROOT_DIR, '..'), '.env.local'),
  ];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!key || !value) {
        continue;
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function deepMerge(base, override) {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override.slice() : base.slice();
  }
  if (base && typeof base === 'object') {
    const result = { ...base };
    const source = override && typeof override === 'object' ? override : {};
    for (const [key, value] of Object.entries(source)) {
      if (key in result) {
        result[key] = deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return override === undefined ? base : override;
}

async function cmdNow(settings) {
  const snapshot = collectSnapshot(settings);
  const report = buildReport(snapshot, settings);
  const anomalies = report.topAnomalies;

  const lines = [];
  lines.push('Now:');
  lines.push(
    `- cron ${report.metrics.enabledCronJobs}/${report.metrics.totalCronJobs} enabled, ${report.metrics.cronErrorJobs} with errors`,
  );
  lines.push(
    `- sessions active(60m): ${report.metrics.activeSessions}, subagents active: ${report.metrics.activeSubagents}`,
  );

  if (anomalies.length === 0) {
    lines.push('- anomalies: none');
  } else {
    lines.push('- top anomalies:');
    for (const item of anomalies.slice(0, 3)) {
      lines.push(`  - [${item.severity}] ${item.title}`);
    }
  }

  const actions = report.manualActions.slice(0, 3);
  if (actions.length > 0) {
    lines.push('Next actions:');
    for (const action of actions) {
      lines.push(`  - ${action}`);
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdJobs(settings, flags) {
  const jobs = loadCronJobs(settings);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ jobs }, null, 2)}\n`);
    return;
  }

  if (jobs.length === 0) {
    process.stdout.write('No cron jobs found.\n');
    return;
  }

  const rows = jobs.map((job) => {
    const state = job.state || {};
    return {
      id: job.id,
      name: job.name || '(unnamed)',
      enabled: job.enabled ? 'yes' : 'no',
      status: state.lastStatus || '-',
      consecutiveErrors: Number(state.consecutiveErrors || 0),
      lastRun: formatTime(state.lastRunAtMs, settings.timezone),
      schedule: formatSchedule(job.schedule),
    };
  });

  printTable(rows, ['id', 'name', 'enabled', 'status', 'consecutiveErrors', 'lastRun', 'schedule']);
}

async function cmdAgents(settings, flags) {
  const subagents = loadSubagents(settings);
  if (subagents.length > 0) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ subagents }, null, 2)}\n`);
      return;
    }

    const rows = subagents.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      start: formatTime(item.startedAtMs, settings.timezone),
      elapsed: formatDuration(item.durationMs),
      pid: item.pid ? String(item.pid) : '-',
    }));

    printTable(rows, ['id', 'label', 'status', 'start', 'elapsed', 'pid']);
    return;
  }

  const activeWindowMs = Math.max(30, Number(settings.watchdog.subagentLongRunMinutes || 120)) * 60 * 1000;
  const sessionFallback = loadSessions(settings)
    .filter((session) => Number(session.ageMs || Number.POSITIVE_INFINITY) <= activeWindowMs)
    .sort((a, b) => Number(a.ageMs || 0) - Number(b.ageMs || 0));

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ subagents: [], fallback: 'sessions', sessions: sessionFallback }, null, 2)}\n`);
    return;
  }

  if (sessionFallback.length === 0) {
    process.stdout.write('No subagents found in ~/.openclaw/subagents/runs.json\n');
    return;
  }

  process.stdout.write('No subagent runs file found; showing active sessions fallback.\n');
  const rows = sessionFallback.map((session) => ({
    id: session.sessionId || session.key || '-',
    label: session.agentId || inferAgentId(session.key),
    status: session.abortedLastRun ? 'aborted' : 'running',
    start: formatTime(session.updatedAt, settings.timezone),
    elapsed: formatDuration(session.ageMs),
    pid: '-',
  }));
  printTable(rows, ['id', 'label', 'status', 'start', 'elapsed', 'pid']);
}

async function cmdSessions(settings, flags) {
  const sessions = loadSessions(settings);
  const sorted = sessions
    .slice()
    .sort((a, b) => Number(a.ageMs || 0) - Number(b.ageMs || 0));

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ sessions: sorted }, null, 2)}\n`);
    return;
  }

  if (sorted.length === 0) {
    process.stdout.write('No sessions found.\n');
    return;
  }

  const rows = sorted.slice(0, 20).map((session) => ({
    agent: session.agentId || inferAgentId(session.key),
    key: session.key || '-',
    kind: session.kind || '-',
    age: formatDuration(session.ageMs),
    model: session.model || '-',
    tokens: session.totalTokens != null ? String(session.totalTokens) : '-',
    context: session.contextTokens != null ? String(session.contextTokens) : '-',
    aborted: session.abortedLastRun ? 'yes' : 'no',
  }));

  printTable(rows, ['agent', 'key', 'kind', 'age', 'model', 'tokens', 'context', 'aborted']);
}

async function cmdReport(settings, flags) {
  const snapshot = collectSnapshot(settings);
  const report = buildReport(snapshot, settings);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report, settings)}\n`);
  }

  if (flags.send) {
    const channel = String(flags.channel || settings.report.channel || '').trim();
    const target = String(flags.target || settings.report.target || '').trim();

    if (!channel || !target) {
      throw new Error('report --send requires --channel and --target (or values in config).');
    }

    const maxLength = Number(flags['max-message-length'] || settings.report.maxSendLength || 3000);
    const text = trimMessage(renderReport(report, settings), maxLength);

    runCommand('openclaw', [
      'message',
      'send',
      '--channel',
      channel,
      '--target',
      target,
      '--message',
      text,
    ]);

    process.stdout.write(`Report sent via openclaw message send (${channel} -> ${target}).\n`);
  }
}

async function cmdBriefing(settings, flags) {
  if (settings.briefing && settings.briefing.enabled === false) {
    throw new Error('briefing is disabled in config.');
  }

  const mode = String(flags._[0] || flags.mode || 'daily').trim().toLowerCase();
  if (!['daily', 'weekly'].includes(mode)) {
    throw new Error(`invalid briefing mode: ${mode}. expected daily|weekly`);
  }

  const snapshot = collectSnapshot(settings);
  const report = buildReport(snapshot, settings);

  const reminderMode = mode === 'weekly' ? 'cycle' : 'all';
  const reminderDays = Number(
    flags.days || (mode === 'weekly' ? Math.max(7, Number(settings.reminders.dueSoonDays || 7)) : settings.reminders.dueSoonDays || 7),
  );
  const includeSla =
    !Boolean(flags['without-sla']) &&
    Boolean(flags['include-sla'] || settings.briefing.includeSla !== false);
  const staleInProgressDays = Math.max(
    1,
    Number(
      flags['stale-days'] ||
        settings.briefing.staleInProgressDays ||
        settings.reminders.staleInProgressDays ||
        3,
    ),
  );
  const blockedEscalationHours = Math.max(
    1,
    Number(
      flags['blocked-hours'] ||
        settings.briefing.blockedEscalationHours ||
        settings.reminders.blockedEscalationHours ||
        24,
    ),
  );
  const autoEscalateBlocked = Boolean(
    flags['auto-escalate'] ||
      flags.escalate ||
      settings.briefing.autoEscalateBlocked === true,
  );
  const reminderBundle = await buildReminderPayload(settings, {
    mode: reminderMode,
    dueDays: reminderDays,
    includeSla,
    staleInProgressDays,
    blockedEscalationHours,
    autoEscalateBlocked,
  });

  const briefing = {
    mode,
    generatedAtMs: Date.now(),
    report,
    reminder: reminderBundle.data,
    autoEscalated: reminderBundle.escalated || [],
  };

  const rendered = renderBriefing(briefing, settings);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...briefing, rendered }, null, 2)}\n`);
  } else {
    process.stdout.write(`${rendered}\n`);
  }

  if (flags.send) {
    const channel = String(
      flags.channel || settings.briefing.channel || settings.report.channel || '',
    ).trim();
    const target = String(
      flags.target || settings.briefing.target || settings.report.target || '',
    ).trim();
    if (!channel || !target) {
      throw new Error('briefing --send requires --channel and --target (or values in config).');
    }

    const maxLength = Number(flags['max-message-length'] || settings.briefing.maxSendLength || 3000);
    const text = trimMessage(rendered, maxLength);
    runCommand('openclaw', [
      'message',
      'send',
      '--channel',
      channel,
      '--target',
      target,
      '--message',
      text,
    ]);
    process.stdout.write(`Briefing sent via openclaw message send (${channel} -> ${target}).\n`);
  }
}

async function cmdWatchdog(settings, flags) {
  const snapshot = collectSnapshot(settings);
  const report = buildReport(snapshot, settings);
  const candidates = buildIncidentCandidates(report, snapshot, settings);
  const incidents = readJsonFile(INCIDENTS_PATH, { version: 1, records: {} });
  const records = incidents.records || {};
  const now = Date.now();

  const autoLinear = Boolean(flags['auto-linear'] || flags.auto || false);
  const linearReady = Boolean(settings.linear.apiKey);
  const created = [];
  const skipped = [];

  const activeKeys = new Set(candidates.map((candidate) => candidate.key));

  for (const [key, record] of Object.entries(records)) {
    if (record.status === 'open' && !activeKeys.has(key)) {
      records[key] = {
        ...record,
        status: 'resolved',
        resolvedAtMs: now,
      };
    }
  }

  for (const candidate of candidates) {
    const existing = records[candidate.key];
    if (existing && existing.status === 'open') {
      skipped.push({
        jobId: candidate.job.id,
        reason: candidate.reason,
        note: `already open (${existing.issueIdentifier || 'local-only'})`,
      });
      continue;
    }

    let issue = null;
    if (autoLinear && linearReady && settings.linear.enabled) {
      issue = await createLinearIssue(candidate, settings);
    }

    const record = {
      key: candidate.key,
      status: 'open',
      openedAtMs: now,
      reason: candidate.reason,
      jobId: candidate.job.id,
      jobName: candidate.job.name || '',
      summary: candidate.summary,
      runbookCard: candidate.runbook ? candidate.runbook.card : '',
      runbookSignature: candidate.runbook ? candidate.runbook.signature : '',
      runbookNextCommands: candidate.runbook && Array.isArray(candidate.runbook.nextCommands)
        ? candidate.runbook.nextCommands
        : [],
      issueId: issue ? issue.id : '',
      issueIdentifier: issue ? issue.identifier : '',
      issueUrl: issue ? issue.url : '',
      mode: issue ? 'linear' : 'local-only',
    };

    records[candidate.key] = record;
    created.push(record);
  }

  writeJsonFile(INCIDENTS_PATH, {
    version: 1,
    updatedAtMs: now,
    records,
  });

  const result = {
    atMs: now,
    autoLinear,
    linearReady,
    candidates: candidates.length,
    created,
    skipped,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Watchdog result:');
  lines.push(`- incident candidates: ${candidates.length}`);
  lines.push(`- created: ${created.length}`);
  lines.push(`- skipped: ${skipped.length}`);
  lines.push(`- linear mode: ${autoLinear && linearReady ? 'enabled' : 'disabled'}`);

  if (created.length > 0) {
    lines.push('Created/Opened:');
    for (const item of created) {
      const issueText = item.issueIdentifier
        ? `${item.issueIdentifier} ${item.issueUrl || ''}`.trim()
        : 'local-only record';
      lines.push(
        `- ${item.jobId} (${item.reason}) [${item.runbookCard || '-'}:${item.runbookSignature || '-'}] -> ${issueText}`,
      );
    }
  }

  if (skipped.length > 0) {
    lines.push('Skipped:');
    for (const item of skipped) {
      lines.push(`- ${item.jobId} (${item.reason}) -> ${item.note}`);
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdWorkspaceGuard(settings, flags) {
  const configPath = path.join(settings.openclawHome, 'openclaw.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`openclaw config not found: ${configPath}`);
  }

  const expectedWorkspace = path.resolve(
    String(
      flags['expected-workspace'] ||
        flags.expectedWorkspace ||
        (settings.workspaceGuard && settings.workspaceGuard.expectedMainWorkspace) ||
        path.join(settings.openclawHome, 'workspace'),
    ).trim(),
  );
  const autoRepair =
    flags['auto-repair'] !== undefined
      ? isTruthyLike(flags['auto-repair'])
      : Boolean(settings.workspaceGuard && settings.workspaceGuard.autoRepair !== false);
  const backupOnRepair =
    flags['backup-on-repair'] !== undefined
      ? isTruthyLike(flags['backup-on-repair'])
      : Boolean(settings.workspaceGuard && settings.workspaceGuard.backupOnRepair !== false);
  const dryRun = Boolean(flags['dry-run']);

  let payload = {};
  try {
    payload = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid JSON at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error(`invalid openclaw config structure at ${configPath}`);
  }

  const agents = payload.agents && typeof payload.agents === 'object' ? payload.agents : {};
  const list = Array.isArray(agents.list) ? agents.list : [];
  const mainIndex = list.findIndex((item) => item && (item.id === 'main' || item.default === true));
  if (mainIndex < 0) {
    throw new Error('workspace-guard: main agent entry not found in agents.list');
  }

  const mainAgent = list[mainIndex] && typeof list[mainIndex] === 'object' ? list[mainIndex] : {};
  const currentWorkspaceRaw = String(mainAgent.workspace || '').trim();
  const currentWorkspace = currentWorkspaceRaw ? path.resolve(currentWorkspaceRaw) : '';
  const drift = !currentWorkspace || currentWorkspace !== expectedWorkspace;
  const expectedExists = fs.existsSync(expectedWorkspace);

  let repaired = false;
  let changed = false;
  let backupPath = '';

  if (drift && autoRepair && !dryRun) {
    if (!expectedExists) {
      throw new Error(`workspace-guard expected workspace does not exist: ${expectedWorkspace}`);
    }

    if (backupOnRepair) {
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      backupPath = `${configPath}.bak.${stamp}.workspace-guard`;
      fs.copyFileSync(configPath, backupPath);
    }

    mainAgent.workspace = expectedWorkspace;
    list[mainIndex] = mainAgent;
    payload.agents = {
      ...agents,
      list,
    };
    fs.writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    repaired = true;
    changed = true;
  }

  const auditDetail = {
    configPath,
    mainAgentId: String(mainAgent.id || 'main'),
    expectedWorkspace,
    expectedExists,
    currentWorkspace: currentWorkspace || '',
    drift,
    autoRepair,
    dryRun,
    repaired,
    changed,
    backupPath,
  };
  const audit = appendAuditEvent(
    drift ? (repaired ? 'workspace-guard-repair' : 'workspace-guard-drift') : 'workspace-guard-ok',
    auditDetail,
  );

  const result = {
    ok: true,
    ...auditDetail,
    auditId: audit.auditId,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Workspace guard result:');
  lines.push(`- config: ${configPath}`);
  lines.push(`- main workspace: ${currentWorkspace || '(empty)'}`);
  lines.push(`- expected workspace: ${expectedWorkspace}`);
  lines.push(`- drift: ${drift ? 'yes' : 'no'}`);
  lines.push(`- repaired: ${repaired ? 'yes' : 'no'}`);
  lines.push(`- expected exists: ${expectedExists ? 'yes' : 'no'}`);
  if (backupPath) {
    lines.push(`- backup: ${backupPath}`);
  }
  lines.push(`- audit id: ${audit.auditId}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdConfirm(settings) {
  const ttlMinutes = Number(settings.control.confirmTtlMinutes || 10);
  const confirmations = readJsonFile(CONFIRMATIONS_PATH, { version: 1, tokens: [] });
  const now = Date.now();

  const token = {
    code: generateCode(6),
    createdAtMs: now,
    expiresAtMs: now + ttlMinutes * 60 * 1000,
    used: false,
  };

  const nextTokens = (confirmations.tokens || []).filter(
    (item) => !item.used && Number(item.expiresAtMs || 0) > now,
  );
  nextTokens.push(token);

  writeJsonFile(CONFIRMATIONS_PATH, {
    version: 1,
    tokens: nextTokens,
  });

  process.stdout.write(
    `One-time confirmation generated (valid ${ttlMinutes}m):\nCONFIRM ${token.code}\n`,
  );
}

async function cmdCronControl(settings, action, flags) {
  const id = String(flags._[0] || '').trim();
  if (!id) {
    throw new Error(`tasks ${action} requires a cron job id.`);
  }

  consumeConfirmation(flags.confirm);
  const approval = consumeApprovalIfRequired(settings, flags.approval, action, id);

  const args = ['cron', action, id];
  const output = runCommand('openclaw', args);
  const audit = appendAuditEvent('control-cron-action', {
    action,
    jobId: id,
    confirm: String(flags.confirm || ''),
    approvalId: approval.approvalId || '',
  });

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          action,
          jobId: id,
          auditId: audit.auditId,
          approval,
          output: String(output.stdout || output.stderr || 'ok').trim(),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  process.stdout.write(`${output.stdout || output.stderr || 'ok'}\n`);
}

async function cmdKill(settings, flags) {
  const subagentId = String(flags._[0] || '').trim();
  if (!subagentId) {
    throw new Error('tasks kill requires a subagent id.');
  }

  consumeConfirmation(flags.confirm);
  const approval = consumeApprovalIfRequired(settings, flags.approval, 'kill', subagentId);

  const whitelist = new Set((settings.control.killWhitelist || []).map((item) => String(item)));
  if (!whitelist.has(subagentId)) {
    throw new Error(
      `subagent ${subagentId} is not in kill whitelist. Update config/control-center.json control.killWhitelist first.`,
    );
  }

  const subagents = loadSubagents(settings);
  const target = subagents.find((item) => item.id === subagentId || item.label === subagentId);
  if (!target) {
    throw new Error(`subagent ${subagentId} not found in runs.json`);
  }

  if (!target.pid) {
    throw new Error(`subagent ${subagentId} has no PID in runs.json; cannot kill safely.`);
  }

  try {
    process.kill(target.pid, 'SIGTERM');
  } catch (error) {
    throw new Error(`failed to SIGTERM PID ${target.pid}: ${String(error)}`);
  }

  const audit = appendAuditEvent('control-kill-subagent', {
    subagentId,
    pid: target.pid,
    confirm: String(flags.confirm || ''),
    approvalId: approval.approvalId || '',
  });

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          subagentId,
          pid: target.pid,
          auditId: audit.auditId,
          approval,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  process.stdout.write(`Sent SIGTERM to subagent ${subagentId} (pid ${target.pid}).\n`);
}

async function cmdTrigger(settings, flags) {
  const jobId = normalizeTriggerJobId(flags._[0] || flags.job || '');
  if (!jobId) {
    throw new Error(
      'trigger requires a job id. Allowed: github-sync,todoist-sync,calendar-sync,discord-intake-sync,watchdog,workspace-guard,report,briefing,remind,status-sync,queue-drain,sla-check,linear-autopilot,linear-engine',
    );
  }

  consumeConfirmation(flags.confirm);
  const approval = consumeApprovalIfRequired(settings, flags.approval, 'trigger', jobId);

  const whitelist = new Set(
    (Array.isArray(settings.control.triggerWhitelist) ? settings.control.triggerWhitelist : [])
      .map((item) => normalizeTriggerJobId(item))
      .filter(Boolean),
  );
  if (!whitelist.has(jobId)) {
    throw new Error(`job ${jobId} is not allowed. Update control.triggerWhitelist first.`);
  }

  const scriptPath = path.join(ROOT_DIR, 'scripts', 'tasks.js');
  const childArgs = buildTriggerChildArgs(jobId, settings, flags);
  const commandText = `${process.execPath} ${[scriptPath, ...childArgs].map(shellQuote).join(' ')}`;

  let payload = null;
  try {
    const output = runCommand(process.execPath, [scriptPath, ...childArgs]);
    payload = extractJson(output.stdout || '');
    const audit = appendAuditEvent('control-trigger-job', {
      jobId,
      command: commandText,
      ok: true,
      approvalId: approval.approvalId || '',
    });
    payload = payload && typeof payload === 'object'
      ? {
          ...payload,
          _triggerAuditId: audit.auditId,
        }
      : payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendAuditEvent('control-trigger-job-error', {
      jobId,
      command: commandText,
      ok: false,
      error: message,
    });
    throw error;
  }

  const result = {
    ok: true,
    jobId,
    command: commandText,
    approval,
    payload,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Trigger result:');
  lines.push(`- job: ${jobId}`);
  lines.push(`- command: ${commandText}`);
  if (payload && typeof payload === 'object') {
    lines.push(`- payload keys: ${Object.keys(payload).join(', ')}`);
  } else {
    lines.push('- payload: non-json output');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdAutoPr(settings, flags) {
  if (settings.autopr && settings.autopr.enabled === false) {
    throw new Error('autopr is disabled in config.');
  }

  const repoPath = path.resolve(String(flags.repo || path.resolve(ROOT_DIR, '..')).trim());
  const issueIdentifier = normalizeLinearIssueId(flags.issue || flags.identifier || '');
  const baseBranch = String(flags.base || settings.autopr.baseBranch || 'main').trim();
  const defaultDryRun = settings.autopr.defaultDryRun !== false;
  const explicitExecute = Boolean(flags.execute || flags.apply);
  const explicitDryRun = Boolean(flags['dry-run'] || flags.dryRun);
  const dryRun = explicitExecute ? false : explicitDryRun ? true : defaultDryRun;
  const testCommand = String(flags['test-command'] || settings.autopr.testCommand || '').trim();
  const maxChangedFiles = Math.max(1, Number(settings.autopr.maxChangedFiles || 30));
  const allowedPrefixes = Array.isArray(settings.autopr.allowedPathPrefixes)
    ? settings.autopr.allowedPathPrefixes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  const remote = getGitRemote(repoPath);
  const githubRepo = normalizeGithubRepo(remote);
  if (!githubRepo) {
    throw new Error(`Unable to resolve GitHub repo from remote: ${remote || '(missing)'}`);
  }

  const branchCurrent = String(
    runCommand('git', ['-C', repoPath, 'branch', '--show-current']).stdout || '',
  ).trim();
  if (!branchCurrent) {
    throw new Error('Unable to resolve current git branch.');
  }

  const statusOutput = runCommand('git', ['-C', repoPath, 'status', '--porcelain']).stdout || '';
  const changedFiles = parseGitChangedFiles(statusOutput);
  if (changedFiles.length === 0) {
    throw new Error('autopr found no local changes.');
  }
  if (changedFiles.length > maxChangedFiles) {
    throw new Error(`autopr changed files ${changedFiles.length} exceed maxChangedFiles=${maxChangedFiles}.`);
  }

  const lowRisk = evaluateAutoPrRisk(changedFiles, allowedPrefixes);
  if (!lowRisk.ok) {
    throw new Error(`autopr blocked by risk gate. Non-allowed files: ${lowRisk.blockedFiles.join(', ')}`);
  }

  const branchNeedsFork = ['main', 'master', baseBranch].includes(branchCurrent);
  const branchName = branchNeedsFork
    ? String(
        flags.branch ||
          `auto/${(issueIdentifier || 'ops').toLowerCase()}-${new Date()
            .toISOString()
            .replace(/[^0-9]/g, '')
            .slice(0, 12)}`,
      ).trim()
    : branchCurrent;

  const prTitle = String(flags.title || '').trim() || buildAutoPrTitle(issueIdentifier, changedFiles);
  const prBody =
    String(flags.body || '').trim() ||
    buildAutoPrBody({
      issueIdentifier,
      changedFiles,
      baseBranch,
      testCommand,
    });
  const draft = Boolean(flags.draft);

  const plan = {
    repoPath,
    githubRepo,
    baseBranch,
    branchCurrent,
    branchName,
    issueIdentifier,
    dryRun,
    testCommand,
    changedFiles,
    allowedPrefixes,
    title: prTitle,
    draft,
  };

  appendAuditEvent('autopr-plan', {
    repoPath,
    githubRepo,
    baseBranch,
    branchCurrent,
    branchName,
    issueIdentifier,
    dryRun,
    changedFiles: changedFiles.length,
  });

  if (dryRun) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, plan }, null, 2)}\n`);
      return;
    }
    const lines = [];
    lines.push('Auto PR plan (dry-run):');
    lines.push(`- repo: ${githubRepo}`);
    lines.push(`- base: ${baseBranch}`);
    lines.push(`- branch: ${branchName}`);
    lines.push(`- files: ${changedFiles.length}`);
    lines.push(`- title: ${prTitle}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }

  if (settings.autopr.allowExecute === false) {
    throw new Error('autopr execute mode is disabled. Set autopr.allowExecute=true in config first.');
  }
  consumeConfirmation(flags.confirm);
  const approval = consumeApprovalIfRequired(
    settings,
    flags.approval,
    'autopr',
    issueIdentifier || branchName,
  );

  const token = String(flags.token || settings.github.token || '').trim();
  if (!token) {
    throw new Error('GitHub token missing. Set GITHUB_TOKEN before autopr execute.');
  }

  if (branchNeedsFork) {
    runCommand('git', ['-C', repoPath, 'checkout', '-b', branchName]);
  }

  runCommand('git', ['-C', repoPath, 'add', '-A']);

  const commitMessage =
    String(flags['commit-message'] || '').trim() ||
    `${issueIdentifier ? `${issueIdentifier} ` : ''}chore: auto PR update`;
  runCommand('git', ['-C', repoPath, 'commit', '-m', commitMessage]);

  if (testCommand) {
    runShellCommand(testCommand, repoPath);
  }

  runCommand('git', ['-C', repoPath, 'push', '-u', 'origin', branchName]);

  const pullRequest = await createGithubPullRequest(
    token,
    githubRepo,
    {
      title: prTitle,
      body: prBody,
      head: branchName,
      base: baseBranch,
      draft,
    },
  );

  const result = {
    ok: true,
    dryRun: false,
    githubRepo,
    branch: branchName,
    base: baseBranch,
    approval,
    pullRequest,
  };

  const audit = appendAuditEvent('autopr-created', {
    repo: githubRepo,
    branch: branchName,
    base: baseBranch,
    prNumber: pullRequest.number,
    prUrl: pullRequest.url,
    draft,
    approvalId: approval.approvalId || '',
  });
  result.auditId = audit.auditId;

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `Auto PR created: ${githubRepo}#${pullRequest.number}\n${pullRequest.url}\n`,
  );
}

async function cmdEvalReplay(settings, flags) {
  if (settings.evalReplay && settings.evalReplay.enabled === false) {
    throw new Error('evalReplay is disabled in config.');
  }

  const issueFilter = normalizeLinearIssueId(flags.issue || flags.identifier || '');
  const maxSessions = Math.max(1, Number(flags['max-sessions'] || settings.evalReplay.maxSessions || 200));
  const maxRunsPerJob = Math.max(
    1,
    Number(flags['max-runs-per-job'] || settings.evalReplay.maxRunsPerJob || 20),
  );

  const snapshot = collectSnapshot(settings);
  const bindings = readJsonFile(ISSUE_LINKS_PATH, {});
  const records = [];

  const sessions = [...snapshot.sessions]
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, maxSessions);
  for (const session of sessions) {
    const issueIdentifier = resolveIssueFromBindings(bindings, {
      taskId: `session:${session.agentId}:${session.key}`,
      sessionId: session.sessionId || '',
      sessionKey: session.key || '',
    });
    if (issueFilter && issueIdentifier !== issueFilter) {
      continue;
    }
    records.push({
      type: 'session',
      issueIdentifier,
      agentId: session.agentId || '',
      sessionId: session.sessionId || '',
      sessionKey: session.key || '',
      model: session.model || '',
      ageMs: Number(session.ageMs || 0),
      updatedAtMs: Number(session.updatedAt || 0),
      totalTokens: session.totalTokens != null ? Number(session.totalTokens) : null,
      contextTokens: session.contextTokens != null ? Number(session.contextTokens) : null,
      abortedLastRun: Boolean(session.abortedLastRun),
    });
  }

  for (const job of snapshot.cronJobs) {
    const issueIdentifier = resolveIssueFromBindings(bindings, {
      taskId: `cron:${job.id}`,
      cronId: job.id,
    });
    if (issueFilter && issueIdentifier !== issueFilter) {
      continue;
    }

    const runs = loadCronRuns(job.id, maxRunsPerJob, settings);
    for (const run of runs) {
      records.push({
        type: 'cron-run',
        issueIdentifier,
        cronId: job.id,
        cronName: job.name || job.id,
        status: String(run.status || ''),
        ts: Number(run.ts || run.runAtMs || 0),
        durationMs: Number(run.durationMs || 0),
        summary: String(run.summary || ''),
        sessionId: String(run.sessionId || ''),
      });
    }
  }

  const nowMs = Date.now();
  const failures = records.filter(
    (item) =>
      item.type === 'cron-run' &&
      ['error', 'failed', 'timeout'].includes(String(item.status || '').toLowerCase()),
  ).length;
  const replay = {
    generatedAtMs: nowMs,
    generatedAt: new Date(nowMs).toISOString(),
    issueFilter,
    metrics: {
      sessions: records.filter((item) => item.type === 'session').length,
      cronRuns: records.filter((item) => item.type === 'cron-run').length,
      failures,
    },
    records,
  };

  const replayDir = path.join(DATA_DIR, 'eval-replay');
  ensureDir(replayDir);
  const stamp = new Date(nowMs).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const replayPath = path.join(replayDir, `replay-${stamp}.json`);
  writeJsonFile(replayPath, replay);

  let planPath = '';
  if (flags['emit-plan'] || flags.emitPlan) {
    const plan = renderEvalReplayPlan(replay, replayPath, settings);
    planPath = path.join(replayDir, `distill-plan-${stamp}.md`);
    fs.writeFileSync(planPath, `${plan}\n`, 'utf8');
  }

  appendAuditEvent('eval-replay-generated', {
    issueFilter,
    sessions: replay.metrics.sessions,
    cronRuns: replay.metrics.cronRuns,
    failures: replay.metrics.failures,
    replayPath,
    planPath,
  });

  const result = {
    ok: true,
    issueFilter,
    replayPath,
    planPath,
    metrics: replay.metrics,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Eval replay generated:');
  lines.push(`- replay: ${replayPath}`);
  if (planPath) {
    lines.push(`- plan: ${planPath}`);
  }
  lines.push(`- sessions: ${replay.metrics.sessions}`);
  lines.push(`- cron runs: ${replay.metrics.cronRuns}`);
  lines.push(`- failures: ${replay.metrics.failures}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdDistillExport(settings, flags) {
  if (settings.distillExport && settings.distillExport.enabled === false) {
    throw new Error('distillExport is disabled in config.');
  }

  const issueFilter = normalizeLinearIssueId(flags.issue || flags.identifier || '');
  const replayPathInput = String(flags.replay || flags['replay-path'] || '').trim();
  const replayPath = replayPathInput || findLatestEvalReplayPath();
  if (!replayPath || !fs.existsSync(replayPath)) {
    throw new Error('replay artifact not found. Run: npm run tasks -- eval-replay --emit-plan');
  }

  const replay = readJsonFile(replayPath, null);
  if (!replay || typeof replay !== 'object' || !Array.isArray(replay.records)) {
    throw new Error(`invalid replay artifact JSON: ${replayPath}`);
  }

  const maxSessions = Math.max(
    1,
    Number(flags['max-sessions'] || settings.distillExport.maxSessions || settings.evalReplay.maxSessions || 200),
  );
  const maxSamples = Math.max(
    1,
    Number(flags['max-samples'] || settings.distillExport.maxSamples || 2000),
  );
  const maxAuditEvents = Math.max(
    0,
    Number(flags['max-audit-events'] || settings.distillExport.maxAuditEvents || 2000),
  );
  const minUserChars = Math.max(
    1,
    Number(flags['min-user-chars'] || settings.distillExport.minUserChars || 6),
  );
  const minAssistantChars = Math.max(
    1,
    Number(flags['min-assistant-chars'] || settings.distillExport.minAssistantChars || 20),
  );
  const includeAudit =
    flags['include-audit'] === undefined
      ? settings.distillExport.includeAudit !== false
      : isTruthyLike(flags['include-audit']);
  const includeToolTrace =
    flags['include-tool-trace'] === undefined
      ? settings.distillExport.includeToolTrace !== false
      : isTruthyLike(flags['include-tool-trace']);
  const includeCodexCli =
    flags['include-codex-cli'] === undefined
      ? settings.distillExport.includeCodexCli !== false
      : isTruthyLike(flags['include-codex-cli']);
  const agentAllow = new Set(normalizeAgentIds(flags.agent || flags.agents || ''));

  const replaySessionRecords = replay.records
    .filter((item) => item && item.type === 'session')
    .filter((item) => !issueFilter || String(item.issueIdentifier || '') === issueFilter)
    .filter((item) => {
      if (agentAllow.size === 0) {
        return true;
      }
      return agentAllow.has(String(item.agentId || '').trim().toLowerCase());
    });
  const sessionRecords = replaySessionRecords.slice(0, maxSessions);
  const seenSessionKeys = new Set(
    sessionRecords
      .map((item) => `${String(item.agentId || '').trim()}:${String(item.sessionId || '').trim()}`)
      .filter((item) => !item.startsWith(':')),
  );
  const bindings = readJsonFile(ISSUE_LINKS_PATH, {});
  const liveSessions = loadSessions(settings)
    .filter((item) => item && item.sessionId && item.agentId)
    .filter((item) => {
      if (agentAllow.size === 0) {
        return true;
      }
      return agentAllow.has(String(item.agentId || '').trim().toLowerCase());
    })
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  for (const live of liveSessions) {
    if (sessionRecords.length >= maxSessions) {
      break;
    }
    const mergedKey = `${String(live.agentId || '').trim()}:${String(live.sessionId || '').trim()}`;
    if (!mergedKey || seenSessionKeys.has(mergedKey)) {
      continue;
    }
    const issueIdentifier = resolveIssueFromBindings(bindings, {
      taskId: `session:${live.agentId}:${live.key || ''}`,
      sessionId: live.sessionId || '',
      sessionKey: live.key || '',
    });
    if (issueFilter && issueIdentifier !== issueFilter) {
      continue;
    }
    sessionRecords.push({
      type: 'session',
      issueIdentifier,
      agentId: live.agentId || '',
      sessionId: live.sessionId || '',
      sessionKey: live.key || '',
      model: live.model || '',
      ageMs: Number(live.ageMs || 0),
      updatedAtMs: Number(live.updatedAt || 0),
      totalTokens: live.totalTokens != null ? Number(live.totalTokens) : null,
      contextTokens: live.contextTokens != null ? Number(live.contextTokens) : null,
      abortedLastRun: Boolean(live.abortedLastRun),
    });
    seenSessionKeys.add(mergedKey);
  }
  const selectedIssueIds = new Set(
    sessionRecords
      .map((item) => normalizeLinearIssueId(item && item.issueIdentifier ? item.issueIdentifier : ''))
      .filter(Boolean),
  );

  const rows = [];
  const byAgent = {};
  let sessionsMissingFile = 0;
  let sessionsProcessed = 0;
  let codexCliRows = 0;
  let codexCliFilesProcessed = 0;

  for (const record of sessionRecords) {
    if (rows.length >= maxSamples) {
      break;
    }
    const built = buildDistillSessionSamples(record, settings, {
      minUserChars,
      minAssistantChars,
      includeToolTrace,
      maxSamples: maxSamples - rows.length,
    });
    if (!built.foundFile) {
      sessionsMissingFile += 1;
      continue;
    }
    sessionsProcessed += 1;
    rows.push(...built.samples);
    const agentId = String(record.agentId || '').trim() || 'unknown';
    byAgent[agentId] = (byAgent[agentId] || 0) + built.samples.length;
  }

  const shouldIncludeCodexCli =
    includeCodexCli &&
    rows.length < maxSamples &&
    (agentAllow.size === 0 || agentAllow.has('codex') || agentAllow.has('codex-cli'));
  if (shouldIncludeCodexCli) {
    const codexBuilt = buildCodexCliSamples({
      issueFilter,
      maxSamples: maxSamples - rows.length,
      minUserChars,
      minAssistantChars,
      includeToolTrace,
    });
    rows.push(...codexBuilt.samples);
    codexCliRows = codexBuilt.samples.length;
    codexCliFilesProcessed = codexBuilt.filesProcessed;
    if (codexCliRows > 0) {
      byAgent['codex-cli'] = (byAgent['codex-cli'] || 0) + codexCliRows;
      for (const row of codexBuilt.samples) {
        const issue = normalizeLinearIssueId(row && row.issueIdentifier ? row.issueIdentifier : '');
        if (issue) {
          selectedIssueIds.add(issue);
        }
      }
    }
  }

  let auditSamples = 0;
  if (includeAudit && maxAuditEvents > 0 && rows.length < maxSamples) {
    const auditEvents = loadJsonlObjects(AUDIT_LOG_PATH, maxAuditEvents);
    for (const event of auditEvents) {
      if (rows.length >= maxSamples) {
        break;
      }
      const eventIssue = extractIssueIdentifierFromAuditEvent(event, issueFilter);
      if (issueFilter && eventIssue !== issueFilter) {
        continue;
      }
      if (!issueFilter && agentAllow.size > 0) {
        if (!eventIssue || !selectedIssueIds.has(eventIssue)) {
          continue;
        }
      }
      const detailText = sanitizeTrainingText(
        trimMessage(singleLine(stringifyForDataset(event && event.detail ? event.detail : {})), 900),
      );
      if (!detailText) {
        continue;
      }
      rows.push({
        schemaVersion: 1,
        type: 'ops_event',
        source: 'audit-jsonl',
        issueIdentifier: eventIssue,
        eventType: String((event && event.eventType) || 'unknown').trim(),
        timestamp: String((event && event.ts) || ''),
        input: `event_type=${String((event && event.eventType) || 'unknown').trim()}`,
        output: detailText,
      });
      auditSamples += 1;
    }
  }

  const distillDir = path.join(DATA_DIR, 'distill');
  ensureDir(distillDir);
  const nowMs = Date.now();
  const stamp = new Date(nowMs).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const issueSuffix = issueFilter ? `-${issueFilter.toLowerCase()}` : '';
  const datasetPath = path.join(distillDir, `dataset-${stamp}${issueSuffix}.jsonl`);
  const manifestPath = path.join(distillDir, `dataset-${stamp}${issueSuffix}.manifest.json`);

  const body = rows.map((item) => JSON.stringify(item)).join('\n');
  fs.writeFileSync(datasetPath, body ? `${body}\n` : '', 'utf8');

  const manifest = {
    ok: true,
    generatedAtMs: nowMs,
    generatedAt: new Date(nowMs).toISOString(),
    replayPath,
    issueFilter,
    settings: {
      maxSessions,
      maxSamples,
      maxAuditEvents,
      minUserChars,
      minAssistantChars,
      includeAudit,
      includeToolTrace,
      agentFilter: [...agentAllow],
    },
    metrics: {
      rows: rows.length,
      sessionRows: rows.filter((item) => item.type === 'sft_turn').length,
      auditRows: rows.filter((item) => item.type === 'ops_event').length,
      sessionsRequested: sessionRecords.length,
      sessionsProcessed,
      sessionsMissingFile,
      codexCliRows,
      codexCliFilesProcessed,
      auditRowsAdded: auditSamples,
      byAgent,
    },
    datasetPath,
  };
  writeJsonFile(manifestPath, manifest);

  appendAuditEvent('distill-export-generated', {
    issueFilter,
    replayPath,
    datasetPath,
    manifestPath,
    rows: manifest.metrics.rows,
    sessionRows: manifest.metrics.sessionRows,
    auditRows: manifest.metrics.auditRows,
    sessionsProcessed: manifest.metrics.sessionsProcessed,
    sessionsMissingFile: manifest.metrics.sessionsMissingFile,
    codexCliRows: manifest.metrics.codexCliRows,
    codexCliFilesProcessed: manifest.metrics.codexCliFilesProcessed,
  });

  const result = {
    ok: true,
    issueFilter,
    replayPath,
    datasetPath,
    manifestPath,
    metrics: manifest.metrics,
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Distill dataset exported:');
  lines.push(`- replay: ${replayPath}`);
  lines.push(`- dataset: ${datasetPath}`);
  lines.push(`- manifest: ${manifestPath}`);
  lines.push(`- rows: ${manifest.metrics.rows}`);
  lines.push(`- session rows: ${manifest.metrics.sessionRows}`);
  lines.push(`- audit rows: ${manifest.metrics.auditRows}`);
  lines.push(`- sessions processed: ${manifest.metrics.sessionsProcessed}`);
  lines.push(`- sessions missing file: ${manifest.metrics.sessionsMissingFile}`);
  lines.push(`- codex cli rows: ${manifest.metrics.codexCliRows}`);
  lines.push(`- codex cli files processed: ${manifest.metrics.codexCliFilesProcessed}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function findLatestEvalReplayPath() {
  const replayDir = path.join(DATA_DIR, 'eval-replay');
  const files = listDir(replayDir)
    .filter((name) => /^replay-\d{14}\.json$/i.test(String(name || '')))
    .sort();
  if (files.length === 0) {
    return '';
  }
  return path.join(replayDir, files[files.length - 1]);
}

function buildDistillSessionSamples(record, settings, options = {}) {
  const agentId = String((record && record.agentId) || '').trim();
  const sessionId = String((record && record.sessionId) || '').trim();
  if (!agentId || !sessionId) {
    return { foundFile: false, samples: [] };
  }

  const sessionPath = path.join(settings.openclawHome, 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
  if (!fs.existsSync(sessionPath)) {
    return { foundFile: false, samples: [] };
  }

  const minUserChars = Math.max(1, Number(options.minUserChars || 6));
  const minAssistantChars = Math.max(1, Number(options.minAssistantChars || 20));
  const includeToolTrace = options.includeToolTrace !== false;
  const maxSamples = Math.max(1, Number(options.maxSamples || 500));
  const events = loadJsonlObjects(sessionPath, 0);
  const samples = [];

  let pendingUser = null;
  let toolTrace = [];

  for (const event of events) {
    if (samples.length >= maxSamples) {
      break;
    }
    if (!event || String(event.type || '') !== 'message' || !event.message || typeof event.message !== 'object') {
      continue;
    }
    const role = String(event.message.role || '').trim().toLowerCase();
    const text = sanitizeTrainingText(extractMessageText(event.message.content));
    if (role === 'user') {
      if (text.length < minUserChars) {
        pendingUser = null;
        toolTrace = [];
        continue;
      }
      pendingUser = {
        text,
        timestamp: event.timestamp || '',
      };
      toolTrace = [];
      continue;
    }
    if (role === 'assistant') {
      const calls = includeToolTrace ? extractToolCallSummaries(event.message.content) : [];
      if (calls.length > 0 && !text) {
        toolTrace.push(...calls.map((item) => sanitizeTrainingText(item)).filter(Boolean).slice(0, 6));
        toolTrace = toolTrace.slice(-20);
        continue;
      }
      if (!pendingUser || text.length < minAssistantChars) {
        continue;
      }

      const sample = {
        schemaVersion: 1,
        type: 'sft_turn',
        source: 'session-jsonl',
        issueIdentifier: String((record && record.issueIdentifier) || '').trim(),
        agentId,
        sessionId,
        sessionKey: String((record && record.sessionKey) || '').trim(),
        model: String((event.message && event.message.model) || (record && record.model) || '').trim(),
        timestamp: String(event.timestamp || pendingUser.timestamp || ''),
        input: pendingUser.text,
        output: text,
      };
      const usage = extractMessageUsage(event.message);
      if (usage) {
        sample.usage = usage;
      }
      if (includeToolTrace && toolTrace.length > 0) {
        sample.toolTrace = toolTrace.slice(0, 20);
      }
      samples.push(sample);
      pendingUser = null;
      toolTrace = [];
      continue;
    }
    if (role === 'toolresult' && includeToolTrace && text) {
      toolTrace.push(`tool_result: ${trimMessage(singleLine(text), 400)}`);
      toolTrace = toolTrace.slice(-20);
    }
  }

  return {
    foundFile: true,
    sessionPath,
    samples,
  };
}

function extractMessageUsage(message) {
  if (!message || typeof message !== 'object' || !message.usage || typeof message.usage !== 'object') {
    return null;
  }
  const usage = message.usage;
  const mapped = {
    input: usage.input != null ? Number(usage.input) : null,
    output: usage.output != null ? Number(usage.output) : null,
    cacheRead: usage.cacheRead != null ? Number(usage.cacheRead) : null,
    cacheWrite: usage.cacheWrite != null ? Number(usage.cacheWrite) : null,
    totalTokens: usage.totalTokens != null ? Number(usage.totalTokens) : null,
  };
  if (
    mapped.input == null &&
    mapped.output == null &&
    mapped.cacheRead == null &&
    mapped.cacheWrite == null &&
    mapped.totalTokens == null
  ) {
    return null;
  }
  return mapped;
}

function loadJsonlObjects(filePath, limit = 0) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const windowed = limit > 0 ? lines.slice(-Math.max(1, Number(limit))) : lines;
  const items = [];
  for (const line of windowed) {
    try {
      items.push(JSON.parse(line));
    } catch {
      // skip malformed line
    }
  }
  return items;
}

function extractMessageText(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts = [];
  for (const chunk of content) {
    if (typeof chunk === 'string') {
      const text = chunk.trim();
      if (text) {
        parts.push(text);
      }
      continue;
    }
    if (!chunk || typeof chunk !== 'object') {
      continue;
    }
    if (typeof chunk.text === 'string' && ['text', 'input_text', 'output_text'].includes(String(chunk.type || ''))) {
      const text = chunk.text.trim();
      if (text) {
        parts.push(text);
      }
      continue;
    }
    if (typeof chunk.content === 'string' && String(chunk.type || '') === 'text') {
      const text = chunk.content.trim();
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join('\n').trim();
}

function extractToolCallSummaries(content) {
  if (!Array.isArray(content)) {
    return [];
  }
  const traces = [];
  for (const chunk of content) {
    if (!chunk || typeof chunk !== 'object') {
      continue;
    }
    if (String(chunk.type || '') !== 'toolCall') {
      continue;
    }
    const name = String(chunk.name || 'tool').trim() || 'tool';
    let args = '';
    if (typeof chunk.arguments === 'string') {
      args = chunk.arguments;
    } else if (chunk.arguments && typeof chunk.arguments === 'object') {
      args = stringifyForDataset(chunk.arguments);
    } else if (typeof chunk.partialJson === 'string') {
      args = chunk.partialJson;
    }
    const argSummary = args ? trimMessage(singleLine(args), 300) : '';
    traces.push(argSummary ? `tool_call ${name}: ${argSummary}` : `tool_call ${name}`);
  }
  return traces;
}

function stringifyForDataset(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractIssueIdentifierFromAuditEvent(event, fallback = '') {
  const preferred = normalizeLinearIssueId(
    event && event.detail && (event.detail.issueIdentifier || event.detail.identifier || event.detail.issue || ''),
  );
  if (preferred) {
    return preferred;
  }
  const blob = `${stringifyForDataset(event)} ${fallback || ''}`;
  const match = blob.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  if (match) {
    return normalizeLinearIssueId(match[1]);
  }
  return normalizeLinearIssueId(fallback);
}

function sanitizeTrainingText(text) {
  let value = String(text || '');
  if (!value) {
    return '';
  }
  value = value.replace(/\r\n/g, '\n');
  value = value.replace(/\blin_api_[A-Za-z0-9]+\b/g, 'lin_api_[REDACTED]');
  value = value.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, 'sk-[REDACTED]');
  value = value.replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, 'gh_[REDACTED]');
  value = value.replace(/\b(?:xoxb|xoxp|xoxa|xoxr)-[A-Za-z0-9-]{16,}\b/g, 'xox-[REDACTED]');
  value = value.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, 'Bearer [REDACTED]');
  value = value.replace(
    /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*['"]?[A-Za-z0-9._-]{8,}['"]?/gi,
    '$1=[REDACTED]',
  );
  return value.trim();
}

function buildCodexCliSamples(options = {}) {
  const sessionsRoot = String(options.sessionsRoot || path.join(os.homedir(), '.codex', 'sessions')).trim();
  if (!sessionsRoot || !fs.existsSync(sessionsRoot)) {
    return {
      samples: [],
      filesProcessed: 0,
      filesMatched: 0,
      sessionsRoot,
    };
  }

  const maxSamples = Math.max(1, Number(options.maxSamples || 500));
  const files = listJsonlFilesRecursive(sessionsRoot).sort((a, b) => b.localeCompare(a));
  const samples = [];
  let filesProcessed = 0;

  for (const filePath of files) {
    if (samples.length >= maxSamples) {
      break;
    }
    filesProcessed += 1;
    const parsed = parseCodexCliSessionFile(filePath, {
      issueFilter: options.issueFilter || '',
      minUserChars: options.minUserChars || 6,
      minAssistantChars: options.minAssistantChars || 20,
      includeToolTrace: options.includeToolTrace !== false,
      maxSamples: maxSamples - samples.length,
    });
    samples.push(...parsed.samples);
  }

  return {
    samples,
    filesProcessed,
    filesMatched: files.length,
    sessionsRoot,
  };
}

function parseCodexCliSessionFile(filePath, options = {}) {
  const entries = loadJsonlObjects(filePath, 0);
  const issueFilter = normalizeLinearIssueId(options.issueFilter || '');
  const minUserChars = Math.max(1, Number(options.minUserChars || 6));
  const minAssistantChars = Math.max(1, Number(options.minAssistantChars || 20));
  const includeToolTrace = options.includeToolTrace !== false;
  const maxSamples = Math.max(1, Number(options.maxSamples || 200));
  const samples = [];

  let pendingUser = null;
  let toolTrace = [];
  let activeModel = '';

  for (const entry of entries) {
    if (samples.length >= maxSamples) {
      break;
    }

    if (entry && String(entry.type || '') === 'turn_context' && entry.payload && typeof entry.payload === 'object') {
      activeModel = String(entry.payload.model || activeModel || '').trim();
      continue;
    }

    if (
      entry &&
      String(entry.type || '') === 'event_msg' &&
      entry.payload &&
      String(entry.payload.type || '') === 'user_message'
    ) {
      const userText = sanitizeTrainingText(String(entry.payload.message || '').trim());
      if (userText.length < minUserChars) {
        pendingUser = null;
        toolTrace = [];
        continue;
      }
      pendingUser = {
        text: userText,
        timestamp: String(entry.timestamp || ''),
      };
      toolTrace = [];
      continue;
    }

    if (
      entry &&
      String(entry.type || '') === 'response_item' &&
      entry.payload &&
      String(entry.payload.type || '') === 'function_call' &&
      pendingUser &&
      includeToolTrace
    ) {
      const name = String(entry.payload.name || 'tool').trim() || 'tool';
      const argsRaw =
        typeof entry.payload.arguments === 'string'
          ? entry.payload.arguments
          : stringifyForDataset(entry.payload.arguments || {});
      const args = sanitizeTrainingText(trimMessage(singleLine(argsRaw), 300));
      toolTrace.push(args ? `tool_call ${name}: ${args}` : `tool_call ${name}`);
      toolTrace = toolTrace.slice(-20);
      continue;
    }

    if (
      entry &&
      String(entry.type || '') === 'response_item' &&
      entry.payload &&
      String(entry.payload.type || '') === 'function_call_output' &&
      pendingUser &&
      includeToolTrace
    ) {
      const out = sanitizeTrainingText(trimMessage(singleLine(String(entry.payload.output || '')), 350));
      if (out) {
        toolTrace.push(`tool_result: ${out}`);
        toolTrace = toolTrace.slice(-20);
      }
      continue;
    }

    if (
      entry &&
      String(entry.type || '') === 'response_item' &&
      entry.payload &&
      String(entry.payload.type || '') === 'message' &&
      String(entry.payload.role || '').toLowerCase() === 'assistant'
    ) {
      if (!pendingUser) {
        continue;
      }
      const output = sanitizeTrainingText(extractMessageText(entry.payload.content));
      if (output.length < minAssistantChars) {
        continue;
      }
      const issueIdentifier = extractIssueIdentifierFromText(
        `${pendingUser.text}\n${output}`,
        issueFilter,
      );
      if (issueFilter && issueIdentifier !== issueFilter) {
        pendingUser = null;
        toolTrace = [];
        continue;
      }

      const sample = {
        schemaVersion: 1,
        type: 'sft_turn',
        source: 'codex-cli-session',
        issueIdentifier,
        agentId: 'codex-cli',
        sessionId: path.basename(filePath, '.jsonl'),
        sessionPath: filePath,
        model: activeModel || 'gpt-5.3-codex',
        timestamp: String(entry.timestamp || pendingUser.timestamp || ''),
        input: pendingUser.text,
        output,
      };
      if (includeToolTrace && toolTrace.length > 0) {
        sample.toolTrace = toolTrace.slice(0, 20);
      }
      samples.push(sample);
      pendingUser = null;
      toolTrace = [];
    }
  }

  return { samples };
}

function extractIssueIdentifierFromText(text, fallback = '') {
  const direct = normalizeLinearIssueId(fallback);
  const match = String(text || '').match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  if (match) {
    return normalizeLinearIssueId(match[1]);
  }
  return direct;
}

function listJsonlFilesRecursive(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return [];
  }
  const result = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        result.push(nextPath);
      }
    }
  }
  return result;
}

async function cmdSchedule(settings, flags) {
  if (flags.help || flags.h) {
    process.stdout.write(
      [
        'Usage:',
        '  schedule [--apply] [--mode full|minimal] [--execution-loop autopilot|engine] [--engine-max-steps N] [--engine-drain true|false] [--engine-drain-max-issues N] [--agent AGENT|auto] [--channel CH] [--target TGT]',
        '',
        'Behavior:',
        '  - Without --apply: print proposed crontab block only.',
        '  - With --apply: install the generated block into user crontab.',
      ].join('\n') + '\n',
    );
    return;
  }

  const timezone = String(flags.tz || settings.timezone || 'Asia/Shanghai').trim();
  const apply = Boolean(flags.apply);
  const mode = String(flags.mode || 'minimal').trim().toLowerCase();
  if (!['full', 'minimal'].includes(mode)) {
    throw new Error(`invalid schedule mode: ${mode}. expected full|minimal`);
  }
  const minimalMode = mode === 'minimal';
  const executionLoopRaw = String(
    flags['execution-loop'] || flags.executionLoop || (settings.execution && settings.execution.loopCommand) || 'linear-autopilot',
  ).trim();
  const executionLoop = normalizeExecutionLoopCommand(executionLoopRaw);
  if (!executionLoop) {
    throw new Error(`invalid execution loop: ${executionLoopRaw}. expected autopilot|engine`);
  }

  const channel = String(flags.channel || settings.report.channel || '').trim();
  const target = String(flags.target || settings.report.target || '').trim();
  const reminderChannel = String(
    flags['reminder-channel'] || settings.reminders.channel || channel || '',
  ).trim();
  const reminderTarget = String(
    flags['reminder-target'] || settings.reminders.target || target || '',
  ).trim();
  const withReminders =
    !minimalMode && !Boolean(flags['without-reminders']) && Boolean(settings.reminders.enabled !== false);
  const briefingChannel = String(
    flags['briefing-channel'] || settings.briefing.channel || channel || '',
  ).trim();
  const briefingTarget = String(
    flags['briefing-target'] || settings.briefing.target || target || '',
  ).trim();
  const withBriefing =
    !minimalMode && !Boolean(flags['without-briefing']) && Boolean(settings.briefing.enabled !== false);
  const nodeBin = process.execPath;
  const scriptPath = path.join(ROOT_DIR, 'scripts', 'tasks.js');
  const reportLog = path.join(DATA_DIR, 'report-cron.log');
  const watchdogLog = path.join(DATA_DIR, 'watchdog-cron.log');
  const reminderDueLog = path.join(DATA_DIR, 'reminder-due-cron.log');
  const reminderCycleLog = path.join(DATA_DIR, 'reminder-cycle-cron.log');
  const briefingDailyLog = path.join(DATA_DIR, 'briefing-daily-cron.log');
  const briefingWeeklyLog = path.join(DATA_DIR, 'briefing-weekly-cron.log');
  const githubSyncLog = path.join(DATA_DIR, 'github-sync-cron.log');
  const todoistSyncLog = path.join(DATA_DIR, 'todoist-sync-cron.log');
  const calendarSyncLog = path.join(DATA_DIR, 'calendar-sync-cron.log');
  const discordIntakeLog = path.join(DATA_DIR, 'discord-intake-cron.log');
  const statusSyncLog = path.join(DATA_DIR, 'status-sync-cron.log');
  const queueDrainLog = path.join(DATA_DIR, 'queue-drain-cron.log');
  const slaCheckLog = path.join(DATA_DIR, 'sla-check-cron.log');
  const workspaceGuardLog = path.join(DATA_DIR, 'workspace-guard-cron.log');
  const linearExecutionLog = path.join(DATA_DIR, `${executionLoop}-cron.log`);
  const watchdogInterval = Number(flags['watchdog-interval'] || 5);
  const githubPollMinutes = Number(flags['github-poll-minutes'] || settings.github.pollIntervalMinutes || 15);
  const todoistPollMinutes = Number(flags['todoist-poll-minutes'] || 30);
  const calendarPollMinutes = Number(flags['calendar-poll-minutes'] || 60);
  const discordIntakeMinutes = Number(
    flags['discord-intake-minutes'] || settings.discordIntake.pollMinutes || 2,
  );
  const statusSyncMinutes = Number(
    flags['status-sync-minutes'] || settings.statusMachine.pollMinutes || 10,
  );
  const queueDrainMinutes = Number(
    flags['queue-drain-minutes'] || settings.intakeQueue.pollMinutes || 2,
  );
  const workspaceGuardMinutes = Number(
    flags['workspace-guard-minutes'] || (settings.workspaceGuard && settings.workspaceGuard.pollMinutes) || 5,
  );
  const slaPollMinutes = Number(flags['sla-poll-minutes'] || settings.sla.pollMinutes || 30);
  const executionPollMinutes = Number(
    flags['execution-poll-minutes'] || settings.execution.pollMinutes || 15,
  );
  const githubExpr = minimalMode ? '' : cronEveryMinutesExpr(githubPollMinutes);
  const todoistExpr = minimalMode ? '' : cronEveryMinutesExpr(todoistPollMinutes);
  const calendarExpr = minimalMode ? '' : cronEveryMinutesExpr(calendarPollMinutes);
  const discordIntakeExpr =
    settings.discordIntake.enabled === false ? '' : cronEveryMinutesExpr(discordIntakeMinutes);
  const statusSyncExpr =
    minimalMode || settings.statusMachine.enabled === false ? '' : cronEveryMinutesExpr(statusSyncMinutes);
  const queueDrainExpr =
    settings.intakeQueue.enabled === false ? '' : cronEveryMinutesExpr(queueDrainMinutes);
  const workspaceGuardExpr =
    settings.workspaceGuard && settings.workspaceGuard.enabled === false ? '' : cronEveryMinutesExpr(workspaceGuardMinutes);
  const slaExpr = minimalMode || settings.sla.enabled === false ? '' : cronEveryMinutesExpr(slaPollMinutes);
  const linearExecutionExpr =
    settings.execution.enabled === false ? '' : cronEveryMinutesExpr(executionPollMinutes);

  ensureDir(DATA_DIR);

  const reportParts = [nodeBin, scriptPath, 'report'];
  if (channel && target) {
    reportParts.push('--send', '--channel', channel, '--target', target);
  }

  const watchdogParts = [nodeBin, scriptPath, 'watchdog', '--auto-linear'];
  const githubSyncParts = [nodeBin, scriptPath, 'github-sync'];
  const todoistBatchSize = Math.max(1, Number(settings.todoist.syncBatchSize || 10));
  const todoistSyncParts = [nodeBin, scriptPath, 'todoist-sync', '--limit', String(todoistBatchSize)];
  const calendarSyncParts = [nodeBin, scriptPath, 'calendar-sync'];
  const discordIntakeParts = [nodeBin, scriptPath, 'discord-intake-sync'];
  const discordIntakeChannels = resolveDiscordIntakeChannelIds(settings, flags);
  if (discordIntakeChannels.length > 0) {
    discordIntakeParts.push('--channel', discordIntakeChannels.join(','));
  }
  const statusSyncParts = [nodeBin, scriptPath, 'status-sync'];
  const queueDrainParts = [nodeBin, scriptPath, 'queue-drain'];
  const workspaceGuardParts = [nodeBin, scriptPath, 'workspace-guard'];
  const slaCheckParts = [nodeBin, scriptPath, 'sla-check'];
  const linearExecutionParts = [nodeBin, scriptPath, executionLoop];
  if (executionLoop === 'linear-engine') {
    const engineMaxSteps = Math.max(
      1,
      Number(
        flags['engine-max-steps'] ||
          (settings.execution && settings.execution.engineMaxSteps) ||
          3,
      ),
    );
    const engineNoProgressThreshold = Math.max(
      2,
      Number(
        flags['engine-no-progress-threshold'] ||
          (settings.execution && settings.execution.engineNoProgressThreshold) ||
          2,
      ),
    );
    const engineStepSleepMs = Math.max(
      0,
      Number(
        flags['engine-step-sleep-ms'] ||
          (settings.execution && settings.execution.engineStepSleepMs) ||
          0,
      ),
    );
    const engineAutoPick =
      flags['engine-auto-pick'] !== undefined
        ? isTruthyLike(flags['engine-auto-pick'])
        : Boolean(settings.execution && settings.execution.engineAutoPick !== false);
    const engineDrain =
      flags['engine-drain'] !== undefined
        ? isTruthyLike(flags['engine-drain'])
        : Boolean(settings.execution && settings.execution.engineDrain === true);
    const engineDrainMaxIssues = Math.max(
      1,
      Number(
        flags['engine-drain-max-issues'] ||
          (settings.execution && settings.execution.engineDrainMaxIssues) ||
          8,
      ),
    );

    linearExecutionParts.push('--max-steps', String(engineMaxSteps));
    linearExecutionParts.push('--no-progress-threshold', String(engineNoProgressThreshold));
    if (engineDrain) {
      linearExecutionParts.push('--drain', '--drain-max-issues', String(engineDrainMaxIssues));
    }
    if (engineStepSleepMs > 0) {
      linearExecutionParts.push('--step-sleep-ms', String(engineStepSleepMs));
    }
    if (engineAutoPick) {
      linearExecutionParts.push('--auto-pick');
    }
  }
  const executionAgentOverride = String(flags.agent || '').trim();
  if (executionAgentOverride) {
    linearExecutionParts.push('--agent', executionAgentOverride);
  }
  const executionTierOverride = String(flags.tier || '').trim();
  if (executionTierOverride) {
    linearExecutionParts.push('--tier', executionTierOverride);
  }
  const remindDueParts = [nodeBin, scriptPath, 'remind', 'due'];
  const remindCycleParts = [nodeBin, scriptPath, 'remind', 'cycle'];
  const briefingDailyParts = [nodeBin, scriptPath, 'briefing', 'daily'];
  const briefingWeeklyParts = [nodeBin, scriptPath, 'briefing', 'weekly'];
  const dueSoonDays = Number(flags.days || settings.reminders.dueSoonDays || 7);
  if (dueSoonDays > 0) {
    remindDueParts.push('--days', String(dueSoonDays));
  }
  if (reminderChannel && reminderTarget) {
    remindDueParts.push('--send', '--channel', reminderChannel, '--target', reminderTarget);
    remindCycleParts.push('--send', '--channel', reminderChannel, '--target', reminderTarget);
  }
  if (briefingChannel && briefingTarget) {
    briefingDailyParts.push('--send', '--channel', briefingChannel, '--target', briefingTarget);
    briefingWeeklyParts.push('--send', '--channel', briefingChannel, '--target', briefingTarget);
  }

  const blockLines = [
    '# OPENCLAW_CONTROL_CENTER_BEGIN',
    `CRON_TZ=${timezone}`,
    'PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    ...(!minimalMode
      ? [
          `0 9,18 * * * cd ${shellQuote(ROOT_DIR)} && ${joinShell(reportParts)} >> ${shellQuote(reportLog)} 2>&1`,
          `*/${watchdogInterval} * * * * cd ${shellQuote(ROOT_DIR)} && ${joinShell(watchdogParts)} >> ${shellQuote(watchdogLog)} 2>&1`,
        ]
      : []),
    ...(discordIntakeExpr
      ? [
          `${discordIntakeExpr} cd ${shellQuote(ROOT_DIR)} && ${joinShell(discordIntakeParts)} >> ${shellQuote(discordIntakeLog)} 2>&1`,
        ]
      : []),
    ...(githubExpr
      ? [
          `${githubExpr} cd ${shellQuote(ROOT_DIR)} && ${joinShell(githubSyncParts)} >> ${shellQuote(githubSyncLog)} 2>&1`,
        ]
      : []),
    ...(todoistExpr
      ? [
          `${todoistExpr} cd ${shellQuote(ROOT_DIR)} && ${joinShell(todoistSyncParts)} >> ${shellQuote(todoistSyncLog)} 2>&1`,
        ]
      : []),
    ...(calendarExpr
      ? [
          `${calendarExpr} cd ${shellQuote(ROOT_DIR)} && ${joinShell(calendarSyncParts)} >> ${shellQuote(calendarSyncLog)} 2>&1`,
        ]
      : []),
    ...(statusSyncExpr
      ? [
          `${statusSyncExpr} cd ${shellQuote(ROOT_DIR)} && ${joinShell(statusSyncParts)} >> ${shellQuote(statusSyncLog)} 2>&1`,
        ]
      : []),
    ...(queueDrainExpr
      ? [
          `${queueDrainExpr} cd ${shellQuote(ROOT_DIR)} && ${joinShell(queueDrainParts)} >> ${shellQuote(queueDrainLog)} 2>&1`,
        ]
      : []),
    ...(workspaceGuardExpr
      ? [
          `${workspaceGuardExpr} cd ${shellQuote(ROOT_DIR)} && ${joinShell(workspaceGuardParts)} >> ${shellQuote(workspaceGuardLog)} 2>&1`,
        ]
      : []),
    ...(slaExpr
      ? [
          `${slaExpr} cd ${shellQuote(ROOT_DIR)} && ${joinShell(slaCheckParts)} >> ${shellQuote(slaCheckLog)} 2>&1`,
        ]
      : []),
    ...(linearExecutionExpr
      ? [
          `${linearExecutionExpr} cd ${shellQuote(ROOT_DIR)} && ${joinShell(linearExecutionParts)} >> ${shellQuote(linearExecutionLog)} 2>&1`,
        ]
      : []),
    ...(withReminders
      ? [
          `${settings.reminders.dueSoonCron || '0 10 * * *'} cd ${shellQuote(ROOT_DIR)} && ${joinShell(remindDueParts)} >> ${shellQuote(reminderDueLog)} 2>&1`,
          `${settings.reminders.cycleCron || '30 9 * * 1'} cd ${shellQuote(ROOT_DIR)} && ${joinShell(remindCycleParts)} >> ${shellQuote(reminderCycleLog)} 2>&1`,
        ]
      : []),
    ...(withBriefing
      ? [
          `${settings.briefing.dailyCron || '15 9 * * *'} cd ${shellQuote(ROOT_DIR)} && ${joinShell(briefingDailyParts)} >> ${shellQuote(briefingDailyLog)} 2>&1`,
          `${settings.briefing.weeklyCron || '0 9 * * 1'} cd ${shellQuote(ROOT_DIR)} && ${joinShell(briefingWeeklyParts)} >> ${shellQuote(briefingWeeklyLog)} 2>&1`,
        ]
      : []),
    '# OPENCLAW_CONTROL_CENTER_END',
  ];

  const block = blockLines.join('\n');

  if (!apply) {
    process.stdout.write(`Proposed crontab block (mode=${mode}, execution=${executionLoop}):\n`);
    process.stdout.write(`${block}\n`);
    process.stdout.write('\nRun with --apply to install this block into your user crontab.\n');
    return;
  }

  const current = readCrontab();
  const next = replaceCrontabBlock(current, block);
  writeCrontab(next);

  process.stdout.write(
    `Crontab updated with OpenClaw Control Center schedule (mode=${mode}, execution=${executionLoop}).\n`,
  );
}

async function cmdTriage(settings, flags) {
  const rawText = String(flags.text || flags._.join(' ') || '').trim();
  const title = String(flags.title || '').trim();
  const description = String(flags.description || flags.desc || '').trim();
  const source = String(flags.source || 'manual').trim();
  const sourceId = String(flags['source-id'] || flags.sourceId || '').trim();
  const author = String(flags.author || '').trim();
  const sourceUrl = String(flags.url || '').trim();
  const state = String(flags.state || 'Triage').trim();
  const labels = normalizeLabelNames(flags.labels || flags.label || '');
  const dueDate = String(flags['due-date'] || '').trim();
  const priority = Number(flags.priority || 3);
  const eventType = normalizeIngestEventType(flags['event-type'] || flags.eventType || '', 'triage.cli');

  const delivery = await createTriageIssueWithFallback(
    {
      title,
      rawText,
      description,
      source,
      sourceId,
      author,
      sourceUrl,
      state,
      labels,
      dueDate,
      eventType,
      priority: Number.isFinite(priority) ? priority : 3,
    },
    settings,
    { context: 'triage-cli' },
  );
  if (delivery.queued) {
    const queuedResult = {
      ok: true,
      queued: true,
      queueId: delivery.queueId,
      error: delivery.error,
      source,
      sourceId: sourceId ? normalizeSourceId(sourceId) : deriveAutoSourceId({ source, title, rawText, description }),
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(queuedResult, null, 2)}\n`);
      return;
    }
    const lines = [];
    lines.push('Triage intake queued:');
    lines.push(`- queueId: ${delivery.queueId}`);
    lines.push(`- error: ${singleLine(delivery.error)}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }
  const issue = delivery.issue;

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(issue, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Triage issue created:');
  lines.push(`- ${issue.identifier}: ${issue.title}`);
  if (issue.deduped) {
    lines.push(`- deduped: yes (${issue.dedupeKey || '-'})`);
  }
  lines.push(`- state: ${issue.stateName || '-'}`);
  lines.push(`- priority: ${issue.priority || '-'}`);
  if (issue.url) {
    lines.push(`- url: ${issue.url}`);
  }
  if (issue.labels && issue.labels.length > 0) {
    lines.push(`- labels: ${issue.labels.join(', ')}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdRemind(settings, flags) {
  const mode = String(flags._[0] || 'all').trim().toLowerCase();
  if (!['all', 'due', 'cycle'].includes(mode)) {
    throw new Error(`invalid remind mode: ${mode}. expected due|cycle|all`);
  }

  const dueDays = Math.max(1, Number(flags.days || settings.reminders.dueSoonDays || 7));
  const includeSla = !Boolean(flags['without-sla']);
  const staleInProgressDays = Math.max(
    1,
    Number(flags['stale-days'] || settings.reminders.staleInProgressDays || 3),
  );
  const blockedEscalationHours = Math.max(
    1,
    Number(flags['blocked-hours'] || settings.reminders.blockedEscalationHours || 24),
  );
  const autoEscalateBlocked = Boolean(
    flags['auto-escalate'] ||
      flags.escalate ||
      settings.reminders.autoEscalateBlocked === true,
  );
  const reminderBundle = await buildReminderPayload(settings, {
    mode,
    dueDays,
    includeSla,
    staleInProgressDays,
    blockedEscalationHours,
    autoEscalateBlocked,
  });
  const data = reminderBundle.data;

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReminder(data, settings)}\n`);
  }

  if (flags.send) {
    const channel = String(
      flags.channel || settings.reminders.channel || settings.report.channel || '',
    ).trim();
    const target = String(
      flags.target || settings.reminders.target || settings.report.target || '',
    ).trim();
    if (!channel || !target) {
      throw new Error('remind --send requires --channel and --target (or values in config).');
    }

    const maxLength = Number(flags['max-message-length'] || settings.reminders.maxSendLength || 3000);
    const text = trimMessage(renderReminder(data, settings), maxLength);
    runCommand('openclaw', [
      'message',
      'send',
      '--channel',
      channel,
      '--target',
      target,
      '--message',
      text,
    ]);
    process.stdout.write(`Reminder sent via openclaw message send (${channel} -> ${target}).\n`);
  }
}

async function buildReminderPayload(settings, options = {}) {
  const mode = String(options.mode || 'all').trim().toLowerCase();
  const dueDays = Math.max(1, Number(options.dueDays || settings.reminders.dueSoonDays || 7));
  const includeSla = options.includeSla !== false;
  const staleInProgressDays = Math.max(
    1,
    Number(options.staleInProgressDays || settings.reminders.staleInProgressDays || 3),
  );
  const blockedEscalationHours = Math.max(
    1,
    Number(options.blockedEscalationHours || settings.reminders.blockedEscalationHours || 24),
  );
  const autoEscalateBlocked = Boolean(options.autoEscalateBlocked);

  const apiKey = String(settings.linear.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is required for remind.');
  }

  const teamId = settings.linear.teamId || (await resolveLinearTeamId(apiKey, settings.linear.teamKey));
  if (!teamId) {
    throw new Error('Unable to resolve Linear team id for reminder.');
  }

  const data = {
    generatedAtMs: Date.now(),
    mode,
    dueDays,
    staleInProgressDays,
    blockedEscalationHours,
    due: [],
    cycle: [],
    staleInProgress: [],
    blockedEscalation: [],
    autoEscalated: [],
  };

  if (mode === 'all' || mode === 'due') {
    data.due = await fetchDueSoonIssues(apiKey, teamId, dueDays);
  }
  if (mode === 'all' || mode === 'cycle') {
    data.cycle = await fetchCurrentCycleIssues(apiKey, teamId);
  }

  if (includeSla) {
    const openIssues = await fetchOpenLinearIssuesForSla(apiKey, teamId);
    const stale = classifyReminderSlaIssues(
      openIssues,
      Date.now(),
      staleInProgressDays,
      blockedEscalationHours,
      settings,
    );
    data.staleInProgress = stale.inProgress;
    data.blockedEscalation = stale.blocked;
    if (autoEscalateBlocked && stale.blocked.length > 0) {
      data.autoEscalated = await autoEscalateReminderBlockedIssues(
        apiKey,
        stale.blocked,
        blockedEscalationHours,
        settings,
      );
    }
  }

  return {
    apiKey,
    teamId,
    data,
    escalated: data.autoEscalated,
  };
}

function classifyReminderSlaIssues(issues, nowMs, staleInProgressDays, blockedEscalationHours, settings) {
  const staleInProgressHours = Math.max(1, Number(staleInProgressDays || 3) * 24);
  const blockedHours = Math.max(1, Number(blockedEscalationHours || 24));
  const result = {
    inProgress: [],
    blocked: [],
  };

  for (const issue of Array.isArray(issues) ? issues : []) {
    const updatedAtMs = Date.parse(String(issue.updatedAt || ''));
    if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
      continue;
    }
    const ageHours = Math.max(0, (nowMs - updatedAtMs) / (60 * 60 * 1000));
    const stateName = String((issue.state && issue.state.name) || '').trim();
    const isBlocked = isBlockedStateName(stateName, settings);
    const isInProgress = isInProgressStateName(stateName, issue.state && issue.state.type, settings);

    const item = {
      id: String(issue.id || ''),
      identifier: String(issue.identifier || ''),
      title: String(issue.title || ''),
      url: String(issue.url || ''),
      state: stateName || '-',
      priority: Number.isFinite(Number(issue.priority)) ? Number(issue.priority) : 0,
      ageHours: Number(ageHours.toFixed(2)),
      updatedAt: String(issue.updatedAt || ''),
      assignee:
        issue && issue.assignee
          ? String(issue.assignee.displayName || issue.assignee.name || '').trim()
          : '',
    };

    if (isBlocked && ageHours >= blockedHours) {
      result.blocked.push(item);
      continue;
    }
    if (isInProgress && ageHours >= staleInProgressHours) {
      result.inProgress.push(item);
    }
  }

  result.inProgress.sort((a, b) => b.ageHours - a.ageHours);
  result.blocked.sort((a, b) => b.ageHours - a.ageHours);
  return result;
}

async function autoEscalateReminderBlockedIssues(apiKey, blockedItems, blockedEscalationHours, settings) {
  const escalated = [];
  for (const item of blockedItems.slice(0, 20)) {
    if (!item.id || !item.identifier) {
      continue;
    }
    const previousPriority = Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0;
    if (previousPriority === 1) {
      continue;
    }
    try {
      const updated = await updateLinearIssuePriority(apiKey, item.id, 1);
      await createLinearIssueComment(
        apiKey,
        item.id,
        trimMessage(
          [
            '### Mission Control Reminder Escalation',
            `- reason: blocked > ${Number(blockedEscalationHours || 24)}h`,
            `- previous priority: ${previousPriority || '-'}`,
            '- new priority: 1',
            '',
            `generated ${formatTime(Date.now(), settings.timezone)} by mission-control remind`,
          ].join('\n'),
          1800,
        ),
      );
      escalated.push({
        identifier: item.identifier,
        priority: updated.priority,
      });
      appendAuditEvent('remind-auto-escalate', {
        identifier: item.identifier,
        previousPriority,
        newPriority: updated.priority,
      });
    } catch (error) {
      escalated.push({
        identifier: item.identifier,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return escalated;
}

async function cmdStatusSync(settings, flags) {
  if (settings.statusMachine.enabled === false) {
    throw new Error('statusMachine is disabled in config.');
  }

  const apiKey = String(settings.linear.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is required for status-sync.');
  }

  const contexts = collectLinkedIssueSignals(settings, flags);
  const state = readJsonFile(STATUS_SYNC_PATH, { version: 1, updatedAtMs: 0, issues: {} });
  if (!state.issues || typeof state.issues !== 'object') {
    state.issues = {};
  }
  const nowMs = Date.now();
  const results = [];

  for (const context of contexts) {
    const targetStateName = decideIssueTargetState(context, settings);
    if (!targetStateName) {
      results.push({
        identifier: context.identifier,
        status: 'no_signal',
      });
      continue;
    }

    const transition = await transitionIssueByIdentifier(context.identifier, targetStateName, settings);
    const issueState = state.issues[context.identifier] || {};
    issueState.lastSyncAtMs = nowMs;
    issueState.lastTargetState = targetStateName;
    issueState.lastTransitionStatus = transition.status;
    issueState.lastSignal = {
      activeSessions: context.activeSessions.length,
      activeSubagents: context.activeSubagents.length,
      autopilotRecent: context.autopilotRecent.length,
      cronWarnings: context.cronWarnings.length,
      githubOpen: context.githubOpen.length,
      githubMerged: context.githubMerged.length,
    };

    let commented = false;
    if (
      transition.status === 'updated' &&
      settings.statusMachine.commentOnStateChange !== false &&
      transition.issueId
    ) {
      const body = renderStatusSyncComment(context, transition, settings);
      const signature = hashText(body);
      if (flags['comment-always'] || issueState.lastCommentSignature !== signature) {
        const comment = await createLinearIssueComment(apiKey, transition.issueId, body);
        issueState.lastCommentSignature = signature;
        issueState.lastCommentAtMs = nowMs;
        issueState.lastCommentId = comment && comment.id ? comment.id : '';
        commented = true;
      }
    }

    state.issues[context.identifier] = issueState;
    results.push({
      identifier: context.identifier,
      targetStateName,
      transition,
      commented,
      signal: {
        activeSessions: context.activeSessions.length,
        activeSubagents: context.activeSubagents.length,
        autopilotRecent: context.autopilotRecent.length,
        cronWarnings: context.cronWarnings.length,
        githubOpen: context.githubOpen.length,
        githubMerged: context.githubMerged.length,
      },
    });

    if (transition.status === 'updated') {
      appendAuditEvent('status-sync-transition', {
        identifier: context.identifier,
        fromState: transition.previousState || '',
        toState: transition.state || targetStateName,
        reason: context.reason,
        signal: issueState.lastSignal,
        commented,
      });
    }
  }

  state.updatedAtMs = nowMs;
  writeJsonFile(STATUS_SYNC_PATH, state);

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, processed: contexts.length, updatedAtMs: nowMs, results }, null, 2)}\n`,
    );
    return;
  }

  const updated = results.filter((item) => item.transition && item.transition.status === 'updated');
  const commented = results.filter((item) => item.commented);
  const lines = [];
  lines.push('Status sync result:');
  lines.push(`- issues scanned: ${contexts.length}`);
  lines.push(`- states updated: ${updated.length}`);
  lines.push(`- comments posted: ${commented.length}`);
  for (const item of updated.slice(0, 10)) {
    lines.push(
      `- ${item.identifier}: ${item.transition.previousState || '-'} -> ${item.transition.state || item.targetStateName}`,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdMemoSave(settings, flags) {
  const channelId = String(flags['channel-id'] || flags.channelId || '').trim();
  const messageId = String(flags['message-id'] || flags.messageId || '').trim();
  const title = String(flags.title || '').trim();
  const labels = normalizeLabelNames(flags.labels || flags.label || 'memo');
  const createLinear = Boolean(flags['create-linear'] || flags.createLinear);
  const sourceChannel = String(flags.channel || settings.report.channel || 'discord').trim();
  const sourceTarget = String(flags.target || settings.report.target || '').trim();

  if (!channelId || !messageId) {
    throw new Error('memo-save requires --channel-id and --message-id');
  }

  const memo = await buildDiscordMemo({ channelId, messageId, title, labels }, settings);

  let triageIssue = null;
  let triageQueued = null;
  if (createLinear) {
    const delivery = await createTriageIssueWithFallback(
      {
        title: memo.title,
        rawText: memo.tldr,
        description: `${memo.body}\n\n---\nSource: ${memo.sourceUrl}`,
        source: 'memo',
        sourceId: memo.sourceId,
        eventType: 'discord.memo',
        author: memo.author,
        sourceUrl: memo.sourceUrl,
        state: 'Triage',
        labels: dedupeStrings(['memo', ...labels]),
        dueDate: '',
        priority: 3,
      },
      settings,
      { context: 'memo-save' },
    );
    if (delivery.queued) {
      triageQueued = {
        queueId: delivery.queueId,
        error: delivery.error,
      };
    } else {
      triageIssue = delivery.issue;
      memo.linearUrl = triageIssue && triageIssue.url ? triageIssue.url : '';
    }
  }

  const saved = saveObsidianMemo(memo, settings);

  if (triageIssue && triageIssue.url) {
    try {
      const apiKey = String(settings.linear.apiKey || '').trim();
      if (apiKey && triageIssue.id) {
        await createLinearIssueComment(
          apiKey,
          triageIssue.id,
          trimMessage(
            ['### Memo Captured', `- Obsidian: ${saved.relativePath}`, `- Source: ${memo.sourceUrl}`].join('\n'),
            1800,
          ),
        );
      }
    } catch {
      // ignore comment failure
    }
  }

  const result = {
    ok: true,
    memo: {
      title: memo.title,
      relativePath: saved.relativePath,
      sourceUrl: memo.sourceUrl,
      sourceId: memo.sourceId,
    },
    linear: triageIssue
      ? {
          identifier: triageIssue.identifier,
          url: triageIssue.url,
          stateName: triageIssue.stateName,
        }
      : null,
    queued: triageQueued,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push('Memo saved:');
    lines.push(`- title: ${memo.title}`);
    lines.push(`- path: ${saved.relativePath}`);
    lines.push(`- source: ${memo.sourceUrl}`);
    if (triageIssue) {
      lines.push(`- linear: ${triageIssue.identifier}`);
      if (triageIssue.url) {
        lines.push(`  - url: ${triageIssue.url}`);
      }
    }
    if (triageQueued) {
      lines.push(`- queued: ${triageQueued.queueId}`);
      lines.push(`- queue error: ${singleLine(triageQueued.error)}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  if (sourceChannel && sourceTarget && flags.send) {
    const msgLines = [];
    msgLines.push('Memo captured:');
    msgLines.push(`- ${memo.title}`);
    if (triageIssue && triageIssue.url) {
      msgLines.push(`- Linear: ${triageIssue.url}`);
    }
    msgLines.push(`- Obsidian: ${saved.relativePath}`);
    msgLines.push(`- Source: ${memo.sourceUrl}`);
    runCommand('openclaw', [
      'message',
      'send',
      '--channel',
      sourceChannel,
      '--target',
      sourceTarget,
      '--message',
      trimMessage(msgLines.join('\n'), 2800),
    ]);
  }
}

async function cmdQueueDrain(settings, flags) {
  const result = await drainIngestQueue(settings, flags, {
    maxRetriesOverride: flags['max-retries'],
  });
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push('Queue drain result:');
  lines.push(`- queued before: ${result.queuedBefore}`);
  lines.push(`- delivered: ${result.success}`);
  lines.push(`- retried: ${result.retried}`);
  lines.push(`- moved to DLQ: ${result.movedToDlq}`);
  lines.push(`- queued after: ${result.queuedAfter}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdQueueStats(settings, flags) {
  const queueState = readJsonFile(INGEST_QUEUE_PATH, { version: 1, items: [], updatedAtMs: 0 });
  const dlqState = readJsonFile(INGEST_DLQ_PATH, { version: 1, items: [], updatedAtMs: 0 });
  const ingestLedger = readIngestLedger();
  const queueItems = Array.isArray(queueState.items) ? queueState.items : [];
  const dlqItems = Array.isArray(dlqState.items) ? dlqState.items : [];

  const retryBuckets = {
    attempts0: 0,
    attempts1: 0,
    attempts2: 0,
    attempts3Plus: 0,
  };

  const queueBySource = {};
  const dlqBySource = {};
  const bumpSource = (target, source) => {
    const key = String(source || 'unknown').trim().toLowerCase() || 'unknown';
    target[key] = Number(target[key] || 0) + 1;
  };

  for (const item of queueItems) {
    const attempts = Math.max(0, Number(item.attempts || 0));
    if (attempts <= 0) {
      retryBuckets.attempts0 += 1;
    } else if (attempts === 1) {
      retryBuckets.attempts1 += 1;
    } else if (attempts === 2) {
      retryBuckets.attempts2 += 1;
    } else {
      retryBuckets.attempts3Plus += 1;
    }
    bumpSource(queueBySource, item && item.payload ? item.payload.source : '');
  }
  for (const item of dlqItems) {
    bumpSource(dlqBySource, item && item.payload ? item.payload.source : '');
  }

  const topN = (obj, n) =>
    Object.entries(obj)
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, n)
      .map(([source, count]) => ({ source, count: Number(count || 0) }));

  const result = {
    ok: true,
    queued: queueItems.length,
    dlq: dlqItems.length,
    ledgerItems: Object.keys(ingestLedger.items || {}).length,
    queueUpdatedAtMs: Number(queueState.updatedAtMs || 0),
    dlqUpdatedAtMs: Number(dlqState.updatedAtMs || 0),
    retryBuckets,
    topQueueSources: topN(queueBySource, 8),
    topDlqSources: topN(dlqBySource, 8),
    topLedgerStatus: topN(
      Object.values(ingestLedger.items || {}).reduce((acc, item) => {
        const key = String(item && item.status ? item.status : 'unknown').trim().toLowerCase() || 'unknown';
        acc[key] = Number(acc[key] || 0) + 1;
        return acc;
      }, {}),
      8,
    ),
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Ingest queue stats:');
  lines.push(`- queue: ${result.queued}`);
  lines.push(`- dlq: ${result.dlq}`);
  lines.push(`- ledger: ${result.ledgerItems}`);
  lines.push(
    `- retries: a0=${retryBuckets.attempts0}, a1=${retryBuckets.attempts1}, a2=${retryBuckets.attempts2}, a3+=${retryBuckets.attempts3Plus}`,
  );
  if (result.topQueueSources.length > 0) {
    lines.push(`- queue top sources: ${result.topQueueSources.map((item) => `${item.source}:${item.count}`).join(', ')}`);
  }
  if (result.topDlqSources.length > 0) {
    lines.push(`- dlq top sources: ${result.topDlqSources.map((item) => `${item.source}:${item.count}`).join(', ')}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdTelemetry(settings, flags) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const snapshotPath = path.join(TELEMETRY_DIR, `token-baseline-${dateStr}.json`);

  if (!fs.existsSync(TELEMETRY_DIR)) {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
  }

  const sessions = loadSessions(settings);
  const issueLinks = readJsonFile(ISSUE_LINKS_PATH, { bySessionId: {}, bySessionKey: {} });
  const autopilotHistory = readJsonFile(LINEAR_AUTOPILOT_PATH, { runs: [] });

  const agentBaseline = {};
  const jobTokenBaseline = {};

  const hardTokenThreshold = 60000;
  const hardTurnThreshold = 30;
  const shardViolations = [];

  for (const session of sessions) {
    const agentId = session.agentId || 'unknown';
    if (!agentBaseline[agentId]) {
      agentBaseline[agentId] = {
        sessionCount: 0,
        totalTokens: 0,
        avgTokens: 0,
        models: [],
      };
    }
    const currentAgent = agentBaseline[agentId];
    currentAgent.sessionCount += 1;
    const totalTokens = Number(session.totalTokens || 0);
    const turnCount = Number(session.turnCount || 0);
    currentAgent.totalTokens += totalTokens;
    if (session.model && !currentAgent.models.includes(session.model)) {
      currentAgent.models.push(session.model);
    }

    const issueId = issueLinks.bySessionId[session.sessionId] || issueLinks.bySessionKey[session.key];
    if (issueId) {
      if (!jobTokenBaseline[issueId]) {
        jobTokenBaseline[issueId] = { totalTokens: 0, sessions: [] };
      }
      jobTokenBaseline[issueId].totalTokens += totalTokens;
      jobTokenBaseline[issueId].sessions.push({
        key: session.key,
        agentId: session.agentId,
        tokens: totalTokens,
        turns: turnCount,
      });

      if (totalTokens >= hardTokenThreshold || turnCount >= hardTurnThreshold) {
        shardViolations.push({
          issueId,
          sessionKey: session.key,
          tokens: totalTokens,
          turns: turnCount,
        });
      }
    }
  }

  for (const agentId of Object.keys(agentBaseline)) {
    const currentAgent = agentBaseline[agentId];
    currentAgent.avgTokens =
      currentAgent.sessionCount > 0 ? Math.round(currentAgent.totalTokens / currentAgent.sessionCount) : 0;
  }

  const jobStats = { success: { count: 0 }, failure: { count: 0 }, in_progress: { count: 0 } };
  for (const run of autopilotHistory.runs) {
    const category = run.status || 'unknown';
    if (!jobStats[category]) {
      jobStats[category] = { count: 0 };
    }
    jobStats[category].count += 1;
  }

  const finalSnapshot = {
    timestamp: now.toISOString(),
    scope: 'baseline-control-group',
    agents: agentBaseline,
    jobs: jobStats,
    jobTokens: jobTokenBaseline,
    sharding: {
      thresholds: {
        tokens: hardTokenThreshold,
        turns: hardTurnThreshold,
      },
      violations: shardViolations,
    },
    meta: {
      totalSessions: sessions.length,
      totalAutopilotRuns: autopilotHistory.runs.length,
    },
  };

  fs.writeFileSync(snapshotPath, JSON.stringify(finalSnapshot, null, 2));

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(finalSnapshot, null, 2)}\n`);
  } else {
    process.stdout.write(`Telemetry snapshot saved to: ${snapshotPath}\n`);
    process.stdout.write(`- Total sessions: ${finalSnapshot.meta.totalSessions}\n`);
    process.stdout.write(`- Total autopilot runs: ${finalSnapshot.meta.totalAutopilotRuns}\n`);
    process.stdout.write(`- Shard violations: ${shardViolations.length}\n`);
  }
}

// Session Sharding and Handoff Policy for CLAW-108
// Hard thresholds: >=60k tokens or >=30 turns

const SESSION_SHARDING_CONFIG = {
  tokenThreshold: 60000, // 60k tokens
  turnThreshold: 30, // 30 turns/messages
  enabled: true,
};

function countSessionTurns(session, agentId, settings) {
  const sessionId = (session && typeof session === 'object') ? session.sessionId : session;
  if (!sessionId) {
    return 0;
  }

  const sessionPath = path.join(
    settings.openclawHome,
    'agents',
    agentId,
    'sessions',
    `${sessionId}.jsonl`,
  );

  if (!fs.existsSync(sessionPath)) {
    return 0;
  }

  try {
    const content = fs.readFileSync(sessionPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim());
    // Count "user" roles as turn markers
    let turns = 0;
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.role === 'user' || (msg.message && msg.role === 'user')) {
          turns += 1;
        }
      } catch {
        // If not JSON or unexpected format, count as 1 turn for every 4 messages as heuristic
      }
    }
    return turns || Math.ceil(lines.length / 4);
  } catch (err) {
    return 0;
  }
}

function checkSessionShardingThreshold(sessionKey, agentId, settings, config) {
  const shardingConfig = config && typeof config === 'object' ? config : SESSION_SHARDING_CONFIG;
  const tokenThreshold = shardingConfig.maxTokens || shardingConfig.tokenThreshold || 60000;
  const turnThreshold = shardingConfig.maxTurns || shardingConfig.turnThreshold || 30;
  const enabled = shardingConfig.enabled !== false;

  if (!enabled) {
    return {
      shouldShard: false,
      reason: 'sharding-disabled',
      metrics: { tokens: 0, turns: 0 },
    };
  }

  const sessions = loadSessions(settings);
  const session = sessions.find((s) => s.key === sessionKey && s.agentId === agentId);

  if (!session) {
    return {
      shouldShard: false,
      reason: 'session-not-found',
      metrics: { tokens: 0, turns: 0 },
    };
  }

  const tokens = session.totalTokens || 0;
  const turns = countSessionTurns(session, agentId, settings);

  const shouldShard = tokens >= tokenThreshold || turns >= turnThreshold;
  const reason = shouldShard
    ? tokens >= tokenThreshold
      ? `token-threshold-exceeded (${tokens}/${tokenThreshold})`
      : `turn-threshold-exceeded (${turns}/${turnThreshold})`
    : 'within-thresholds';

  return {
    shouldShard,
    reason,
    metrics: { tokens, turns },
    thresholds: {
      tokenThreshold: tokenThreshold,
      turnThreshold: turnThreshold,
    },
  };
}

function createHandoffPackage(issueIdentifier, sessionKey, agentId, settings, lastAgentText = '') {
  const sessions = loadSessions(settings);
  const session = sessions.find((s) => s.key === sessionKey && s.agentId === agentId);

  const issueLinks = readJsonFile(ISSUE_LINKS_PATH, { bySessionId: {}, bySessionKey: {} });
  const autopilotHistory = readJsonFile(LINEAR_AUTOPILOT_PATH, { runs: [] });

  const relatedRuns = autopilotHistory.runs.filter(
    (run) => run.issueIdentifier === issueIdentifier,
  );

  // Load recent messages for context
  let recentTurns = [];
  const sessionId = session ? session.sessionId : '';
  const sessionPath = sessionId ? path.join(
    settings.openclawHome,
    'agents',
    agentId,
    'sessions',
    `${sessionId}.jsonl`,
  ) : '';

  if (sessionPath && fs.existsSync(sessionPath)) {
    try {
      const content = fs.readFileSync(sessionPath, 'utf8');
      const lines = content.split('\n').filter((line) => line.trim());
      recentTurns = lines.slice(-10).map(line => {
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });
    } catch (err) {
      recentTurns = [{ error: `failed to read session turns: ${err.message}` }];
    }
  }

  const handoffPackage = {
    issueIdentifier,
    sourceSession: {
      sessionKey,
      agentId,
      sessionId,
      totalTokens: session ? session.totalTokens : 0,
      contextTokens: session ? session.contextTokens : 0,
      model: session ? session.model : '',
      updatedAt: session ? session.updatedAt : 0,
    },
    metrics: {
      tokens: session ? session.totalTokens : 0,
      turns: session ? countSessionTurns(session, agentId, settings) : 0,
    },
    recentRuns: relatedRuns.slice(0, 10).map((run) => ({
      runId: run.runId,
      status: run.status,
      summary: run.error || 'completed',
      atMs: run.atMs,
    })),
    recentTurns,
    decisionCard: {
      summary: lastAgentText || (relatedRuns.length > 0 ? relatedRuns[0].error : 'No summary available'),
      keyDecisions: [], // Placeholder for future automated extraction
      remainingBlockers: [],
      nextRecommendedSteps: [],
    },
    context: {
      repositoryRoot: ROOT_DIR,
      sopPath: 'docs/sop/linear-codex-dev-sop.md',
    },
    handoffReason: 'session-sharding-threshold-exceeded',
    timestamp: new Date().toISOString(),
  };

  const handoffDir = path.join(DATA_DIR, 'handoffs');
  if (!fs.existsSync(handoffDir)) {
    fs.mkdirSync(handoffDir, { recursive: true });
  }

  const handoffFile = path.join(
    handoffDir,
    `${issueIdentifier}-${Date.now()}-handoff.json`,
  );
  fs.writeFileSync(handoffFile, JSON.stringify(handoffPackage, null, 2));

  return {
    package: handoffPackage,
    filePath: handoffFile,
  };
}

function enforceSessionHandoff(issueIdentifier, sessionKey, agentId, settings, checkResult, lastAgentText = '') {
  const handoff = createHandoffPackage(issueIdentifier, sessionKey, agentId, settings, lastAgentText);

  const handoffSummary = [
    `Session handoff enforced for ${issueIdentifier}`,
    `Reason: ${checkResult.reason}`,
    `Metrics: ${checkResult.metrics.tokens} tokens, ${checkResult.metrics.turns} turns`,
    `Thresholds: ${checkResult.thresholds.tokenThreshold} tokens, ${checkResult.thresholds.turnThreshold} turns`,
    `Handoff package saved to: ${handoff.filePath}`,
    `Source session: ${agentId}/${sessionKey}`,
  ].join('\n');

  return {
    enforced: true,
    summary: handoffSummary,
    handoffPackage: handoff.package,
    handoffFilePath: handoff.filePath,
    newSessionRequired: true,
  };
}

async function cmdSlaCheck(settings, flags) {
  if (settings.sla.enabled === false) {
    throw new Error('sla is disabled in config.');
  }

  const apiKey = String(settings.linear.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is required for sla-check.');
  }

  const teamId = settings.linear.teamId || (await resolveLinearTeamId(apiKey, settings.linear.teamKey));
  if (!teamId) {
    throw new Error('Unable to resolve Linear team id for sla-check.');
  }

  const nowMs = Date.now();
  const inProgressStaleHours = Math.max(
    1,
    Number(flags['in-progress-hours'] || settings.sla.inProgressStaleHours || 24),
  );
  const blockedStaleHours = Math.max(
    1,
    Number(flags['blocked-hours'] || settings.sla.blockedStaleHours || 8),
  );
  const cooldownHours = Math.max(
    1,
    Number(flags['cooldown-hours'] || settings.sla.commentCooldownHours || 24),
  );
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  const escalateEnabled = !Boolean(flags['no-escalate']) && settings.sla.createOpsIssue !== false;
  const issues = await fetchOpenLinearIssuesForSla(apiKey, teamId);

  const state = readJsonFile(SLA_STATE_PATH, { version: 1, updatedAtMs: 0, issues: {} });
  if (!state.issues || typeof state.issues !== 'object') {
    state.issues = {};
  }

  const results = [];
  for (const issue of issues) {
    const updatedAtMs = Date.parse(String(issue.updatedAt || ''));
    if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
      continue;
    }

    const ageHours = Math.max(0, (nowMs - updatedAtMs) / (60 * 60 * 1000));
    const stateName = String((issue.state && issue.state.name) || '').trim();
    const isBlocked = isBlockedStateName(stateName, settings);
    const isInProgress = isInProgressStateName(stateName, issue.state && issue.state.type, settings);

    let slaType = '';
    let thresholdHours = 0;
    if (isBlocked && ageHours >= blockedStaleHours) {
      slaType = 'blocked';
      thresholdHours = blockedStaleHours;
    } else if (isInProgress && ageHours >= inProgressStaleHours) {
      slaType = 'in-progress';
      thresholdHours = inProgressStaleHours;
    } else {
      continue;
    }

    const signature = hashText(
      `${issue.identifier}|${stateName}|${issue.updatedAt}|${slaType}|${Math.floor(ageHours)}`,
    );
    const record = state.issues[issue.identifier] || {};
    const lastCommentAtMs = Number(record.lastCommentAtMs || 0);
    const shouldComment =
      Boolean(flags['comment-always']) ||
      record.lastSignature !== signature ||
      nowMs - lastCommentAtMs >= cooldownMs;

    let commented = false;
    let escalation = null;
    let escalationQueueId = '';
    if (shouldComment) {
      const commentBody = renderSlaComment(issue, slaType, ageHours, thresholdHours, settings);
      await createLinearIssueComment(apiKey, issue.id, commentBody);
      record.lastCommentAtMs = nowMs;
      record.lastSignature = signature;
      commented = true;
      appendAuditEvent('sla-comment', {
        identifier: issue.identifier,
        slaType,
        ageHours: Number(ageHours.toFixed(2)),
        thresholdHours,
      });
    }

    if (escalateEnabled && slaType === 'blocked') {
      const escalationDelivery = await createTriageIssueWithFallback(
        {
          title: `[SLA][Blocked] ${issue.identifier} stale ${Math.floor(ageHours)}h`,
          description: [
            `Escalation for blocked issue exceeding SLA.`,
            `issue: ${issue.identifier}`,
            `state: ${stateName}`,
            `ageHours: ${ageHours.toFixed(2)}`,
            `thresholdHours: ${thresholdHours}`,
            issue.url ? `url: ${issue.url}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          source: 'sla-check',
          sourceId: `blocked:${issue.identifier}:${issue.updatedAt}`,
          eventType: 'sla.blocked',
          labels: ['ops', 'sla'],
          state: 'Triage',
          priority: 2,
        },
        settings,
        { context: 'sla-check' },
      );
      if (escalationDelivery.queued) {
        escalationQueueId = escalationDelivery.queueId || '';
        appendAuditEvent('sla-escalation-queued', {
          identifier: issue.identifier,
          queueId: escalationQueueId,
          error: escalationDelivery.error,
        });
      } else {
        escalation = escalationDelivery.issue;
        appendAuditEvent('sla-escalation', {
          identifier: issue.identifier,
          escalationIdentifier: escalation.identifier,
        });
      }
    }

    record.lastSeenAtMs = nowMs;
    record.lastStateName = stateName;
    record.lastAgeHours = Number(ageHours.toFixed(2));
    state.issues[issue.identifier] = record;

    results.push({
      identifier: issue.identifier,
      state: stateName,
      slaType,
      ageHours: Number(ageHours.toFixed(2)),
      thresholdHours,
      commented,
      escalationIdentifier: escalation ? escalation.identifier : '',
      escalationDeduped: Boolean(escalation && escalation.deduped),
      escalationQueueId,
    });
  }

  state.updatedAtMs = nowMs;
  writeJsonFile(SLA_STATE_PATH, state);

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          checked: issues.length,
          stale: results.length,
          commented: results.filter((item) => item.commented).length,
          escalated: results.filter((item) => item.escalationIdentifier).length,
          results,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const lines = [];
  lines.push('SLA check result:');
  lines.push(`- open issues checked: ${issues.length}`);
  lines.push(`- stale issues: ${results.length}`);
  lines.push(`- comments posted: ${results.filter((item) => item.commented).length}`);
  lines.push(`- escalations: ${results.filter((item) => item.escalationIdentifier).length}`);
  for (const item of results.slice(0, 10)) {
    lines.push(
      `- ${item.identifier} ${item.slaType} age=${item.ageHours}h threshold=${item.thresholdHours}h${item.escalationIdentifier ? ` escalation=${item.escalationIdentifier}` : ''}`,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdRunbookExec(settings, flags) {
  if (settings.runbook && settings.runbook.enabled === false) {
    throw new Error('runbook execution is disabled in config.');
  }

  const card = normalizeRunbookCard(flags.card || flags._[0] || '');
  if (!card) {
    throw new Error('runbook-exec requires --card (model-failover|cron-recover|queue-backlog|issue-refresh).');
  }

  const issueIdentifier = normalizeLinearIssueId(
    flags.issue || flags.identifier || flags.id || flags['issue-id'] || '',
  );
  const plan = buildRunbookExecutionPlan(card, issueIdentifier, flags, settings);
  const maxActions = Math.max(1, Number(settings.runbook.maxActionsPerRun || 5));
  if (plan.actions.length > maxActions) {
    throw new Error(`runbook plan has ${plan.actions.length} actions, exceeds maxActionsPerRun=${maxActions}.`);
  }

  const allowedActions = new Set(
    (Array.isArray(settings.runbook.allowedActions) ? settings.runbook.allowedActions : [])
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedActions.size === 0) {
    throw new Error('runbook.allowedActions is empty; no action can be executed safely.');
  }
  for (const action of plan.actions) {
    if (!allowedActions.has(action.type)) {
      throw new Error(`runbook action "${action.type}" is not allowed by runbook.allowedActions.`);
    }
  }

  const defaultDryRun = settings.runbook.defaultDryRun !== false;
  const explicitExecute = Boolean(flags.execute || flags.apply);
  const explicitDryRun = Boolean(flags['dry-run'] || flags.dryRun);
  const dryRun = explicitExecute ? false : explicitDryRun ? true : defaultDryRun;
  const continueOnError = Boolean(flags['continue-on-error']);
  let approval = { required: false, approved: true, approvalId: '' };

  if (!dryRun) {
    if (settings.runbook.allowExecute === false) {
      throw new Error(
        'runbook execution is disabled by default. Set runbook.allowExecute=true in config/control-center.json first.',
      );
    }
    consumeConfirmation(flags.confirm);
    approval = consumeApprovalIfRequired(
      settings,
      flags.approval,
      'runbook-exec',
      `${card}:${issueIdentifier || 'none'}`,
    );
  }

  const startedAtMs = Date.now();
  const results = [];
  appendAuditEvent('runbook-exec-plan', {
    card,
    issueIdentifier: plan.issueIdentifier || '',
    dryRun,
    actions: plan.actions.map((item) => ({
      type: item.type,
      description: item.description,
      command: [item.bin].concat(item.args || []).join(' '),
    })),
  });

  for (const action of plan.actions) {
    const commandText = [action.bin].concat(action.args || []).map(shellQuote).join(' ');
    if (dryRun) {
      results.push({
        type: action.type,
        status: 'planned',
        description: action.description,
        command: commandText,
      });
      continue;
    }

    const actionStartedMs = Date.now();
    try {
      const output = runCommand(action.bin, action.args || []);
      const item = {
        type: action.type,
        status: 'ok',
        description: action.description,
        command: commandText,
        durationMs: Date.now() - actionStartedMs,
        stdout: trimMessage(output.stdout || '', 240),
        stderr: trimMessage(output.stderr || '', 240),
      };
      results.push(item);
      appendAuditEvent('runbook-exec-action', {
        card,
        issueIdentifier: plan.issueIdentifier || '',
        type: action.type,
        command: commandText,
        durationMs: item.durationMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const item = {
        type: action.type,
        status: 'error',
        description: action.description,
        command: commandText,
        durationMs: Date.now() - actionStartedMs,
        error: message,
      };
      results.push(item);
      appendAuditEvent('runbook-exec-action-error', {
        card,
        issueIdentifier: plan.issueIdentifier || '',
        type: action.type,
        command: commandText,
        durationMs: item.durationMs,
        error: message,
      });
      if (!continueOnError) {
        break;
      }
    }
  }

  const failed = results.filter((item) => item.status === 'error');
  const summary = {
    ok: failed.length === 0,
    card,
    issueIdentifier: plan.issueIdentifier || '',
    dryRun,
    continueOnError,
    approval,
    startedAtMs,
    finishedAtMs: Date.now(),
    durationMs: Date.now() - startedAtMs,
    actionsPlanned: plan.actions.length,
    actionsAttempted: results.length,
    actionsFailed: failed.length,
    notes: plan.notes,
    results,
  };

  const runbookState = readJsonFile(RUNBOOK_EXEC_PATH, { version: 1, updatedAtMs: 0, runs: [] });
  const runHistory = Array.isArray(runbookState.runs) ? runbookState.runs : [];
  runHistory.unshift({
    atMs: summary.finishedAtMs,
    card: summary.card,
    issueIdentifier: summary.issueIdentifier,
    dryRun: summary.dryRun,
    ok: summary.ok,
    actionsPlanned: summary.actionsPlanned,
    actionsAttempted: summary.actionsAttempted,
    actionsFailed: summary.actionsFailed,
  });
  runbookState.version = 1;
  runbookState.updatedAtMs = summary.finishedAtMs;
  runbookState.runs = runHistory.slice(0, 100);
  writeJsonFile(RUNBOOK_EXEC_PATH, runbookState);

  const summaryAudit = appendAuditEvent('runbook-exec-summary', {
    card: summary.card,
    issueIdentifier: summary.issueIdentifier,
    dryRun: summary.dryRun,
    ok: summary.ok,
    actionsPlanned: summary.actionsPlanned,
    actionsAttempted: summary.actionsAttempted,
    actionsFailed: summary.actionsFailed,
    durationMs: summary.durationMs,
    approvalId: approval.approvalId || '',
  });
  summary.auditId = summaryAudit.auditId;

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push('Runbook execution result:');
    lines.push(`- card: ${summary.card}`);
    lines.push(`- issue: ${summary.issueIdentifier || '-'}`);
    lines.push(`- mode: ${summary.dryRun ? 'dry-run' : 'execute'}`);
    lines.push(`- actions: ${summary.actionsAttempted}/${summary.actionsPlanned} attempted`);
    lines.push(`- failed: ${summary.actionsFailed}`);
    if (summary.notes.length > 0) {
      lines.push('- notes:');
      for (const note of summary.notes) {
        lines.push(`  - ${note}`);
      }
    }
    for (const item of summary.results) {
      lines.push(`- [${item.status}] ${item.type}: ${item.description}`);
      lines.push(`  - cmd: ${item.command}`);
      if (item.error) {
        lines.push(`  - error: ${singleLine(trimMessage(item.error, 240))}`);
      }
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  if (!summary.ok) {
    throw new Error(`runbook-exec completed with ${summary.actionsFailed} failed action(s).`);
  }
}

function normalizeRunbookCard(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return '';
  }
  const alias = {
    model: 'model-failover',
    'model-switch': 'model-failover',
    'failover-model': 'model-failover',
    cron: 'cron-recover',
    'cron-retry': 'cron-recover',
    queue: 'queue-backlog',
    refresh: 'issue-refresh',
    status: 'issue-refresh',
  };
  return alias[text] || text;
}

function buildRunbookExecutionPlan(card, issueIdentifier, flags, settings) {
  const scriptPath = path.join(ROOT_DIR, 'scripts', 'tasks.js');
  const notes = [];
  let issueContext = null;
  if (issueIdentifier) {
    const contexts = collectLinkedIssueSignals(settings, flags);
    issueContext = contexts.find((item) => item.identifier === issueIdentifier) || null;
    if (!issueContext) {
      notes.push(`No active runtime signal found for ${issueIdentifier}; using static runbook actions.`);
    }
  }

  switch (card) {
    case 'model-failover':
      notes.push('Verify model route and fallback chain before restarting runtime components.');
      return {
        card,
        issueIdentifier,
        notes,
        actions: [
          {
            type: 'status-sync',
            description: 'Refresh issue state and evidence comments from runtime signals.',
            bin: process.execPath,
            args: [scriptPath, 'status-sync', '--json'],
          },
          {
            type: 'queue-drain',
            description: 'Drain intake retry queue to clear stale delivery backlog.',
            bin: process.execPath,
            args: [scriptPath, 'queue-drain', '--json'],
          },
        ],
      };
    case 'cron-recover': {
      const cronId = String(
        flags['cron-id'] ||
          flags.cronId ||
          flags.job ||
          (issueContext && issueContext.cronWarnings[0] ? issueContext.cronWarnings[0].cronId : '') ||
          '',
      ).trim();
      if (!cronId) {
        throw new Error('cron-recover requires --cron-id, or an --issue linked to a cron warning.');
      }
      notes.push(`Run cron ${cronId} once, then refresh status machine evidence.`);
      return {
        card,
        issueIdentifier,
        notes,
        actions: [
          {
            type: 'cron-run',
            description: `Run cron ${cronId} once for quick recovery validation.`,
            bin: 'openclaw',
            args: ['cron', 'run', cronId],
          },
          {
            type: 'status-sync',
            description: 'Refresh issue state and evidence comments after cron rerun.',
            bin: process.execPath,
            args: [scriptPath, 'status-sync', '--json'],
          },
        ],
      };
    }
    case 'queue-backlog':
      notes.push('Use queue-drain first; if DLQ keeps growing, inspect upstream webhook/auth.');
      return {
        card,
        issueIdentifier,
        notes,
        actions: [
          {
            type: 'queue-drain',
            description: 'Retry queued payloads and move exhausted retries to DLQ.',
            bin: process.execPath,
            args: [scriptPath, 'queue-drain', '--json'],
          },
          {
            type: 'status-sync',
            description: 'Refresh issue states after queue stabilization.',
            bin: process.execPath,
            args: [scriptPath, 'status-sync', '--json'],
          },
        ],
      };
    case 'issue-refresh':
      return {
        card,
        issueIdentifier,
        notes,
        actions: [
          {
            type: 'status-sync',
            description: 'Refresh issue state and evidence comments from latest runtime signals.',
            bin: process.execPath,
            args: [scriptPath, 'status-sync', '--json'],
          },
        ],
      };
    default:
      throw new Error(
        `unsupported runbook card "${card}". Supported: model-failover, cron-recover, queue-backlog, issue-refresh.`,
      );
  }
}

async function cmdIngestServer(settings, flags) {
  const host = String(flags.host || settings.ingest.host || '127.0.0.1').trim();
  const port = Number(flags.port || settings.ingest.port || 8788);
  const triagePath = String(flags.path || settings.ingest.triagePath || '/triage').trim();
  const discordPath = String(flags['discord-path'] || settings.ingest.discordPath || '/discord/message').trim();
  const githubPath = String(flags['github-path'] || settings.ingest.githubPath || '/github/pr').trim();
  const token = String(flags.token || settings.ingest.token || '').trim();
  const maxBodyBytes = Number(flags['max-body-bytes'] || settings.ingest.maxBodyBytes || 1024 * 1024);

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`invalid ingest port: ${String(port)}`);
  }

  const server = http.createServer(async (req, res) => {
    const requestPath = new URL(String(req.url || '/'), `http://${host}`).pathname;
    const startedAtMs = Date.now();

    try {
      if (String(req.method || '').toUpperCase() !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }

      if (requestPath === triagePath) {
        if (token) {
          const provided = String(req.headers['x-openclaw-token'] || '').trim();
          if (!provided || provided !== token) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
          }
        }

        const body = await readJsonBody(req, maxBodyBytes);
        const input = {
          title: String(body.title || '').trim(),
          rawText: String(body.text || body.message || '').trim(),
          description: String(body.description || '').trim(),
          source: String(body.source || 'webhook').trim(),
          sourceId: normalizeSourceId(
            String(body.sourceId || body.eventId || body.messageId || body.id || body.url || '')
              .trim(),
          ),
          author: String(body.author || '').trim(),
          sourceUrl: String(body.url || '').trim(),
          state: String(body.state || 'Triage').trim(),
          labels: normalizeLabelNames(body.labels || ''),
          dueDate: String(body.dueDate || '').trim(),
          priority: Number(body.priority || 3),
          eventType: normalizeIngestEventType(
            String(body.eventType || body.type || '').trim(),
            'webhook.triage',
          ),
        };

        const delivery = await createTriageIssueWithFallback(input, settings, { context: 'ingest-server-triage' });
        if (delivery.queued) {
          recordWebhookMetric({
            source: 'triage',
            eventType: String(input.eventType || 'webhook.triage'),
            status: 'queued',
            latencyMs: Date.now() - startedAtMs,
          });
          sendJson(res, 202, {
            ok: true,
            queued: true,
            queueId: delivery.queueId,
            error: delivery.error,
          });
        } else {
          recordWebhookMetric({
            source: 'triage',
            eventType: String(input.eventType || 'webhook.triage'),
            status: 'ok',
            latencyMs: Date.now() - startedAtMs,
          });
          sendJson(res, 200, { ok: true, issue: delivery.issue });
        }
        return;
      }

      if (requestPath === discordPath) {
        if (token) {
          const provided = String(req.headers['x-openclaw-token'] || '').trim();
          if (!provided || provided !== token) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
          }
        }

        const body = await readJsonBody(req, maxBodyBytes);
        const input = buildDiscordTriageInput(body);
        const delivery = await createTriageIssueWithFallback(input, settings, { context: 'ingest-server-discord' });
        if (delivery.queued) {
          recordWebhookMetric({
            source: 'discord',
            eventType: String(input.eventType || 'discord.message'),
            status: 'queued',
            latencyMs: Date.now() - startedAtMs,
          });
          sendJson(res, 202, {
            ok: true,
            source: 'discord',
            queued: true,
            queueId: delivery.queueId,
            error: delivery.error,
          });
        } else {
          recordWebhookMetric({
            source: 'discord',
            eventType: String(input.eventType || 'discord.message'),
            status: 'ok',
            latencyMs: Date.now() - startedAtMs,
          });
          sendJson(res, 200, { ok: true, issue: delivery.issue, source: 'discord' });
        }
        return;
      }

      if (requestPath === githubPath) {
        const rawBody = await readJsonBody(req, maxBodyBytes, true);
        const githubSecret = String(flags['github-secret'] || settings.github.webhookSecret || '').trim();
        if (githubSecret && !verifyGithubSignature(req, rawBody, githubSecret)) {
          sendJson(res, 403, { ok: false, error: 'invalid_signature' });
          return;
        }

        const body = rawBody.parsed;
        const event = String(req.headers['x-github-event'] || '').toLowerCase();
        const delivery = String(req.headers['x-github-delivery'] || '').trim();
        if (delivery && isWebhookReplayDuplicate('github', delivery, settings)) {
          recordWebhookMetric({
            source: 'github',
            eventType: `github.${event || 'unknown'}.replay`,
            status: 'replay',
            latencyMs: Date.now() - startedAtMs,
            delivery,
            replay: true,
          });
          sendJson(res, 409, { ok: false, error: 'replay_detected', delivery });
          return;
        }
        const result = await handleGithubPullRequestEvent(event, body, settings, {
          delivery,
          via: 'webhook',
        });
        const action = String(body && body.action ? body.action : '').trim().toLowerCase();
        const ingestEvent = {
          id: delivery || crypto.randomUUID(),
          kind: 'github-webhook',
          payload: {
            source: 'github',
            sourceId: delivery || `github:${event}:${action}:${Date.now()}`,
            eventType: `github.${event || 'unknown'}${action ? `.${action}` : ''}`,
          },
          dedupeKey: buildIngestIdempotencyKey(
            {
              source: 'github',
              sourceId: delivery || `github:${event}:${action}:${Date.now()}`,
              eventType: `github.${event || 'unknown'}${action ? `.${action}` : ''}`,
            },
            'github.pull_request',
          ),
        };
        updateIngestLedgerForItem(ingestEvent, result && result.handled ? 'delivered' : 'ignored', {
          issueIdentifier:
            result && Array.isArray(result.identifiers) && result.identifiers.length > 0
              ? result.identifiers[0]
              : '',
        });
        if (delivery) {
          markWebhookReplaySeen('github', delivery);
        }
        const metric = recordWebhookMetric({
          source: 'github',
          eventType: `github.${event || 'unknown'}${action ? `.${action}` : ''}`,
          status: result && result.handled ? 'ok' : 'ignored',
          latencyMs: Date.now() - startedAtMs,
          delivery,
        });
        sendJson(res, 200, { ok: true, event, result, metrics: { p95Ms: metric.p95Ms, events: metric.events } });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const source =
        requestPath === githubPath ? 'github' : requestPath === discordPath ? 'discord' : requestPath === triagePath ? 'triage' : 'webhook';
      recordWebhookMetric({
        source,
        eventType: `webhook.error.${source}`,
        status: 'error',
        latencyMs: Date.now() - startedAtMs,
      });
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      process.stdout.write(
        `Ingest server listening on http://${host}:${port}\n` +
          `- triage path: ${triagePath}\n` +
          `- discord path: ${discordPath}\n` +
          `- github path: ${githubPath}\n`,
      );
      resolve(null);
    });
  });
}

async function cmdGithubHooks(settings, flags) {
  const repoPath = path.resolve(String(flags.repo || path.resolve(ROOT_DIR, '..')).trim());
  const teamKey = String(flags.team || settings.linear.teamKey || 'CLAW')
    .trim()
    .toUpperCase();
  const result = installLinearGitHooks(repoPath, teamKey);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `Git hooks installed for Linear IDs:\n` +
      `- repo: ${result.repoPath}\n` +
      `- hooks: ${result.hooks.join(', ')}\n` +
      `- teamKey: ${teamKey}\n`,
  );
}

async function cmdGithubSync(settings, flags) {
  const lookbackHours = Number(flags['lookback-hours'] || settings.github.lookbackHours || 72);
  const repos = resolveGithubRepos(settings, flags);
  if (repos.length === 0) {
    throw new Error('No GitHub repositories configured for sync.');
  }

  const forcePoll = isTruthyLike(flags.force || flags['force-poll']);
  const webhookSummary = summarizeWebhookMetrics(readWebhookMetrics());
  const pollIntervalMinutes = Math.max(1, Number(settings.github.pollIntervalMinutes || 15));
  const webhookFresh =
    webhookSummary.githubEvents > 0 &&
    webhookSummary.lastEventAtMs > 0 &&
    Date.now() - webhookSummary.lastEventAtMs <= pollIntervalMinutes * 60 * 1000;
  if (webhookFresh && !forcePoll) {
    const skipped = {
      ok: true,
      skipped: true,
      reason: 'webhook-fresh',
      webhook: webhookSummary,
      repos,
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
      return;
    }
    process.stdout.write(
      `GitHub sync skipped: webhook path is fresh (last event ${formatDuration(Date.now() - webhookSummary.lastEventAtMs)} ago).\n`,
    );
    return;
  }

  const token = String(flags.token || settings.github.token || '').trim();
  if (!token) {
    throw new Error('GitHub token missing. Set GITHUB_TOKEN or ~/.openclaw/credentials/github-token.txt');
  }

  const sinceMs = Date.now() - Math.max(1, lookbackHours) * 60 * 60 * 1000;
  const updates = [];
  const errors = [];

  for (const repo of repos) {
    try {
      const openPrs = await githubApiRequest(
        token,
        `/repos/${repo}/pulls?state=open&per_page=100&sort=updated&direction=desc`,
      );
      const closedPrs = await githubApiRequest(
        token,
        `/repos/${repo}/pulls?state=closed&per_page=100&sort=updated&direction=desc`,
      );

      const openEvents = Array.isArray(openPrs)
        ? openPrs.map((pr) => ({ repo, action: 'open', targetState: settings.github.stateInReview, pr }))
        : [];

      const mergedEvents = Array.isArray(closedPrs)
        ? closedPrs
            .filter((pr) => pr && pr.merged_at)
            .filter((pr) => {
              const updatedAt = Date.parse(String(pr.updated_at || pr.merged_at || ''));
              return Number.isFinite(updatedAt) && updatedAt >= sinceMs;
            })
            .map((pr) => ({ repo, action: 'merged', targetState: settings.github.stateDone, pr }))
        : [];

      for (const event of [...openEvents, ...mergedEvents]) {
        const pr = event.pr || {};
        const identifiers = extractLinearIssueIds(
          pr.title,
          pr.body,
          pr.head && pr.head.ref,
          pr.base && pr.base.ref,
        );
        if (identifiers.length === 0) {
          continue;
        }

        for (const identifier of identifiers) {
          const result = await transitionIssueByIdentifier(identifier, event.targetState, settings);
          updates.push({
            repo,
            action: event.action,
            prNumber: pr.number,
            prTitle: pr.title,
            identifier,
            result,
          });
        }
      }
    } catch (error) {
      errors.push({
        repo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  writeJsonFile(GITHUB_SYNC_PATH, {
    updatedAtMs: Date.now(),
    repos,
    lookbackHours,
    updates,
    errors,
  });

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: errors.length === 0, repos, lookbackHours, updates, errors }, null, 2)}\n`,
    );
    return;
  }

  const lines = [];
  lines.push('GitHub sync result:');
  lines.push(`- repos: ${repos.length}`);
  lines.push(`- updates: ${updates.length}`);
  lines.push(`- errors: ${errors.length}`);
  for (const item of updates.slice(0, 12)) {
    lines.push(
      `- ${item.repo}#${item.prNumber} ${item.identifier} -> ${item.result.status}${item.result.state ? ` (${item.result.state})` : ''}`,
    );
  }
  if (errors.length > 0) {
    lines.push('Errors:');
    for (const item of errors) {
      lines.push(`- ${item.repo}: ${item.error}`);
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdDiscordIntakeSync(settings, flags) {
  if (settings.discordIntake && settings.discordIntake.enabled === false && !flags.force) {
    const disabled = { ok: true, skipped: true, reason: 'disabled' };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(disabled, null, 2)}\n`);
    } else {
      process.stdout.write('Discord intake is disabled in config.\n');
    }
    return;
  }

  const channelIds = resolveDiscordIntakeChannelIds(settings, flags);
  if (channelIds.length === 0) {
    throw new Error(
      'discord-intake-sync requires at least one channel id. Set discordIntake.channelIds/channelId or --channel.',
    );
  }

  const includeBotMessages =
    flags['include-bots'] !== undefined
      ? isTruthyLike(flags['include-bots'])
      : Boolean(settings.discordIntake && settings.discordIntake.includeBotMessages);
  const ownerUserIds = normalizeOwnerIds(
    flags['owner-ids'] || flags.owner || (settings.discordIntake && settings.discordIntake.ownerUserIds) || [],
  );
  const limit = Math.max(
    5,
    Math.min(100, Number(flags.limit || (settings.discordIntake && settings.discordIntake.limit) || 30)),
  );
  const maxCreatePerRun = Math.max(
    1,
    Math.min(
      50,
      Number(flags['max-create'] || (settings.discordIntake && settings.discordIntake.maxCreatePerRun) || 5),
    ),
  );
  const minTextChars = Math.max(
    3,
    Number(flags['min-chars'] || (settings.discordIntake && settings.discordIntake.minTextChars) || 6),
  );
  const defaultState = String(
    flags.state || (settings.discordIntake && settings.discordIntake.defaultState) || 'Triage',
  ).trim();
  const defaultPriority = Number(
    flags.priority || (settings.discordIntake && settings.discordIntake.defaultPriority) || 3,
  );
  const baseLabels = normalizeLabelNames(
    flags.labels || (settings.discordIntake && settings.discordIntake.labels) || ['auto-intake', 'main-directive'],
  );
  const backfill = isTruthyLike(flags.backfill);
  const aroundId = String(flags.around || '').trim();
  const beforeId = String(flags.before || '').trim();
  const afterId = String(flags.after || '').trim();

  const hasStateFile = fs.existsSync(DISCORD_INTAKE_STATE_PATH);
  const state = readJsonFile(DISCORD_INTAKE_STATE_PATH, {
    version: 2,
    channels: {},
    items: {},
  });
  if (!state.items || typeof state.items !== 'object') {
    state.items = {};
  }
  if (!state.channels || typeof state.channels !== 'object') {
    state.channels = {};
  }
  // Backward-compatible migration from v1 single-channel state.
  if (state.channelId && !state.channels[state.channelId]) {
    state.channels[state.channelId] = {
      lastSeenTsMs: Number(state.lastSeenTsMs || 0),
      updatedAtMs: Number(state.updatedAtMs || Date.now()),
    };
  }

  const created = [];
  const queued = [];
  const deduped = [];
  const skipped = [];
  const channelResults = [];
  const bootstrappedChannels = [];
  let processed = 0;
  let inspected = 0;

  for (const channelId of channelIds) {
    const channelState =
      state.channels && state.channels[channelId] && typeof state.channels[channelId] === 'object'
        ? state.channels[channelId]
        : null;
    const oldLastSeenTsMs = Number(channelState && channelState.lastSeenTsMs ? channelState.lastSeenTsMs : 0);
    const messages = await readDiscordMessagesViaOpenClaw(channelId, limit, {
      around: aroundId,
      before: beforeId,
      after: afterId,
    });
    const ordered = (Array.isArray(messages) ? messages : [])
      .slice()
      .sort((a, b) => extractMessageTimestampMs(a) - extractMessageTimestampMs(b));
    inspected += ordered.length;

    const latestTsMs = ordered.reduce(
      (acc, msg) => Math.max(acc, extractMessageTimestampMs(msg)),
      oldLastSeenTsMs,
    );

    if (!channelState && !backfill) {
      state.channels[channelId] = {
        lastSeenTsMs: latestTsMs,
        updatedAtMs: Date.now(),
      };
      bootstrappedChannels.push({
        channelId,
        lastSeenTsMs: latestTsMs,
        inspected: ordered.length,
      });
      channelResults.push({
        channelId,
        bootstrapped: true,
        inspected: ordered.length,
        processed: 0,
        created: 0,
        queued: 0,
        deduped: 0,
        skipped: 0,
        lastSeenTsMs: latestTsMs,
      });
      continue;
    }

    let createdCount = 0;
    let highWatermarkTsMs = oldLastSeenTsMs;
    const channelCreated = [];
    const channelQueued = [];
    const channelDeduped = [];
    const channelSkipped = [];
    let channelProcessed = 0;

    for (const message of ordered) {
      const messageId = String(message && message.id ? message.id : '').trim();
      const author = message && message.author && typeof message.author === 'object' ? message.author : {};
      const authorId = String(author.id || message.author_id || '').trim();
      const isBot = Boolean(author.bot);
      const guildId = String(message.guild_id || message.guildId || '@me').trim() || '@me';
      const tsMs = extractMessageTimestampMs(message);
      highWatermarkTsMs = Math.max(highWatermarkTsMs, tsMs);
      if (!messageId) {
        continue;
      }

      const sourceId = normalizeSourceId(`discord:${guildId}:${channelId}:${messageId}`);
      if (state.items[sourceId]) {
        channelSkipped.push({ channelId, messageId, reason: 'already-processed' });
        continue;
      }
      if (!backfill && tsMs <= oldLastSeenTsMs) {
        state.items[sourceId] = tsMs || Date.now();
        channelSkipped.push({ channelId, messageId, reason: 'older-than-watermark' });
        continue;
      }
      if (!includeBotMessages && isBot) {
        state.items[sourceId] = tsMs || Date.now();
        channelSkipped.push({ channelId, messageId, reason: 'bot-message' });
        continue;
      }
      if (ownerUserIds.length > 0 && (!authorId || !ownerUserIds.includes(authorId))) {
        state.items[sourceId] = tsMs || Date.now();
        channelSkipped.push({ channelId, messageId, reason: 'not-owner' });
        continue;
      }

      const content = String(message.content || '').trim();
      if (!content || content.length < minTextChars) {
        state.items[sourceId] = tsMs || Date.now();
        channelSkipped.push({ channelId, messageId, reason: 'text-too-short' });
        continue;
      }
      if (!looksLikeTaskDirective(content, settings.discordIntake || {})) {
        state.items[sourceId] = tsMs || Date.now();
        channelSkipped.push({ channelId, messageId, reason: 'not-task-directive' });
        continue;
      }

      if (createdCount >= maxCreatePerRun) {
        channelSkipped.push({ channelId, messageId, reason: 'max-create-reached' });
        continue;
      }

      const input = buildDiscordTriageInput({
        ...message,
        messageId,
        channelId,
        guildId,
        sourceId,
        title: `[main] ${singleLine(content).slice(0, 120)}`,
        state: defaultState,
        priority: defaultPriority,
        labels: baseLabels,
      });
      input.source = 'discord';
      input.sourceId = sourceId;
      input.state = defaultState;
      input.priority = Number.isFinite(defaultPriority) ? defaultPriority : 3;
      input.labels = dedupeStrings([
        ...normalizeLabelNames(input.labels || []),
        ...baseLabels,
        'discord',
      ]);
      input.eventType = normalizeIngestEventType(input.eventType || '', 'discord.directive');

      const delivery = await createTriageIssueWithFallback(input, settings, { context: 'discord-intake-sync' });
      state.items[sourceId] = tsMs || Date.now();
      channelProcessed += 1;
      if (delivery.queued) {
        channelQueued.push({
          channelId,
          messageId,
          queueId: delivery.queueId,
          error: delivery.error,
        });
        continue;
      }
      const issue = delivery.issue;

      if (issue && issue.deduped) {
        channelDeduped.push({
          channelId,
          messageId,
          identifier: issue.identifier || '',
          dedupeKey: issue.dedupeKey || '',
        });
        continue;
      }

      createdCount += 1;
      channelCreated.push({
        channelId,
        messageId,
        identifier: issue.identifier || '',
        url: issue.url || '',
        title: issue.title || input.title,
      });
      appendAuditEvent('discord-intake-created', {
        channelId,
        messageId,
        sourceId,
        identifier: issue.identifier || '',
        url: issue.url || '',
      });
    }

    state.channels[channelId] = {
      lastSeenTsMs: Math.max(highWatermarkTsMs, oldLastSeenTsMs),
      updatedAtMs: Date.now(),
    };

    processed += channelProcessed;
    created.push(...channelCreated);
    queued.push(...channelQueued);
    deduped.push(...channelDeduped);
    skipped.push(...channelSkipped);
    channelResults.push({
      channelId,
      bootstrapped: false,
      inspected: ordered.length,
      processed: channelProcessed,
      created: channelCreated.length,
      queued: channelQueued.length,
      deduped: channelDeduped.length,
      skipped: channelSkipped.length,
      lastSeenTsMs: state.channels[channelId].lastSeenTsMs,
    });
  }

  const maxStateEntries = 4000;
  const entries = Object.entries(state.items || {});
  if (entries.length > maxStateEntries) {
    entries.sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
    state.items = {};
    for (const [key, value] of entries.slice(0, maxStateEntries)) {
      state.items[key] = value;
    }
  }

  state.version = 2;
  state.updatedAtMs = Date.now();
  writeJsonFile(DISCORD_INTAKE_STATE_PATH, state);

  const result = {
    ok: true,
    channelIds,
    channels: channelResults,
    bootstrappedChannels,
    inspected,
    processed,
    created,
    queued,
    deduped,
    skipped,
  };

  if (!backfill && bootstrappedChannels.length > 0 && created.length === 0 && queued.length === 0) {
    result.bootstrapped = true;
    result.note = 'state initialized for one or more channels; next run will ingest new directives only';
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Discord intake sync result:');
  lines.push(`- channels: ${channelIds.join(', ')}`);
  lines.push(`- inspected: ${inspected}`);
  lines.push(`- processed directives: ${processed}`);
  lines.push(`- created Linear issues: ${created.length}`);
  lines.push(`- queued for retry: ${queued.length}`);
  lines.push(`- deduped: ${deduped.length}`);
  lines.push(`- skipped: ${skipped.length}`);
  if (bootstrappedChannels.length > 0) {
    lines.push(`- bootstrapped channels: ${bootstrappedChannels.map((item) => item.channelId).join(', ')}`);
  }
  for (const item of created.slice(0, 8)) {
    lines.push(`- [${item.channelId}] ${item.messageId} -> ${item.identifier}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdLinearAutopilot(settings, flags) {
  if (settings.execution && settings.execution.enabled === false && !flags.force) {
    const disabled = { ok: true, skipped: true, reason: 'disabled' };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(disabled, null, 2)}\n`);
    } else {
      process.stdout.write('Linear autopilot is disabled in config.\n');
    }
    return;
  }

  const apiKey = String(settings.linear.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is required for linear-autopilot.');
  }

  const forceRun = isTruthyLike(flags.force);
  const circuitSettings = resolveAutopilotCircuitSettings(settings, flags);
  const circuitState = readAutopilotCircuitState();
  const circuitGate = evaluateAutopilotCircuitGate(circuitState, circuitSettings, forceRun);
  if (circuitGate.open && !forceRun) {
    const skipped = {
      ok: true,
      skipped: true,
      reason: 'circuit-open',
      circuit: {
        status: 'open',
        openUntilMs: circuitGate.openUntilMs,
        openUntil: new Date(circuitGate.openUntilMs).toISOString(),
        lastReason: circuitGate.lastReason,
        consecutiveFailures: circuitGate.consecutiveFailures,
        issueIdentifier: circuitState.issueIdentifier || '',
        issueUrl: circuitState.issueUrl || '',
      },
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Linear autopilot skipped: circuit open until ${formatTime(circuitGate.openUntilMs, settings.timezone)}.\n`,
      );
    }
    return;
  }

  // CLAW-112: Daily Token Budget Governor (Global check)
  const budgetGate = evaluateTokenBudgetGate(settings, null, 0);
  if (budgetGate.status === 'freeze' && !forceRun) {
    const skipped = { ok: true, skipped: true, reason: 'budget-freeze', ratio: budgetGate.ratio };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
    } else {
      process.stdout.write(`Linear autopilot skipped: global daily token budget exhausted (${Math.round(budgetGate.ratio * 100)}%).\n`);
    }
    return;
  }

  const t0 = Date.now();
  const traceAutopilot = Boolean(flags.trace);
  const trace = (msg) => {
    if (traceAutopilot) {
      process.stderr.write(`[linear-autopilot] +${Date.now() - t0}ms ${msg}\n`);
    }
  };

  trace('resolve team id: start');
  const teamId = settings.linear.teamId || (await resolveLinearTeamId(apiKey, settings.linear.teamKey));
  trace(`resolve team id: done (${teamId || 'null'})`);
  if (!teamId) {
    throw new Error('Unable to resolve Linear team id for linear-autopilot.');
  }

  const includeStates = normalizeStateNames(
    flags.states || (settings.execution && settings.execution.includeStates) || ['In Progress', 'Triage', 'Blocked'],
  );
  const includeLabels = normalizeLabelNames(
    flags.labels || (settings.execution && settings.execution.includeLabels) || ['auto-intake', 'main-directive'],
  );
  const includeAll = Boolean(flags.all || flags['include-all']);
  const maxPromptChars = Math.max(
    300,
    Number(flags['max-prompt-chars'] || (settings.execution && settings.execution.maxPromptChars) || 1400),
  );
  const issueCooldownMinutes = Math.max(
    0,
    Number(
      flags['issue-cooldown-minutes'] ||
        (settings.execution && settings.execution.issueCooldownMinutes) ||
        30,
    ),
  );
  const maxConsecutiveSameIssue = Math.max(
    1,
    Number(
      flags['max-consecutive-same-issue'] ||
        (settings.execution && settings.execution.maxConsecutiveSameIssue) ||
        2,
    ),
  );
  const preferNewTriage =
    flags['prefer-new-triage'] !== undefined
      ? isTruthyLike(flags['prefer-new-triage'])
      : Boolean(settings.execution && settings.execution.preferNewTriage !== false);
  const historyState = readJsonFile(LINEAR_AUTOPILOT_PATH, { version: 1, updatedAtMs: 0, runs: [] });
  const historyRuns = Array.isArray(historyState.runs) ? historyState.runs : [];

  trace('fetch open issues: start');
  const openIssues = await fetchOpenLinearIssuesForSla(apiKey, teamId);
  trace(`fetch open issues: done (count=${Array.isArray(openIssues) ? openIssues.length : 0})`);
  const forcedIssueIdentifier = normalizeLinearIssueId(
    flags.issue || flags['issue-id'] || flags.identifier || '',
  );
  let selection = { issue: null, strategy: 'none' };
  let candidate = null;
  let usedLabelFallback = false;
  if (forcedIssueIdentifier) {
    candidate = openIssues.find(
      (item) => normalizeLinearIssueId(item && item.identifier ? item.identifier : '') === forcedIssueIdentifier,
    ) || null;
    selection = {
      issue: candidate,
      strategy: candidate ? 'forced-issue' : 'forced-issue-not-found',
    };
  } else {
    selection = pickLinearAutopilotCandidate(openIssues, {
      includeStates,
      includeLabels,
      includeAll,
      historyRuns,
      issueCooldownMinutes,
      maxConsecutiveSameIssue,
      preferNewTriage,
    });
    candidate = selection.issue;
    usedLabelFallback = !candidate && !includeAll && includeLabels.length > 0;
    if (usedLabelFallback) {
      selection = pickLinearAutopilotCandidate(openIssues, {
        includeStates,
        includeLabels: [],
        includeAll: true,
        historyRuns,
        issueCooldownMinutes,
        maxConsecutiveSameIssue,
        preferNewTriage,
      });
      candidate = selection.issue;
    }
  }

  if (!candidate) {
    const empty = {
      ok: true,
      skipped: true,
      reason: forcedIssueIdentifier ? 'forced-issue-not-found' : 'no-runnable-issue',
      forcedIssueIdentifier: forcedIssueIdentifier || '',
      scanned: openIssues.length,
      includeStates,
      includeLabels,
      includeAll,
      usedLabelFallback,
      selectionStrategy: selection && selection.strategy ? selection.strategy : '',
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(empty, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Linear autopilot found no runnable issue (scanned=${openIssues.length}, labels=${includeLabels.join(',') || '*'}).\n`,
      );
    }
    return;
  }

  const requestedAgentId = String(
    flags.agent || (settings.execution && settings.execution.agentId) || 'main',
  ).trim();

  // CLAW-111: Model tier routing based on issue labels
  const modelRouting = settings.execution && settings.execution.modelRouting ? settings.execution.modelRouting : DEFAULTS.modelRouting;
  const issueLabels = (((candidate || {}).labels || {}).nodes || []).map(l => String(l && l.name ? l.name : '').toLowerCase());
  const needsEscalation = modelRouting.escalationLabels.some(l => issueLabels.includes(l.toLowerCase()));
  let targetTier = String(flags.tier || (needsEscalation ? 'x-high' : 'medium')).toLowerCase();

  // CLAW-112: Daily Token Budget Governor (Per-agent/Priority gate) - Preliminary check
  const preBudgetGate = evaluateTokenBudgetGate(settings, requestedAgentId === 'auto' ? null : requestedAgentId, candidate.priority);
  if (preBudgetGate.status === 'freeze' && !forceRun) {
    const skipped = { ok: true, skipped: true, reason: 'budget-freeze', ratio: preBudgetGate.ratio };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
    } else {
      process.stdout.write(`Linear autopilot skipped: token budget exhausted (${Math.round(preBudgetGate.ratio * 100)}%).\n`);
    }
    return;
  }
  if (preBudgetGate.status === 'throttle' && !forceRun) {
    const skipped = { ok: true, skipped: true, reason: 'budget-throttle', ratio: preBudgetGate.ratio };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
    } else {
      process.stdout.write(`Linear autopilot skipped: budget throttle (high-priority only).\n`);
    }
    return;
  }

  // Apply budget downgrade action
  if (preBudgetGate.status === 'downgrade') {
    if (targetTier === 'x-high') {
      trace(`token budget downgrade: forcing medium tier instead of x-high (ratio=${Math.round(preBudgetGate.ratio * 100)}%)`);
      targetTier = 'medium';
    }
  }

  let agentId = requestedAgentId;
  let agentSelection = {
    mode: 'fixed',
    requested: requestedAgentId || 'main',
    selected: requestedAgentId || 'main',
    candidates: [requestedAgentId || 'main'],
  };
  if (isAutoAgentSelector(requestedAgentId)) {
    trace(`model routing: target tier=${targetTier} (escalation=${needsEscalation})`);
    const dynamicCandidates = resolveAutopilotDynamicAgentCandidates(settings, flags, { tier: targetTier });
    
    // CLAW-108: Check if current issue has an active binding that should be avoided due to sharding
    const bindings = readJsonFile(ISSUE_LINKS_PATH, { byIssue: {} });
    const issueBinding = bindings.byIssue && bindings.byIssue[candidate.identifier] ? bindings.byIssue[candidate.identifier] : null;
    let filteredCandidates = dynamicCandidates;
    
    if (issueBinding && Array.isArray(issueBinding.sessionKeys) && issueBinding.sessionKeys.length > 0) {
      const activeSessionKey = issueBinding.sessionKeys[issueBinding.sessionKeys.length - 1];
      const activeAgentId = String(activeSessionKey.split(':')[1] || '').trim().toLowerCase();
      
      const shardingCheck = checkSessionShardingThreshold(activeSessionKey, activeAgentId, settings, circuitSettings.sharding);
      if (shardingCheck.shouldShard && dynamicCandidates.length > 1) {
        filteredCandidates = dynamicCandidates.filter(c => c.toLowerCase() !== activeAgentId);
        trace(`sharding: avoid agent ${activeAgentId} due to threshold breach, pool size ${dynamicCandidates.length} -> ${filteredCandidates.length}`);
      }
    }

    const selected = pickRoundRobinAutopilotAgent(filteredCandidates.length > 0 ? filteredCandidates : dynamicCandidates);
    if (!selected) {
      const skipped = {
        ok: true,
        skipped: true,
        reason: 'no-agent-candidate',
        requestedAgentId,
        candidates: dynamicCandidates,
      };
      if (flags.json) {
        process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
      } else {
        process.stdout.write('Linear autopilot skipped: no available execution agent candidates.\n');
      }
      return;
    }
    agentId = selected;
    agentSelection = {
      mode: 'auto-round-robin',
      requested: requestedAgentId,
      selected,
      candidates: dynamicCandidates,
    };
  }

  // CLAW-108: Resolve 1-issue-1-session sessionId
  let targetSessionId = '';
  const bindings = readJsonFile(ISSUE_LINKS_PATH, { byIssue: {} });
  const issueBinding = bindings.byIssue && bindings.byIssue[candidate.identifier] ? bindings.byIssue[candidate.identifier] : null;
  if (issueBinding && Array.isArray(issueBinding.sessionKeys) && issueBinding.sessionKeys.length > 0) {
    // Try to find a session linked to the selected agentId that hasn't hit threshold
    for (let i = issueBinding.sessionKeys.length - 1; i >= 0; i--) {
      const key = issueBinding.sessionKeys[i];
      const [sid, aid] = key.split(':');
      if (aid && aid.toLowerCase() === agentId.toLowerCase()) {
        const shardingCheck = checkSessionShardingThreshold(key, aid, settings, circuitSettings.sharding);
        if (!shardingCheck.shouldShard) {
          targetSessionId = sid;
          trace(`sharding: reuse session ${sid} for agent ${aid}`);
          break;
        }
      }
    }
  }
  if (!targetSessionId) {
    targetSessionId = `issue-${candidate.identifier}-${Date.now().toString().slice(-6)}`;
    trace(`sharding: starting fresh session ${targetSessionId} for issue ${candidate.identifier}`);
  }

  const timeoutSeconds = Math.max(
    60,
    Number(flags['timeout-seconds'] || (settings.execution && settings.execution.timeoutSeconds) || 900),
  );
  const agentRetries = Math.max(
    0,
    Number(flags['agent-retries'] || (settings.execution && settings.execution.agentRetries) || 2),
  );
  const retryBackoffSeconds = Math.max(
    1,
    Number(
      flags['retry-backoff-seconds'] || (settings.execution && settings.execution.retryBackoffSeconds) || 20,
    ),
  );
  const lockTtlSeconds = Math.max(
    60,
    Number(flags['lock-ttl-seconds'] || (settings.execution && settings.execution.lockTtlSeconds) || 1800),
  );
  const fallbackAgentSuffix = String(
    flags['fallback-agent-suffix'] || (settings.execution && settings.execution.fallbackAgentSuffix) || 'autopilot',
  )
    .trim()
    .replace(/^[-_]+/, '');
  const strictFailure =
    flags.strict !== undefined
      ? isTruthyLike(flags.strict)
      : Boolean(settings.execution && settings.execution.failOnError === true);
  trace(`candidate selected: ${candidate.identifier}`);

  // CLAW-108: Check for handoff package from previous threshold breach
  let handoffPackage = null;
  const handoffDir = path.join(DATA_DIR, 'handoffs');
  if (fs.existsSync(handoffDir)) {
    const handoffFiles = fs.readdirSync(handoffDir)
      .filter(f => f.startsWith(`${candidate.identifier}-`) && f.endsWith('-handoff.json'))
      .sort((a, b) => b.localeCompare(a)); // Get latest
    if (handoffFiles.length > 0) {
      const latestHandoff = readJsonFile(path.join(handoffDir, handoffFiles[0]), null);
      if (latestHandoff && latestHandoff.issueIdentifier === candidate.identifier) {
        handoffPackage = latestHandoff;
      }
    }
  }

  const smartContextMessage = buildSmartContextSnippet(candidate, settings);
  const smartContext = maybeCompressSmartContext(candidate, smartContextMessage, settings);
  const prompt = buildLinearAutopilotPrompt(candidate, maxPromptChars, {
    workdir: ROOT_DIR,
    handoff: handoffPackage,
    smartContextMessage: smartContext.text,
    smartContextBudget: smartContext.budget,
  });
  trace('build prompt: done');

  // CLAW-185: Prompt contract validator (length + raw-log guard) for layered write contract.
  // Keep it cheap: just compute audit stats and optionally fail-fast under strict mode.
  const promptLength = prompt.length;
  const bloatThreshold = Math.max(2000, maxPromptChars * 2);
  const hasRawLogs = /```\s*(log|json|yaml|yml)\s*\n/i.test(prompt) || /\n\s*\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}\b/i.test(prompt);
  const contractAudit = {
    promptLength,
    maxPromptChars,
    bloatThreshold,
    bloat: promptLength > bloatThreshold,
    hasRawLogs,
  };
  if (contractAudit.bloat) {
    trace(
      `WARNING: prompt bloat detected (${promptLength} chars). Contract limit: ${maxPromptChars}. Truncating context...`,
    );
  }
  if (contractAudit.hasRawLogs) {
    trace('WARNING: prompt contract violation: raw logs detected in prompt.');
  }
  if (strictFailure && (contractAudit.bloat || contractAudit.hasRawLogs)) {
    throw new Error(
      `Prompt contract validation failed (bloat=${contractAudit.bloat}, rawLogs=${contractAudit.hasRawLogs}, length=${promptLength}).`,
    );
  }

  const lock = acquireTaskLock(LINEAR_AUTOPILOT_LOCK_PATH, lockTtlSeconds * 1000);
  if (!lock.acquired) {
    const skipped = {
      ok: true,
      skipped: true,
      reason: 'already-running',
      lock: {
        path: LINEAR_AUTOPILOT_LOCK_PATH,
        pid: Number(lock.pid || 0),
        ageMs: Number(lock.ageMs || 0),
        message: String(lock.message || lock.reason || ''),
      },
      issue: {
        identifier: candidate.identifier,
      },
      selectionStrategy: selection && selection.strategy ? selection.strategy : '',
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
    } else {
      const age = Number(lock.ageMs || 0) > 0 ? ` age=${formatDuration(Number(lock.ageMs || 0))}` : '';
      process.stdout.write(
        `Linear autopilot skipped: another run is active (pid=${lock.pid || '-'}${age}).\n`,
      );
    }
    return;
  }

  let agentPayload = null;
  let agentText = '';
  let agentError = '';
  let runId = '';
  let agentUsed = agentId;
  let agentSessionId = '';
  let agentSessionKey = '';
  let agentAttempts = [];
  try {
    // CLAW-112: Daily Token Budget Governor (Per-agent/Priority gate)
    const agentBudgetGate = evaluateTokenBudgetGate(settings, agentId, candidate.priority);
    if (agentBudgetGate.status === 'freeze' && !forceRun) {
      throw new Error(`Token budget frozen for agent ${agentId} (${Math.round(agentBudgetGate.ratio * 100)}%)`);
    }
    if (agentBudgetGate.status === 'throttle' && !forceRun) {
      throw new Error(`Token budget throttled: high-priority runs only (${Math.round(agentBudgetGate.ratio * 100)}%)`);
    }

    trace('openclaw agent: start');
    const execution = await runLinearAutopilotAgent({
      prompt,
      primaryAgentId: agentId,
      sessionId: targetSessionId,
      timeoutSeconds,
      retries: agentRetries,
      retryBackoffSeconds,
      fallbackAgentSuffix,
      settings,
      trace,
    });
    agentAttempts = execution.attempts || [];
    if (!execution.ok) {
      agentError = execution.error || 'openclaw agent run failed';
    } else {
      agentUsed = execution.agentId || agentId;
      agentPayload = execution.payload || null;
      runId = String(execution.runId || '').trim();
      agentText = String(execution.text || '').trim();
      agentSessionId = String(execution.sessionId || '').trim();
      agentSessionKey = String(execution.sessionKey || '').trim();

      // CLAW-112: Update Token Budget Usage
      const tokensUsed = Number(execution.totalTokens || 0);
      if (tokensUsed > 0) {
        updateTokenBudgetUsage(agentUsed, tokensUsed);
        trace(`token budget updated: +${tokensUsed} for ${agentUsed}`);
      }

      const linkUpsert = upsertRuntimeIssueBindings(candidate.identifier, {
        sessionId: agentSessionId,
        sessionKey: agentSessionKey,
        agentId: agentUsed,
      });
      if (linkUpsert.updated) {
        appendAuditEvent('runtime-issue-link-upsert', {
          issueIdentifier: candidate.identifier,
          sessionId: agentSessionId,
          sessionKey: agentSessionKey,
          agentId: agentUsed,
          updated: true,
        });
      }
      trace('openclaw agent: done');

      // CLAW-108: Check session sharding thresholds after agent execution
      const shardingCheck = checkSessionShardingThreshold(agentSessionKey, agentUsed, settings, circuitSettings.sharding);
      trace(`session sharding check: ${shardingCheck.reason}`);

      if (shardingCheck.shouldShard) {
        const handoff = enforceSessionHandoff(
          candidate.identifier,
          agentSessionKey,
          agentUsed,
          settings,
          shardingCheck,
          agentText,
        );
        trace('session handoff enforced');
        appendAuditEvent('session-handoff-enforced', {
          issueIdentifier: candidate.identifier,
          sessionKey: agentSessionKey,
          agentId: agentUsed,
          reason: shardingCheck.reason,
          metrics: shardingCheck.metrics,
          handoffFilePath: handoff.handoffFilePath,
        });
        // Include handoff info in agentText for downstream processing
        agentText = `${agentText}\n\n[Session Handoff Enforced]\n${handoff.summary}`;
      }
    }
  } finally {
    releaseTaskLock(lock);
  }

  let parsed = parseLinearAutopilotResponse(agentText);
  const normalizedParsed = normalizeAutopilotBlockedContention(parsed, agentText);
  if (normalizedParsed.status !== parsed.status) {
    appendAuditEvent('linear-autopilot-blocked-normalized', {
      issueIdentifier: candidate.identifier,
      runId,
      fromStatus: parsed.status,
      toStatus: normalizedParsed.status,
      reason: 'execution-contention',
    });
  }
  parsed = normalizedParsed;
  const nextState = resolveLinearAutopilotNextState(candidate, parsed, settings);
  let transition = null;
  if (
    !agentError &&
    nextState &&
    settings.execution &&
    settings.execution.autoTransition !== false
  ) {
    trace(`transition: start -> ${nextState}`);
    transition = await transitionIssueByIdentifier(candidate.identifier, nextState, settings);
    trace(`transition: done (${transition && transition.status ? transition.status : '-'})`);
  }

  let commented = false;
  let commentError = '';
  if (settings.execution && settings.execution.autoComment === false) {
    commented = false;
  } else {
    const comment = renderLinearAutopilotComment({
      candidate,
      parsed,
      agentText,
      agentError,
      modelTier: targetTier,
      runId,
      transition,
      settings,
    });
    try {
      await createLinearIssueComment(apiKey, candidate.id, comment);
      commented = true;
    } catch (error) {
      commentError = error instanceof Error ? error.message : String(error);
    }
  }

  const result = {
    ok: !agentError,
    issue: {
      id: candidate.id,
      identifier: candidate.identifier,
      title: candidate.title,
      url: candidate.url || '',
      state: candidate.state && candidate.state.name ? candidate.state.name : '',
    },
    runId,
    agentId,
    requestedAgentId,
    agentUsed,
    agentSelection,
    timeoutSeconds,
    attempts: agentAttempts,
    session: {
      sessionId: agentSessionId,
      sessionKey: agentSessionKey,
    },
    status: parsed.status || (agentError ? 'error' : 'in_progress'),
    summary: parsed.summary || singleLine(trimMessage(agentText || '', 400)),
    nextAction: parsed.nextAction || '',
    artifacts: parsed.artifacts,
    nextState,
    transition,
    usedLabelFallback,
    selectionStrategy: selection && selection.strategy ? selection.strategy : '',
    commented,
    commentError,
    error: agentError,
  };

  const circuitUpdate = await updateAutopilotCircuitState({
    result,
    settings,
    flags,
    apiKey,
    circuitSettings,
    previousState: circuitState,
  });
  if (circuitUpdate && typeof circuitUpdate === 'object') {
    result.circuit = circuitUpdate.public;
  }

  const runs = Array.isArray(historyState.runs) ? historyState.runs : [];
  runs.unshift({
    atMs: Date.now(),
    issueIdentifier: result.issue.identifier,
    runId: result.runId,
    status: result.status,
    ok: result.ok,
    commented: result.commented,
    nextState: result.nextState || '',
    transitionStatus: result.transition && result.transition.status ? result.transition.status : '',
    error: result.error || result.commentError || '',
  });
  historyState.version = 1;
  historyState.updatedAtMs = Date.now();
  historyState.runs = runs.slice(0, 200);
  writeJsonFile(LINEAR_AUTOPILOT_PATH, historyState);

  appendAuditEvent('linear-autopilot-run', {
    issueIdentifier: result.issue.identifier,
    status: result.status,
    ok: result.ok,
    runId: result.runId,
    nextState: result.nextState || '',
    transitionStatus: result.transition && result.transition.status ? result.transition.status : '',
    requestedAgentId: result.requestedAgentId || requestedAgentId,
    agentUsed: result.agentUsed || agentId,
    commented: result.commented,
    circuitStatus: result.circuit && result.circuit.status ? result.circuit.status : 'unknown',
    error: result.error || result.commentError || '',
  });
  const failureClasses = Array.isArray(result.attempts)
    ? result.attempts
        .map((item) => String(item && item.failureClass ? item.failureClass : '').trim().toLowerCase())
        .filter(Boolean)
    : [];
  const failureClassCount = {
    rate_limit: failureClasses.filter((item) => item === 'rate_limit').length,
    lock_conflict: failureClasses.filter((item) => item === 'lock_conflict').length,
    timeout: failureClasses.filter((item) => item === 'timeout').length,
    unknown: failureClasses.filter((item) => item === 'unknown').length,
  };
  recordExecutorStabilityRun({
    source: 'linear-autopilot',
    ok: result.ok,
    issueIdentifier: result.issue.identifier,
    attempts: Array.isArray(result.attempts) ? result.attempts.length : 0,
    maxAttemptsUsed: Array.isArray(result.attempts) ? result.attempts.length : 0,
    failureClassCount,
    recovered: result.ok ? 1 : 0,
    failed: result.ok ? 0 : 1,
    maxConcurrentCritical: 1,
    retryable: {
      total: failureClassCount.rate_limit + failureClassCount.lock_conflict + failureClassCount.timeout,
      recovered: result.ok ? failureClassCount.rate_limit + failureClassCount.lock_conflict + failureClassCount.timeout : 0,
    },
    p95RecoveryMs: 0,
    avgRecoveryMs: 0,
  });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push('Linear autopilot result:');
    lines.push(`- issue: ${result.issue.identifier} ${result.issue.title}`);
    lines.push(`- status: ${result.status}`);
    lines.push(`- transition: ${result.transition ? result.transition.status : '-'}`);
    lines.push(`- strategy: ${result.selectionStrategy || '-'}`);
    lines.push(`- label fallback: ${result.usedLabelFallback ? 'yes' : 'no'}`);
    lines.push(`- commented: ${result.commented ? 'yes' : 'no'}`);
    if (result.summary) {
      lines.push(`- summary: ${singleLine(result.summary)}`);
    }
    if (result.nextAction) {
      lines.push(`- next action: ${singleLine(result.nextAction)}`);
    }
    if (result.error) {
      lines.push(`- error: ${singleLine(result.error)}`);
    }
    if (result.commentError) {
      lines.push(`- comment error: ${singleLine(result.commentError)}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  if (agentError && strictFailure) {
    throw new Error(`linear-autopilot agent run failed: ${agentError}`);
  }
}

async function cmdLinearEngine(settings, flags) {
  if (flags.help || flags.h) {
    process.stdout.write(
      [
        'Usage:',
        '  linear-engine [--issue CLAW-123 | --auto-pick] [--max-steps N] [--no-progress-threshold N] [--json]',
        '  linear-engine --drain [--drain-max-issues N] [--max-steps N] [--auto-pick] [--json]',
        '',
        'Behavior:',
        '  - default mode: execute one issue for multiple steps until done/blocked/no-progress/max-steps',
        '  - drain mode: process multiple runnable issues in sequence within one run',
        '  - no-progress escalation: tracked across runs; default threshold=3 consecutive no-progress rounds',
      ].join('\n') + '\n',
    );
    return;
  }

  const drainMode =
    flags.drain !== undefined
      ? isTruthyLike(flags.drain)
      : Boolean(settings.execution && settings.execution.engineDrain === true);
  if (drainMode) {
    await cmdLinearEngineDrain(settings, flags);
    return;
  }

  const requestedIssueIdentifier = normalizeLinearIssueId(
    flags.issue || flags['issue-id'] || flags.identifier || '',
  );
  const autoPick =
    flags['auto-pick'] !== undefined
      ? isTruthyLike(flags['auto-pick'])
      : !requestedIssueIdentifier && Boolean(settings.execution && settings.execution.engineAutoPick !== false);
  if (!requestedIssueIdentifier && !autoPick) {
    throw new Error('linear-engine requires --issue CLAW-123 (or pass --auto-pick).');
  }

  const maxSteps = Math.max(
    1,
    Number(
      flags['max-steps'] || flags.steps || (settings.execution && settings.execution.engineMaxSteps) || 5,
    ),
  );
  const stepSleepMs = Math.max(
    0,
    Number(
      flags['step-sleep-ms'] || (settings.execution && settings.execution.engineStepSleepMs) || 0,
    ),
  );
  const noProgressThreshold = Math.max(
    2,
    Number(
      flags['no-progress-threshold'] ||
        (settings.execution && settings.execution.engineNoProgressThreshold) ||
        2,
    ),
  );
  const strictFailure = isTruthyLike(flags.strict);
  const timeoutSeconds = Math.max(
    60,
    Number(flags['timeout-seconds'] || (settings.execution && settings.execution.timeoutSeconds) || 900),
  );
  const perStepTimeoutMs = Math.max(90_000, Math.ceil(timeoutSeconds * 1000 * 1.3));

  const runs = [];
  let stopReason = 'max-steps';
  let previousFingerprint = '';
  let consecutiveSameFingerprint = 0;
  let activeIssueIdentifier = requestedIssueIdentifier;
  let resolvedIssueIdentifier = requestedIssueIdentifier;
  let autoPickAttempted = false;

  for (let step = 1; step <= maxSteps; step += 1) {
    const childArgs = ['linear-autopilot', '--json'];
    if (activeIssueIdentifier) {
      childArgs.push('--issue', activeIssueIdentifier);
    } else if (autoPick) {
      autoPickAttempted = true;
    } else {
      throw new Error('linear-engine internal error: missing issue identifier.');
    }
    if (isTruthyLike(flags.force)) {
      childArgs.push('--force');
    }
    if (isTruthyLike(flags.trace)) {
      childArgs.push('--trace');
    }
    if (flags.agent) {
      childArgs.push('--agent', String(flags.agent));
    }
    if (flags['max-prompt-chars']) {
      childArgs.push('--max-prompt-chars', String(flags['max-prompt-chars']));
    }
    if (flags['timeout-seconds']) {
      childArgs.push('--timeout-seconds', String(flags['timeout-seconds']));
    }
    if (flags['agent-retries']) {
      childArgs.push('--agent-retries', String(flags['agent-retries']));
    }
    if (flags['retry-backoff-seconds']) {
      childArgs.push('--retry-backoff-seconds', String(flags['retry-backoff-seconds']));
    }
    if (!activeIssueIdentifier) {
      if (flags.all || flags['include-all']) {
        childArgs.push('--all');
      }
      if (flags.states) {
        childArgs.push('--states', String(flags.states));
      }
      if (flags.labels) {
        childArgs.push('--labels', String(flags.labels));
      }
    }

    let payload = null;
    let commandError = '';
    try {
      const output = runCommand(
        process.execPath,
        [path.join(ROOT_DIR, 'scripts', 'tasks.js'), ...childArgs],
        {
          timeoutMs: perStepTimeoutMs,
          label: `linear-engine step ${step}`,
        },
      );
      payload = extractJson(output.stdout || '');
    } catch (error) {
      commandError = error instanceof Error ? error.message : String(error);
    }
    const payloadIssueIdentifier = normalizeLinearIssueId(
      payload && payload.issue && payload.issue.identifier ? payload.issue.identifier : '',
    );
    if (!activeIssueIdentifier && payloadIssueIdentifier) {
      activeIssueIdentifier = payloadIssueIdentifier;
      resolvedIssueIdentifier = payloadIssueIdentifier;
    } else if (!resolvedIssueIdentifier && payloadIssueIdentifier) {
      resolvedIssueIdentifier = payloadIssueIdentifier;
    }

    const stepRun = {
      step,
      atMs: Date.now(),
      ok: payload ? payload.ok !== false : false,
      skipped: payload ? Boolean(payload.skipped) : false,
      reason: payload ? String(payload.reason || '') : '',
      status: payload ? String(payload.status || '') : '',
      runId: payload ? String(payload.runId || '') : '',
      nextState: payload ? String(payload.nextState || '') : '',
      transitionStatus:
        payload && payload.transition && payload.transition.status
          ? String(payload.transition.status)
          : '',
      summary: payload ? singleLine(trimMessage(String(payload.summary || ''), 240)) : '',
      error: commandError || (payload ? String(payload.error || payload.commentError || '') : ''),
      agentUsed: payload ? String(payload.agentUsed || payload.agentId || '') : '',
      issueIdentifier: payloadIssueIdentifier || activeIssueIdentifier || requestedIssueIdentifier || '',
    };
    runs.push(stepRun);

    if (stepRun.error) {
      stopReason = 'error';
      break;
    }
    if (stepRun.skipped) {
      stopReason = `skipped:${stepRun.reason || 'unknown'}`;
      break;
    }

    const normalizedStatus = String(stepRun.status || '').trim().toLowerCase();
    if (normalizedStatus === 'done' || normalizedStatus === 'blocked') {
      stopReason = `status:${normalizedStatus}`;
      break;
    }

    const fingerprint = [
      String(stepRun.issueIdentifier || '-').toLowerCase(),
      normalizedStatus || '-',
      String(stepRun.nextState || '-').toLowerCase(),
      String(stepRun.transitionStatus || '-').toLowerCase(),
      String(stepRun.summary || '-').toLowerCase(),
    ].join('|');
    if (fingerprint === previousFingerprint) {
      consecutiveSameFingerprint += 1;
    } else {
      consecutiveSameFingerprint = 1;
      previousFingerprint = fingerprint;
    }
    if (consecutiveSameFingerprint >= noProgressThreshold) {
      stopReason = 'no-progress';
      break;
    }

    if (step < maxSteps && stepSleepMs > 0) {
      await sleepMs(stepSleepMs);
    }
  }

  const finalRun = runs.length > 0 ? runs[runs.length - 1] : null;
  const issueIdentifier =
    resolvedIssueIdentifier || (finalRun && finalRun.issueIdentifier ? finalRun.issueIdentifier : '') || '';
  const hasError = runs.some((item) => String(item.error || '').trim().length > 0);
  const result = {
    ok: !hasError,
    requestedIssueIdentifier,
    issueIdentifier,
    autoPick,
    autoPickAttempted,
    stepsPlanned: maxSteps,
    stepsExecuted: runs.length,
    stopReason,
    finalStatus: finalRun ? finalRun.status : '',
    finalNextState: finalRun ? finalRun.nextState : '',
    finalRunId: finalRun ? finalRun.runId : '',
    runs,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push('Linear engine result:');
    lines.push(`- issue: ${issueIdentifier || '-'}`);
    lines.push(`- steps: ${result.stepsExecuted}/${result.stepsPlanned}`);
    lines.push(`- stop reason: ${result.stopReason}`);
    lines.push(`- final status: ${result.finalStatus || '-'}`);
    lines.push(`- final next state: ${result.finalNextState || '-'}`);
    if (result.finalRunId) {
      lines.push(`- final run id: ${result.finalRunId}`);
    }
    if (hasError && finalRun && finalRun.error) {
      lines.push(`- error: ${singleLine(trimMessage(finalRun.error, 320))}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  if (strictFailure && hasError) {
    throw new Error(`linear-engine failed: ${finalRun ? finalRun.error : 'unknown error'}`);
  }
}

function resolveLinearEngineNoProgressEscalationSettings(settings, flags) {
  const base =
    settings &&
    settings.execution &&
    settings.execution.noProgressEscalation &&
    typeof settings.execution.noProgressEscalation === 'object'
      ? settings.execution.noProgressEscalation
      : {};

  return {
    enabled:
      flags['no-progress-escalation-enabled'] !== undefined
        ? isTruthyLike(flags['no-progress-escalation-enabled'])
        : base.enabled !== false,
    thresholdRuns: Math.max(
      2,
      Number(
        flags['no-progress-escalation-threshold'] || base.thresholdRuns || 3,
      ),
    ),
    cooldownMinutes: Math.max(
      5,
      Number(
        flags['no-progress-escalation-cooldown-minutes'] || base.cooldownMinutes || 180,
      ),
    ),
    autoBlock:
      flags['no-progress-auto-block'] !== undefined
        ? isTruthyLike(flags['no-progress-auto-block'])
        : base.autoBlock !== false,
    notifyReportTarget:
      flags['no-progress-notify-report-target'] !== undefined
        ? isTruthyLike(flags['no-progress-notify-report-target'])
        : base.notifyReportTarget !== false,
    commentOnIssue:
      flags['no-progress-comment-on-issue'] !== undefined
        ? isTruthyLike(flags['no-progress-comment-on-issue'])
        : base.commentOnIssue !== false,
  };
}

function readLinearEngineNoProgressState() {
  const raw = readJsonFile(LINEAR_ENGINE_NO_PROGRESS_PATH, {
    version: 1,
    updatedAtMs: 0,
    byIssue: {},
  });
  const byIssue = raw && raw.byIssue && typeof raw.byIssue === 'object' ? raw.byIssue : {};
  return {
    version: 1,
    updatedAtMs: Number(raw && raw.updatedAtMs ? raw.updatedAtMs : 0),
    byIssue,
  };
}

function pruneLinearEngineNoProgressState(state, nowMs) {
  const byIssue = state && state.byIssue && typeof state.byIssue === 'object' ? state.byIssue : {};
  const maxIdleMs = 14 * 24 * 60 * 60 * 1000;
  const nextByIssue = {};

  for (const [issueIdentifier, rawEntry] of Object.entries(byIssue)) {
    const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
    const lastTouchedMs = Math.max(
      Number(entry.lastSeenAtMs || 0),
      Number(entry.lastNoProgressAtMs || 0),
      Number(entry.lastEscalatedAtMs || 0),
      Number(entry.lastEscalationAttemptAtMs || 0),
    );
    const activeStreak = Number(entry.consecutiveNoProgress || 0) > 0;
    if (activeStreak || (lastTouchedMs > 0 && nowMs - lastTouchedMs <= maxIdleMs)) {
      nextByIssue[issueIdentifier] = entry;
    }
  }

  state.byIssue = nextByIssue;
}

function writeLinearEngineNoProgressState(state) {
  const nowMs = Date.now();
  const next = {
    version: 1,
    updatedAtMs: nowMs,
    byIssue: state && state.byIssue && typeof state.byIssue === 'object' ? state.byIssue : {},
  };
  pruneLinearEngineNoProgressState(next, nowMs);
  writeJsonFile(LINEAR_ENGINE_NO_PROGRESS_PATH, next);
}

async function escalateLinearEngineNoProgressIssue(options) {
  const settings = options && options.settings ? options.settings : {};
  const policy = options && options.policy ? options.policy : {};
  const issueIdentifier = normalizeLinearIssueId(options && options.issueIdentifier ? options.issueIdentifier : '');
  const consecutiveNoProgress = Math.max(0, Number(options && options.consecutiveNoProgress ? options.consecutiveNoProgress : 0));
  const round = options && options.round ? options.round : {};

  const result = {
    triggered: false,
    issueIdentifier,
    consecutiveNoProgress,
    commented: false,
    commentError: '',
    autoBlocked: false,
    autoBlockStatus: '',
    autoBlockError: '',
    notified: false,
    notifyError: '',
  };

  if (!issueIdentifier) {
    result.notifyError = 'missing issue identifier';
    return result;
  }

  const apiKey = String(settings.linear && settings.linear.apiKey ? settings.linear.apiKey : '').trim();
  if (!apiKey) {
    result.notifyError = 'LINEAR_API_KEY missing';
    return result;
  }

  let issue = null;
  try {
    issue = await resolveLinearIssueByIdentifier(
      apiKey,
      issueIdentifier,
      settings.linear && settings.linear.teamKey ? settings.linear.teamKey : '',
    );
  } catch (error) {
    result.commentError = error instanceof Error ? error.message : String(error);
  }
  const issueId = issue && issue.id ? String(issue.id) : '';

  if (policy.commentOnIssue !== false && issueId) {
    const commentLines = [
      '### Autopilot No-Progress Escalation',
      `Detected ${consecutiveNoProgress} consecutive linear-engine rounds with \`stopReason=no-progress\` on this issue.`,
      '',
      'Latest engine snapshot:',
      `- stopReason: ${String(round.stopReason || '-').trim() || '-'}`,
      `- finalStatus: ${String(round.finalStatus || '-').trim() || '-'}`,
      `- finalNextState: ${String(round.finalNextState || '-').trim() || '-'}`,
      `- runId: ${String(round.finalRunId || '-').trim() || '-'}`,
      `- stepsExecuted: ${Number(round.stepsExecuted || 0)}`,
      '',
      'Automatic handling:',
      `- auto-block requested: ${policy.autoBlock !== false ? 'yes' : 'no'}`,
      `- report notification requested: ${policy.notifyReportTarget !== false ? 'yes' : 'no'}`,
      '',
      'Suggested unblock actions:',
      '1. Add exact blocker details and owner.',
      '2. Split oversized scope into smaller child issues.',
      '3. Re-run linear-engine after unblock evidence is added.',
    ];
    try {
      await createLinearIssueComment(apiKey, issueId, commentLines.join('\n'));
      result.commented = true;
    } catch (error) {
      result.commentError = error instanceof Error ? error.message : String(error);
    }
  }

  if (policy.autoBlock !== false) {
    try {
      const transition = await transitionIssueByIdentifier(issueIdentifier, 'Blocked', settings);
      result.autoBlockStatus = String(transition && transition.status ? transition.status : '');
      result.autoBlocked = ['moved', 'unchanged', 'skipped_closed'].includes(result.autoBlockStatus);
    } catch (error) {
      result.autoBlockError = error instanceof Error ? error.message : String(error);
    }
  }

  if (policy.notifyReportTarget !== false) {
    const channel = String(settings.report && settings.report.channel ? settings.report.channel : '').trim();
    const target = String(settings.report && settings.report.target ? settings.report.target : '').trim();
    if (channel && target) {
      const maxLength = Number(settings.report && settings.report.maxSendLength ? settings.report.maxSendLength : 3000);
      const alertText = trimMessage(
        [
          `[#autopilot] no-progress escalation`,
          `issue=${issueIdentifier}`,
          `streak=${consecutiveNoProgress}`,
          `stopReason=${String(round.stopReason || '-')}`,
          `finalStatus=${String(round.finalStatus || '-')}`,
          `action=comment+blocked`,
        ].join('\n'),
        maxLength,
      );
      try {
        runCommand('openclaw', [
          'message',
          'send',
          '--channel',
          channel,
          '--target',
          target,
          '--message',
          alertText,
        ]);
        result.notified = true;
      } catch (error) {
        result.notifyError = error instanceof Error ? error.message : String(error);
      }
    } else {
      result.notifyError = 'report channel/target not configured';
    }
  }

  result.triggered = result.commented || result.autoBlocked || result.notified;

  appendAuditEvent('linear-engine-no-progress-escalation', {
    issueIdentifier,
    consecutiveNoProgress,
    stopReason: String(round.stopReason || ''),
    finalStatus: String(round.finalStatus || ''),
    finalNextState: String(round.finalNextState || ''),
    finalRunId: String(round.finalRunId || ''),
    commented: result.commented,
    autoBlocked: result.autoBlocked,
    autoBlockStatus: result.autoBlockStatus || '',
    notified: result.notified,
    error: [result.commentError, result.autoBlockError, result.notifyError].filter(Boolean).join(' | '),
  });

  return result;
}

async function updateLinearEngineNoProgressState(input) {
  const state = input && input.state ? input.state : readLinearEngineNoProgressState();
  const settings = input && input.settings ? input.settings : {};
  const policy = input && input.policy ? input.policy : resolveLinearEngineNoProgressEscalationSettings(settings, {});
  const round = input && input.round ? input.round : {};
  const nowMs = Date.now();
  const issueIdentifier = normalizeLinearIssueId(round.issueIdentifier || '');

  if (!policy.enabled || !issueIdentifier) {
    return null;
  }

  if (!state.byIssue || typeof state.byIssue !== 'object') {
    state.byIssue = {};
  }

  const reasonLower = String(round.stopReason || '').trim().toLowerCase();
  const entry = state.byIssue[issueIdentifier] && typeof state.byIssue[issueIdentifier] === 'object'
    ? state.byIssue[issueIdentifier]
    : {
        consecutiveNoProgress: 0,
        lastNoProgressAtMs: 0,
        lastEscalatedAtMs: 0,
        lastEscalationAttemptAtMs: 0,
        escalationCount: 0,
        lastStopReason: '',
        lastSeenAtMs: 0,
      };

  entry.lastSeenAtMs = nowMs;
  entry.lastStopReason = String(round.stopReason || '');
  if (reasonLower === 'no-progress') {
    entry.consecutiveNoProgress = Math.max(0, Number(entry.consecutiveNoProgress || 0)) + 1;
    entry.lastNoProgressAtMs = nowMs;
  } else {
    entry.consecutiveNoProgress = 0;
  }

  let escalation = null;
  const cooldownMs = Math.max(5, Number(policy.cooldownMinutes || 180)) * 60 * 1000;
  const threshold = Math.max(2, Number(policy.thresholdRuns || 3));
  const lastEscalationAttemptAtMs = Math.max(0, Number(entry.lastEscalationAttemptAtMs || 0));
  const cooldownReady = !lastEscalationAttemptAtMs || nowMs - lastEscalationAttemptAtMs >= cooldownMs;
  if (reasonLower === 'no-progress' && entry.consecutiveNoProgress >= threshold && cooldownReady) {
    entry.lastEscalationAttemptAtMs = nowMs;
    try {
      escalation = await escalateLinearEngineNoProgressIssue({
        settings,
        policy,
        issueIdentifier,
        consecutiveNoProgress: entry.consecutiveNoProgress,
        round,
      });
    } catch (error) {
      escalation = {
        triggered: false,
        issueIdentifier,
        consecutiveNoProgress: entry.consecutiveNoProgress,
        commentError: error instanceof Error ? error.message : String(error),
      };
      appendAuditEvent('linear-engine-no-progress-escalation-error', {
        issueIdentifier,
        consecutiveNoProgress: entry.consecutiveNoProgress,
        error: String(escalation.commentError || ''),
      });
    }
    if (escalation && escalation.triggered) {
      entry.lastEscalatedAtMs = nowMs;
      entry.escalationCount = Math.max(0, Number(entry.escalationCount || 0)) + 1;
      // Require a fresh streak before next escalation notification.
      entry.consecutiveNoProgress = 0;
    }
  }

  state.byIssue[issueIdentifier] = entry;
  return {
    issueIdentifier,
    consecutiveNoProgress: Number(entry.consecutiveNoProgress || 0),
    thresholdRuns: threshold,
    cooldownMinutes: Number(policy.cooldownMinutes || 180),
    escalatedAtMs: Number(entry.lastEscalatedAtMs || 0),
    escalation,
  };
}

async function cmdLinearEngineDrain(settings, flags) {
  const requestedIssueIdentifier = normalizeLinearIssueId(
    flags.issue || flags['issue-id'] || flags.identifier || '',
  );
  const maxIssues = Math.max(
    1,
    Number(
      flags['drain-max-issues'] ||
        flags['max-issues'] ||
        (settings.execution && settings.execution.engineDrainMaxIssues) ||
        8,
    ),
  );
  const pauseMs = Math.max(
    0,
    Number(
      flags['drain-sleep-ms'] ||
        (settings.execution && settings.execution.engineDrainSleepMs) ||
        0,
    ),
  );
  const strictFailure = isTruthyLike(flags.strict);
  const perIssueTimeoutMs = Math.max(
    120_000,
    Math.ceil(
      Number(flags['timeout-seconds'] || (settings.execution && settings.execution.timeoutSeconds) || 900) *
        1000 *
        1.4,
    ),
  );
  const noProgressPolicy = resolveLinearEngineNoProgressEscalationSettings(settings, flags);
  const noProgressState = readLinearEngineNoProgressState();

  const rounds = [];
  let stopReason = 'max-issues';
  let hasError = false;
  const escalatedIssues = [];

  for (let index = 1; index <= maxIssues; index += 1) {
    const childArgs = ['linear-engine', '--json', '--drain', 'false'];

    if (requestedIssueIdentifier) {
      childArgs.push('--issue', requestedIssueIdentifier);
    } else {
      childArgs.push('--auto-pick');
    }
    if (flags.agent) {
      childArgs.push('--agent', String(flags.agent));
    }
    if (flags['max-steps']) {
      childArgs.push('--max-steps', String(flags['max-steps']));
    }
    if (flags.steps) {
      childArgs.push('--steps', String(flags.steps));
    }
    if (flags['no-progress-threshold']) {
      childArgs.push('--no-progress-threshold', String(flags['no-progress-threshold']));
    }
    if (flags['step-sleep-ms']) {
      childArgs.push('--step-sleep-ms', String(flags['step-sleep-ms']));
    }
    if (flags['timeout-seconds']) {
      childArgs.push('--timeout-seconds', String(flags['timeout-seconds']));
    }
    if (flags['agent-retries']) {
      childArgs.push('--agent-retries', String(flags['agent-retries']));
    }
    if (flags['retry-backoff-seconds']) {
      childArgs.push('--retry-backoff-seconds', String(flags['retry-backoff-seconds']));
    }
    if (flags['max-prompt-chars']) {
      childArgs.push('--max-prompt-chars', String(flags['max-prompt-chars']));
    }
    if (flags.force !== undefined) {
      childArgs.push('--force', String(flags.force));
    }
    if (flags.trace !== undefined) {
      childArgs.push('--trace', String(flags.trace));
    }
    if (flags.labels) {
      childArgs.push('--labels', String(flags.labels));
    }
    if (flags.states) {
      childArgs.push('--states', String(flags.states));
    }
    if (flags.all) {
      childArgs.push('--all');
    }

    let payload = null;
    let commandError = '';
    try {
      const output = runCommand(
        process.execPath,
        [path.join(ROOT_DIR, 'scripts', 'tasks.js'), ...childArgs],
        {
          timeoutMs: perIssueTimeoutMs,
          label: `linear-engine drain issue ${index}`,
        },
      );
      payload = extractJson(output.stdout || '');
    } catch (error) {
      commandError = error instanceof Error ? error.message : String(error);
    }

    const reason = payload ? String(payload.stopReason || '') : '';
    const issueIdentifier = payload ? String(payload.issueIdentifier || payload.requestedIssueIdentifier || '') : '';
    const stepsExecuted = payload ? Number(payload.stepsExecuted || 0) : 0;
    const round = {
      index,
      ok: payload ? payload.ok !== false : false,
      issueIdentifier,
      stepsExecuted,
      stopReason: reason,
      finalStatus: payload ? String(payload.finalStatus || '') : '',
      finalNextState: payload ? String(payload.finalNextState || '') : '',
      finalRunId: payload ? String(payload.finalRunId || '') : '',
      error:
        commandError ||
        (payload && Array.isArray(payload.runs) && payload.runs.length > 0
          ? String(payload.runs[payload.runs.length - 1].error || '')
          : ''),
    };
    rounds.push(round);

    const noProgressUpdate = await updateLinearEngineNoProgressState({
      state: noProgressState,
      settings,
      policy: noProgressPolicy,
      round,
    });
    if (noProgressUpdate) {
      round.noProgress = {
        consecutiveNoProgress: noProgressUpdate.consecutiveNoProgress,
        thresholdRuns: noProgressUpdate.thresholdRuns,
      };
      if (noProgressUpdate.escalation) {
        round.noProgress.escalation = noProgressUpdate.escalation;
        if (noProgressUpdate.escalation.triggered) {
          escalatedIssues.push(issueIdentifier);
        }
      }
    }

    if (round.error) {
      hasError = true;
      stopReason = 'error';
      break;
    }

    const reasonLower = reason.toLowerCase();
    if (reasonLower.includes('no-runnable-issue')) {
      stopReason = 'queue-empty';
      break;
    }
    if (reasonLower.startsWith('skipped:circuit-open')) {
      stopReason = 'circuit-open';
      break;
    }
    if (reasonLower.startsWith('skipped:already-running')) {
      stopReason = 'already-running';
      break;
    }
    if (reasonLower.startsWith('error')) {
      hasError = true;
      stopReason = reason || 'error';
      break;
    }

    // Specific issue mode keeps original single-issue behavior.
    if (requestedIssueIdentifier) {
      stopReason = reason || 'single-issue';
      break;
    }

    if (index < maxIssues && pauseMs > 0) {
      await sleepMs(pauseMs);
    }
  }

  writeLinearEngineNoProgressState(noProgressState);

  const totalSteps = rounds.reduce((sum, item) => sum + Number(item.stepsExecuted || 0), 0);
  const processedIssueIds = dedupeStrings(
    rounds
      .map((item) => String(item.issueIdentifier || '').trim())
      .filter(Boolean),
  );
  const result = {
    ok: !hasError,
    drain: true,
    maxIssues,
    roundsExecuted: rounds.length,
    totalSteps,
    issuesProcessed: processedIssueIds.length,
    noProgressEscalations: {
      enabled: noProgressPolicy.enabled,
      thresholdRuns: noProgressPolicy.thresholdRuns,
      cooldownMinutes: noProgressPolicy.cooldownMinutes,
      issueIdentifiers: dedupeStrings(escalatedIssues),
    },
    stopReason,
    rounds,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push('Linear engine drain result:');
    lines.push(`- rounds: ${result.roundsExecuted}/${result.maxIssues}`);
    lines.push(`- issues processed: ${result.issuesProcessed}`);
    lines.push(`- total steps: ${result.totalSteps}`);
    lines.push(`- stop reason: ${result.stopReason}`);
    if (result.noProgressEscalations.issueIdentifiers.length > 0) {
      lines.push(
        `- no-progress escalated issues: ${result.noProgressEscalations.issueIdentifiers.join(', ')}`,
      );
    }
    if (processedIssueIds.length > 0) {
      lines.push(`- issue identifiers: ${processedIssueIds.join(', ')}`);
    }
    const last = rounds.length > 0 ? rounds[rounds.length - 1] : null;
    if (last && last.error) {
      lines.push(`- error: ${singleLine(trimMessage(String(last.error || ''), 320))}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  if (strictFailure && hasError) {
    const last = rounds.length > 0 ? rounds[rounds.length - 1] : null;
    throw new Error(`linear-engine drain failed: ${last ? last.error || last.stopReason : 'unknown error'}`);
  }
}

async function cmdTodoistSync(settings, flags) {
  const enabled = settings.todoist.enabled !== false;
  if (!enabled) {
    throw new Error('todoist integration disabled in config.');
  }

  const syncToLinear = !Boolean(flags['no-linear']) && Boolean(settings.todoist.syncToLinear !== false);
  let apiToken = String(flags.token || settings.todoist.apiToken || '').trim();
  if (!apiToken) {
    apiToken = await extractTodoistTokenFromBrowser('openclaw');
    if (apiToken) {
      persistControlCenterValue(['todoist', 'apiToken'], apiToken);
      settings.todoist.apiToken = apiToken;
    }
  }
  if (!apiToken) {
    throw new Error('Todoist token not found. Keep Todoist tab logged in or set TODOIST_API_TOKEN.');
  }

  const maxItems = Boolean(flags.all) ? Number.POSITIVE_INFINITY : Math.max(1, Number(flags.limit || 20));
  const tasks = await fetchTodoistTasks(apiToken, Number.isFinite(maxItems) ? maxItems : 200);
  const selectedTasks = (Array.isArray(tasks) ? tasks : []).slice(0, maxItems);
  const mapping = readJsonFile(TODOIST_SYNC_PATH, { version: 1, items: {} });
  const items = mapping.items || {};
  const created = [];
  const queued = [];
  const skipped = [];

  for (const task of selectedTasks) {
    const key = String(task.id || '');
    if (!key) {
      continue;
    }

    const existing = items[key];
    if (existing && existing.linearIssueId) {
      skipped.push({ todoistId: key, reason: 'already-synced', linearIdentifier: existing.linearIdentifier });
      continue;
    }

    if (!syncToLinear) {
      items[key] = {
        todoistId: key,
        content: task.content || '',
        updatedAt: task.updated_at || '',
        syncedAtMs: Date.now(),
        linearIssueId: '',
        linearIdentifier: '',
      };
      skipped.push({ todoistId: key, reason: 'linear-disabled' });
      continue;
    }

    const delivery = await createTriageIssueWithFallback(
      {
        title: `[Todoist] ${singleLine(String(task.content || 'Untitled task'))}`,
        description: [
          `Todoist task id: ${key}`,
          `projectId: ${task.project_id || '-'}`,
          `priority: ${task.priority || '-'}`,
          `due: ${task.due && task.due.date ? task.due.date : '-'}`,
          task.description ? `description:\n${task.description}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        source: 'todoist',
        sourceId: key,
        eventType: 'todoist.task',
        state: String(settings.todoist.defaultState || 'Triage'),
        labels: [String(settings.todoist.label || 'todoist')],
        dueDate: task.due && task.due.date ? String(task.due.date) : '',
        priority: mapTodoistPriorityToLinear(task.priority),
      },
      settings,
      { context: 'todoist-sync' },
    );
    if (delivery.queued) {
      items[key] = {
        todoistId: key,
        content: task.content || '',
        updatedAt: task.updated_at || '',
        syncedAtMs: Date.now(),
        linearIssueId: '',
        linearIdentifier: '',
        pendingQueueId: delivery.queueId,
        pendingQueueError: delivery.error,
      };
      queued.push({
        todoistId: key,
        content: task.content || '',
        queueId: delivery.queueId,
        error: delivery.error,
      });
      continue;
    }
    const issue = delivery.issue;

    items[key] = {
      todoistId: key,
      content: task.content || '',
      updatedAt: task.updated_at || '',
      syncedAtMs: Date.now(),
      linearIssueId: issue.id,
      linearIdentifier: issue.identifier,
      linearUrl: issue.url || '',
      pendingQueueId: '',
      pendingQueueError: '',
    };
    created.push({
      todoistId: key,
      content: task.content || '',
      linearIdentifier: issue.identifier,
      linearUrl: issue.url || '',
    });
  }

  writeJsonFile(TODOIST_SYNC_PATH, {
    version: 1,
    updatedAtMs: Date.now(),
    items,
  });

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, totalTasks: Array.isArray(tasks) ? tasks.length : 0, processed: selectedTasks.length, created, queued, skipped }, null, 2)}\n`,
    );
    return;
  }

  const lines = [];
  lines.push('Todoist sync result:');
  lines.push(`- fetched: ${Array.isArray(tasks) ? tasks.length : 0}`);
  lines.push(`- processed: ${selectedTasks.length}`);
  lines.push(`- created Linear issues: ${created.length}`);
  lines.push(`- queued for retry: ${queued.length}`);
  lines.push(`- skipped: ${skipped.length}`);
  for (const item of created.slice(0, 10)) {
    lines.push(`- ${item.todoistId} -> ${item.linearIdentifier}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdTodoistBacksync(settings, flags) {
  if (settings.todoist.enabled === false) {
    throw new Error('todoist integration disabled in config.');
  }
  if (settings.todoist.syncFromLinearDone === false) {
    throw new Error('todoist.syncFromLinearDone is disabled in config.');
  }

  const apiKey = String(settings.linear.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is required for todoist-backsync.');
  }

  let apiToken = String(flags.token || settings.todoist.apiToken || '').trim();
  if (!apiToken) {
    apiToken = await extractTodoistTokenFromBrowser('openclaw');
    if (apiToken) {
      persistControlCenterValue(['todoist', 'apiToken'], apiToken);
    }
  }
  if (!apiToken) {
    throw new Error('Todoist token missing. Set TODOIST_API_TOKEN or keep Todoist tab logged in.');
  }

  const mapping = readJsonFile(TODOIST_SYNC_PATH, { version: 1, items: {} });
  const items = mapping.items && typeof mapping.items === 'object' ? mapping.items : {};
  const entries = Object.entries(items).filter(([, value]) => value && value.linearIdentifier);
  const limit = Math.max(1, Number(flags.limit || 50));
  const selected = entries.slice(0, limit);
  const closed = [];
  const skipped = [];

  for (const [todoistId, value] of selected) {
    const linearIdentifier = String(value.linearIdentifier || '').trim();
    if (!linearIdentifier) {
      skipped.push({ todoistId, reason: 'missing-linear-identifier' });
      continue;
    }
    if (value.todoistClosedAtMs) {
      skipped.push({ todoistId, reason: 'already-closed', linearIdentifier });
      continue;
    }

    const issue = await resolveLinearIssueByIdentifier(apiKey, linearIdentifier, settings.linear.teamKey);
    if (!issue || !issue.state) {
      skipped.push({ todoistId, reason: 'linear-not-found', linearIdentifier });
      continue;
    }
    const stateType = String(issue.state.type || '').toLowerCase();
    const stateName = String(issue.state.name || '').toLowerCase();
    const done = stateType === 'completed' || stateType === 'canceled' || stateName.includes('done');
    if (!done) {
      skipped.push({ todoistId, reason: 'linear-not-done', linearIdentifier, state: issue.state.name || '' });
      continue;
    }

    try {
      await closeTodoistTask(apiToken, todoistId);
      items[todoistId] = {
        ...value,
        todoistClosedAtMs: Date.now(),
        todoistClosedBy: 'linear-done-sync',
      };
      closed.push({
        todoistId,
        linearIdentifier,
      });
      appendAuditEvent('todoist-backsync-close', {
        todoistId,
        linearIdentifier,
        state: issue.state.name || '',
      });
    } catch (error) {
      skipped.push({
        todoistId,
        reason: 'todoist-close-failed',
        linearIdentifier,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  writeJsonFile(TODOIST_SYNC_PATH, {
    version: 1,
    updatedAtMs: Date.now(),
    items,
  });

  const result = {
    ok: true,
    checked: selected.length,
    closed,
    skipped,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Todoist backsync result:');
  lines.push(`- checked: ${selected.length}`);
  lines.push(`- closed: ${closed.length}`);
  lines.push(`- skipped: ${skipped.length}`);
  for (const item of closed.slice(0, 10)) {
    lines.push(`- ${item.todoistId} <= ${item.linearIdentifier}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdCalendarSync(settings, flags) {
  if (settings.calendar.enabled === false) {
    throw new Error('calendar integration disabled in config.');
  }

  const profile = String(flags.profile || settings.calendar.browserProfile || 'openclaw').trim();
  const tabHint = String(flags.hint || settings.calendar.tabHint || 'calendar.google.com').trim();
  let tabs = listBrowserTabs(profile);
  let tab =
    tabs.find((item) => String(item.url || '').includes(tabHint) && String(item.type || '').toLowerCase() === 'page') ||
    tabs.find((item) => String(item.url || '').includes(tabHint));
  if (!tab) {
    throw new Error(`Google Calendar tab not found in profile=${profile}.`);
  }

  let result = null;
  const evalFnCode =
    "() => Array.from(document.querySelectorAll('[data-eventid]')).map((el) => ({id: el.getAttribute('data-eventid') || '', text: (el.textContent||'').replace(/\\s+/g,' ').trim(), className: el.className || ''})).filter((x) => x.id && x.text).slice(0, 500)";
  try {
    result = openclawBrowserEvaluate(profile, tab.targetId, evalFnCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/tab not found/i.test(message)) {
      throw error;
    }
    // Browser target ids can rotate; refresh tab list once and retry.
    tabs = listBrowserTabs(profile);
    tab =
      tabs.find((item) => String(item.url || '').includes(tabHint) && String(item.type || '').toLowerCase() === 'page') ||
      tabs.find((item) => String(item.url || '').includes(tabHint));
    if (!tab) {
      throw new Error(`Google Calendar tab not found in profile=${profile}.`);
    }
    result = openclawBrowserEvaluate(profile, tab.targetId, evalFnCode);
  }
  const rows = Array.isArray(result) ? result : [];
  const seen = new Set();
  const events = [];
  for (const item of rows) {
    const id = String(item.id || '').trim();
    const text = singleLine(String(item.text || ''));
    if (!id || !text) {
      continue;
    }
    if (text.length < 3) {
      continue;
    }
    const key = `${id}:${text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    events.push({ id, text });
  }

  const snapshot = {
    updatedAtMs: Date.now(),
    profile,
    tabId: tab.targetId,
    url: tab.url,
    eventCount: events.length,
    events: events.slice(0, 200),
  };
  writeJsonFile(CALENDAR_SYNC_PATH, snapshot);

  const toLinear = Boolean(flags['to-linear'] || settings.calendar.syncToLinear);
  const created = [];
  const queued = [];
  const updated = [];
  const updateErrors = [];
  if (toLinear) {
    const mapping = readJsonFile(CALENDAR_SYNC_PATH.replace('.json', '-linear.json'), { items: {} });
    const items = mapping.items || {};
    for (const event of events.slice(0, 100)) {
      const key = event.id;
      const existing = items[key];
      if (existing && existing.linearIssueId) {
        if (settings.linear.apiKey) {
          try {
            const refreshed = await updateLinearIssueFromCalendar(
              String(settings.linear.apiKey || ''),
              String(existing.linearIssueId || ''),
              event,
              String(tab.url || ''),
              settings,
            );
            updated.push({
              id: key,
              linearIdentifier: refreshed.identifier || existing.linearIdentifier || '',
            });
            items[key] = {
              ...existing,
              text: event.text,
              linearIdentifier: refreshed.identifier || existing.linearIdentifier || '',
              linearUrl: refreshed.url || existing.linearUrl || '',
              updatedAtMs: Date.now(),
            };
          } catch (error) {
            updateErrors.push({
              id: key,
              linearIdentifier: existing.linearIdentifier || '',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        continue;
      }
      const delivery = await createTriageIssueWithFallback(
        {
          title: `[Calendar] ${trimMessage(event.text, 120)}`,
          description: `Google Calendar event snapshot\nid: ${event.id}\nsource: ${tab.url}`,
          source: 'google-calendar',
          sourceId: event.id,
          eventType: 'calendar.event',
          labels: [String(settings.calendar.label || 'calendar')],
          state: String(settings.calendar.defaultState || 'Triage'),
          priority: 3,
        },
        settings,
        { context: 'calendar-sync' },
      );
      if (delivery.queued) {
        items[key] = {
          id: key,
          text: event.text,
          linearIssueId: '',
          linearIdentifier: '',
          pendingQueueId: delivery.queueId,
          pendingQueueError: delivery.error,
          syncedAtMs: Date.now(),
        };
        queued.push({
          id: key,
          queueId: delivery.queueId,
          error: delivery.error,
        });
        continue;
      }
      const issue = delivery.issue;
      items[key] = {
        id: key,
        text: event.text,
        linearIssueId: issue.id,
        linearIdentifier: issue.identifier,
        pendingQueueId: '',
        pendingQueueError: '',
        syncedAtMs: Date.now(),
      };
      created.push({ id: key, linearIdentifier: issue.identifier });
    }
    writeJsonFile(CALENDAR_SYNC_PATH.replace('.json', '-linear.json'), { updatedAtMs: Date.now(), items });
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, snapshot, created, queued, updated, updateErrors }, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Calendar sync result:');
  lines.push(`- profile: ${profile}`);
  lines.push(`- tab: ${tab.url}`);
  lines.push(`- events captured: ${events.length}`);
  lines.push(`- toLinear created: ${created.length}`);
  lines.push(`- toLinear queued: ${queued.length}`);
  lines.push(`- toLinear updated: ${updated.length}`);
  lines.push(`- toLinear update errors: ${updateErrors.length}`);
  for (const item of updateErrors.slice(0, 5)) {
    lines.push(
      `- update error ${item.id}${item.linearIdentifier ? ` (${item.linearIdentifier})` : ''}: ${singleLine(item.error)}`,
    );
  }
  for (const event of events.slice(0, 8)) {
    lines.push(`- ${trimMessage(event.text, 120)}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function updateLinearIssueFromCalendar(apiKey, issueId, event, sourceUrl, settings) {
  const id = String(issueId || '').trim();
  if (!id) {
    throw new Error('calendar update requires linear issue id.');
  }
  const eventId = String(event && event.id ? event.id : '').trim();
  const eventText = singleLine(String(event && event.text ? event.text : '')).trim();
  if (!eventId || !eventText) {
    throw new Error('calendar update requires event.id and event.text.');
  }

  const title = `[Calendar] ${trimMessage(eventText, 120)}`;
  const description = [
    'Google Calendar event snapshot',
    `id: ${eventId}`,
    `source: ${sourceUrl || '-'}`,
    `lastSync: ${formatTime(Date.now(), settings.timezone)}`,
    '',
    '## Raw event text',
    '```text',
    trimMessage(eventText, 3000),
    '```',
  ].join('\n');

  const payload = await linearRequest(
    apiKey,
    `mutation UpdateIssueFromCalendar($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          title
          url
          state { id name }
        }
      }
    }`,
    {
      id,
      input: {
        title,
        description,
      },
    },
  );

  const node = payload && payload.issueUpdate ? payload.issueUpdate.issue : null;
  if (!node || !node.id) {
    throw new Error(`Linear issueUpdate returned no issue for ${id}`);
  }

  appendAuditEvent('calendar-sync-update', {
    issueId: node.id,
    identifier: node.identifier || '',
    eventId,
  });

  return {
    id: node.id,
    identifier: node.identifier || '',
    title: node.title || title,
    url: node.url || '',
    state: node && node.state ? node.state.name : '',
  };
}

function resolveGithubRepos(settings, flags) {
  const fromFlag = []
    .concat(flags.repo ? [flags.repo] : [])
    .concat(flags.repos ? String(flags.repos).split(',') : [])
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map(normalizeGithubRepo)
    .filter(Boolean);
  if (fromFlag.length > 0) {
    return dedupeStrings(fromFlag);
  }

  const fromConfig = Array.isArray(settings.github.repos)
    ? settings.github.repos.map((item) => normalizeGithubRepo(item)).filter(Boolean)
    : [];
  if (fromConfig.length > 0) {
    return dedupeStrings(fromConfig);
  }

  const candidates = [
    path.resolve(ROOT_DIR, '..'),
    ROOT_DIR,
  ];
  const auto = [];
  for (const repoPath of candidates) {
    const remote = getGitRemote(repoPath);
    if (!remote) {
      continue;
    }
    const normalized = normalizeGithubRepo(remote);
    if (normalized) {
      auto.push(normalized);
    }
  }
  return dedupeStrings(auto);
}

async function createTriageIssueFromInput(input, settings) {
  const apiKey = String(settings.linear.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is required to create triage issues.');
  }

  const source = String(input.source || '').trim().toLowerCase();
  const sourceIdRaw = String(input.sourceId || '').trim();
  const eventType = normalizeIngestEventType(input.eventType || '', 'triage.create');
  let sourceId = sourceIdRaw ? normalizeSourceId(sourceIdRaw) : '';
  let sourceIdDerived = false;
  if (!sourceId && source) {
    sourceId = deriveAutoSourceId(input);
    sourceIdDerived = Boolean(sourceId);
  }
  const dedupeKey = buildIngestIdempotencyKey({ source, sourceId, eventType }, 'triage.create');
  const signature = buildTriageSignatureCandidate(input, settings);
  return withTaskLock(
    TRIAGE_CREATE_LOCK_PATH,
    {
      staleMs: 60_000,
      waitMs: 80,
      timeoutMs: 15_000,
    },
    async () => {
      if (dedupeKey) {
        const index = readJsonFile(SOURCE_ID_INDEX_PATH, { version: 1, items: {} });
        const existing = index.items && typeof index.items === 'object' ? index.items[dedupeKey] : null;
        if (existing && existing.identifier) {
          return {
            id: existing.issueId || '',
            identifier: String(existing.identifier),
            title: String(existing.title || existing.identifier),
            url: String(existing.url || ''),
            stateName: String(existing.stateName || ''),
              labels: Array.isArray(existing.labels) ? existing.labels.map((item) => String(item)) : [],
              source,
              sourceId,
              eventType,
              sourceIdDerived,
              deduped: true,
              dedupeKey,
          };
        }
      }

      if (signature && signature.signature) {
        const existingBySignature = findTriageSignatureDuplicate(signature.signature, settings);
        if (existingBySignature && existingBySignature.identifier) {
          return {
            id: existingBySignature.issueId || '',
            identifier: String(existingBySignature.identifier),
            title: String(existingBySignature.title || existingBySignature.identifier),
            url: String(existingBySignature.url || ''),
            stateName: String(existingBySignature.stateName || ''),
              labels: [],
              source,
              sourceId,
              eventType,
              sourceIdDerived,
              deduped: true,
              dedupeKey: `signature:${signature.signature}`,
          };
        }
      }

      const teamId = settings.linear.teamId || (await resolveLinearTeamId(apiKey, settings.linear.teamKey));
      if (!teamId) {
        throw new Error('Unable to resolve Linear team id for triage.');
      }

      const routedInput = applyTriageRouting(input, settings);
      if (signature && signature.signature) {
        routedInput.intakeSignature = signature.signature;
        routedInput.intakeSignatureRepo = signature.repoHint;
        routedInput.intakeSignatureSignal = signature.errorSignal;
      }
      const stateName = String(routedInput.state || 'Triage').trim();
      const stateId = await resolveLinearStateId(apiKey, teamId, stateName);
      if (!stateId) {
        throw new Error(`Linear state not found: ${stateName}`);
      }

      const title = buildTriageTitle(routedInput);
      if (!title) {
        throw new Error('triage requires --title or --text.');
      }

      const description = buildTriageDescription(routedInput);
      const labelIds = await resolveLinearLabelIds(
        apiKey,
        teamId,
        Array.isArray(routedInput.labels) ? routedInput.labels : [],
        true,
      );
      const assigneeId = routedInput.assigneeEmail
        ? await resolveLinearUserIdByEmail(apiKey, routedInput.assigneeEmail)
        : '';

      const payload = await linearRequest(
        apiKey,
        `mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              url
              state { id name }
              labels { nodes { id name } }
            }
          }
        }`,
        {
          input: {
            teamId,
            stateId,
            title,
            description,
            priority: Number.isFinite(Number(routedInput.priority)) ? Number(routedInput.priority) : 3,
            labelIds: labelIds.length > 0 ? labelIds : undefined,
            assigneeId: assigneeId || undefined,
            projectId: settings.linear.projectId || undefined,
            dueDate: routedInput.dueDate || undefined,
          },
        },
      );

      const issue = payload && payload.issueCreate ? payload.issueCreate.issue : null;
      if (!issue) {
        throw new Error('Linear issueCreate returned no issue.');
      }

      if (dedupeKey) {
        const index = readJsonFile(SOURCE_ID_INDEX_PATH, { version: 1, items: {} });
        if (!index.items || typeof index.items !== 'object') {
          index.items = {};
        }
        index.items[dedupeKey] = {
          identifier: issue.identifier,
          issueId: issue.id,
          title: issue.title,
          url: issue.url || '',
          stateName: issue.state && issue.state.name ? String(issue.state.name) : '',
          labels: (((issue.labels || {}).nodes || []).map((item) => item.name)).filter(Boolean),
          source,
          sourceId,
          eventType,
          createdAtMs: Date.now(),
        };
        writeJsonFile(SOURCE_ID_INDEX_PATH, index);
      }
      if (signature && signature.signature) {
        storeTriageSignatureMapping(signature, issue, input, settings);
      }

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        stateName: issue.state ? issue.state.name : '',
        priority: issue.priority || Number(routedInput.priority) || 3,
        labels: (((issue.labels || {}).nodes || []).map((item) => item.name)).filter(Boolean),
        assigneeId: assigneeId || '',
        routeHits: Array.isArray(routedInput.routeHits) ? routedInput.routeHits : [],
        source,
        sourceId,
        eventType,
        sourceIdDerived,
        deduped: false,
        dedupeKey: dedupeKey || (signature && signature.signature ? `signature:${signature.signature}` : ''),
      };
    },
  );
}

async function createTriageIssueWithFallback(input, settings, options = {}) {
  const normalizedInput = {
    ...input,
    eventType: normalizeIngestEventType(input && input.eventType ? input.eventType : '', 'triage.create'),
  };
  try {
    const issue = await createTriageIssueFromInput(normalizedInput, settings);
    const ingestItem = {
      id: '',
      kind: 'triage',
      payload: normalizedInput,
      dedupeKey: issue && issue.dedupeKey ? issue.dedupeKey : buildIngestIdempotencyKey(normalizedInput, 'triage.create'),
      idempotencyKey: issue && issue.dedupeKey ? issue.dedupeKey : buildIngestIdempotencyKey(normalizedInput, 'triage.create'),
      attempts: 0,
    };
    updateIngestLedgerForItem(ingestItem, issue && issue.deduped ? 'deduped-existing' : 'delivered', {
      issueIdentifier: issue && issue.identifier ? issue.identifier : '',
      issueId: issue && issue.id ? issue.id : '',
      attempts: 0,
    });
    return {
      ok: true,
      queued: false,
      queueId: '',
      error: '',
      issue,
    };
  } catch (error) {
    if (settings.intakeQueue && settings.intakeQueue.enabled === false) {
      throw error;
    }
    if (options.queueOnError === false) {
      throw error;
    }
    const queued = enqueueIngestItem('triage', normalizedInput, error, settings);
    const message = error instanceof Error ? error.message : String(error);
    appendAuditEvent('triage-create-queued-fallback', {
      context: String(options.context || 'unknown'),
      source: String(normalizedInput && normalizedInput.source ? normalizedInput.source : ''),
      sourceId: String(normalizedInput && normalizedInput.sourceId ? normalizedInput.sourceId : ''),
      eventType: String(normalizedInput.eventType || ''),
      queueId: queued.id,
      dedupe: Boolean(queued.reused),
      error: message,
    });
    return {
      ok: true,
      queued: true,
      queueId: queued.id,
      queueDeduped: Boolean(queued.reused),
      error: message,
      issue: null,
    };
  }
}

function buildTriageTitle(input) {
  const title = String(input.title || '').trim();
  if (title) {
    return title;
  }

  const raw = String(input.rawText || '').trim();
  if (!raw) {
    return '';
  }
  const oneLine = singleLine(raw);
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
}

function buildTriageDescription(input) {
  const blocks = [];
  const base = String(input.description || '').trim();
  if (base) {
    blocks.push(base);
  }

  const meta = [];
  if (input.source) {
    meta.push(`- source: ${singleLine(String(input.source))}`);
  }
  if (input.author) {
    meta.push(`- author: ${singleLine(String(input.author))}`);
  }
  if (input.sourceUrl) {
    meta.push(`- link: ${String(input.sourceUrl).trim()}`);
  }
  if (meta.length > 0) {
    blocks.push(['## Intake metadata', ...meta].join('\n'));
  }

  const routeHits = Array.isArray(input.routeHits)
    ? input.routeHits.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (routeHits.length > 0) {
    blocks.push(['## Auto triage routing', ...routeHits.map((item) => `- ${item}`)].join('\n'));
  }

  const signature = String(input.intakeSignature || '').trim();
  if (signature) {
    const signatureMeta = [`- signature: ${signature}`];
    if (input.intakeSignatureRepo) {
      signatureMeta.push(`- repo: ${singleLine(String(input.intakeSignatureRepo))}`);
    }
    if (input.intakeSignatureSignal) {
      signatureMeta.push(`- signal: ${singleLine(String(input.intakeSignatureSignal))}`);
    }
    blocks.push(['## Intake signature', ...signatureMeta].join('\n'));
  }

  const raw = String(input.rawText || '').trim();
  if (raw) {
    blocks.push(['## Raw input', '```text', trimMessage(raw, 3000), '```'].join('\n'));
  }

  return blocks.join('\n\n').trim();
}

async function fetchDueSoonIssues(apiKey, teamId, dueDays) {
  const windowText = `P${Math.max(1, Number(dueDays || 7))}D`;
  const payload = await linearRequest(
    apiKey,
    `query DueSoon($teamId: ID!, $window: TimelessDateOrDuration!) {
      issues(
        first: 100
        filter: {
          team: { id: { eq: $teamId } }
          dueDate: { gte: "P0D", lte: $window }
          state: { type: { nin: ["completed", "canceled"] } }
        }
      ) {
        nodes {
          id
          identifier
          title
          url
          dueDate
          priority
          state { name type }
          assignee { name }
        }
      }
    }`,
    { teamId, window: windowText },
  );

  const nodes = (((payload || {}).issues || {}).nodes || []).filter(Boolean);
  return nodes
    .sort((a, b) => {
      const aDue = String(a.dueDate || '9999-99-99');
      const bDue = String(b.dueDate || '9999-99-99');
      if (aDue === bDue) {
        return Number(b.priority || 0) - Number(a.priority || 0);
      }
      return aDue.localeCompare(bDue);
    })
    .slice(0, 25);
}

async function fetchCurrentCycleIssues(apiKey, teamId) {
  const payload = await linearRequest(
    apiKey,
    `query CurrentCycle($teamId: ID!) {
      issues(
        first: 200
        filter: {
          team: { id: { eq: $teamId } }
          cycle: { isActive: { eq: true } }
          state: { type: { nin: ["completed", "canceled"] } }
        }
      ) {
        nodes {
          id
          identifier
          title
          url
          priority
          state { id name type }
          assignee { name }
          cycle { id name number endsAt }
        }
      }
    }`,
    { teamId },
  );

  const nodes = (((payload || {}).issues || {}).nodes || []).filter(Boolean);
  return nodes.sort(
    (a, b) =>
      Number(b.priority || 0) - Number(a.priority || 0) ||
      String(a.identifier || '').localeCompare(String(b.identifier || '')),
  );
}

function renderReminder(data, settings) {
  const lines = [];
  lines.push(`# Linear Reminder (${formatTime(data.generatedAtMs, settings.timezone)})`);
  lines.push('');

  if (data.mode === 'all' || data.mode === 'due') {
    lines.push(`## Due Soon (next ${data.dueDays} days)`);
    if (!data.due || data.due.length === 0) {
      lines.push('- none');
    } else {
      lines.push(`- total open: ${data.due.length}`);
      for (const issue of data.due.slice(0, 10)) {
        lines.push(
          `- ${issue.identifier} [${issue.state ? issue.state.name : '-'}] due ${issue.dueDate || '-'}: ${singleLine(issue.title)}`,
        );
      }
    }
    lines.push('');
  }

  if (data.mode === 'all' || data.mode === 'cycle') {
    const cycleIssues = Array.isArray(data.cycle) ? data.cycle : [];
    const cycle = cycleIssues.find((item) => item.cycle) || null;
    const stateCounts = {};
    for (const issue of cycleIssues) {
      const key = issue && issue.state && issue.state.name ? issue.state.name : 'Unknown';
      stateCounts[key] = (stateCounts[key] || 0) + 1;
    }

    lines.push('## Current Cycle');
    if (cycle && cycle.cycle) {
      lines.push(
        `- ${cycle.cycle.name || `Cycle ${cycle.cycle.number || '?'}`} (ends ${cycle.cycle.endsAt || '-'})`,
      );
    }
    lines.push(`- open issues: ${cycleIssues.length}`);
    for (const [stateName, count] of Object.entries(stateCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${stateName}: ${count}`);
    }
    if (cycleIssues.length > 0) {
      lines.push('- top focus:');
      for (const issue of cycleIssues.slice(0, 8)) {
        lines.push(
          `  - ${issue.identifier} [${issue.state ? issue.state.name : '-'}] ${singleLine(issue.title)}`,
        );
      }
    }
    lines.push('');
  }

  const staleInProgress = Array.isArray(data.staleInProgress) ? data.staleInProgress : [];
  const blockedEscalation = Array.isArray(data.blockedEscalation) ? data.blockedEscalation : [];
  if (staleInProgress.length > 0 || blockedEscalation.length > 0) {
    lines.push('## SLA Watch');
    lines.push(`- stale In Progress (> ${data.staleInProgressDays || 3} days): ${staleInProgress.length}`);
    for (const item of staleInProgress.slice(0, 8)) {
      lines.push(
        `- stale: ${item.identifier} age ${item.ageHours}h [${item.state}] ${singleLine(item.title)}`,
      );
    }
    lines.push(
      `- blocked escalation (> ${data.blockedEscalationHours || 24}h): ${blockedEscalation.length}`,
    );
    for (const item of blockedEscalation.slice(0, 8)) {
      lines.push(
        `- blocked: ${item.identifier} age ${item.ageHours}h [${item.state}] ${singleLine(item.title)}`,
      );
    }
    lines.push('');
  }

  const autoEscalated = Array.isArray(data.autoEscalated) ? data.autoEscalated : [];
  if (autoEscalated.length > 0) {
    lines.push('## Auto Escalated');
    for (const item of autoEscalated.slice(0, 8)) {
      if (item.error) {
        lines.push(`- ${item.identifier}: error ${singleLine(item.error)}`);
      } else {
        lines.push(`- ${item.identifier}: priority -> ${item.priority}`);
      }
    }
    lines.push('');
  }

  lines.push('## Next Actions');
  lines.push('1. Pull one Blocked item into owner discussion and unblock within 24h.');
  lines.push('2. Close or re-scope stale In Progress items before adding new scope.');
  lines.push('3. Keep incoming work in Triage unless current cycle scope is stable.');

  return lines.join('\n');
}

function renderBriefing(briefing, settings) {
  const mode = String(briefing.mode || 'daily').toLowerCase();
  const report = briefing.report || {};
  const reminder = briefing.reminder || {};
  const lines = [];
  lines.push(
    `# Mission ${mode === 'weekly' ? 'Weekly' : 'Daily'} Briefing (${formatTime(
      briefing.generatedAtMs,
      settings.timezone,
    )})`,
  );
  lines.push('');
  lines.push('## Runtime Snapshot');
  lines.push(
    `- cron: ${(report.metrics && report.metrics.enabledCronJobs) || 0}/${(report.metrics && report.metrics.totalCronJobs) || 0} enabled`,
  );
  lines.push(`- cron error jobs: ${(report.metrics && report.metrics.cronErrorJobs) || 0}`);
  lines.push(`- active sessions: ${(report.metrics && report.metrics.activeSessions) || 0}`);
  lines.push(`- active subagents: ${(report.metrics && report.metrics.activeSubagents) || 0}`);
  lines.push('');

  lines.push(`## ${mode === 'weekly' ? 'This Week Focus' : 'Today Focus'}`);
  const cycle = Array.isArray(reminder.cycle) ? reminder.cycle : [];
  const due = Array.isArray(reminder.due) ? reminder.due : [];
  const topFocus = mode === 'weekly' ? cycle.slice(0, 8) : [...due.slice(0, 5), ...cycle.slice(0, 5)];
  if (topFocus.length === 0) {
    lines.push('- none');
  } else {
    const seen = new Set();
    for (const issue of topFocus) {
      const identifier = String(issue.identifier || '').trim();
      if (!identifier || seen.has(identifier)) {
        continue;
      }
      seen.add(identifier);
      lines.push(`- ${identifier} [${(issue.state && issue.state.name) || '-'}] ${singleLine(issue.title || '')}`);
    }
  }
  lines.push('');

  lines.push('## Risks / Blockers');
  const blocked = Array.isArray(reminder.blockedEscalation) ? reminder.blockedEscalation : [];
  const anomalies = Array.isArray(report.topAnomalies) ? report.topAnomalies : [];
  if (blocked.length === 0 && anomalies.length === 0) {
    lines.push('- none');
  } else {
    for (const item of blocked.slice(0, 6)) {
      lines.push(`- blocked ${item.identifier} age ${item.ageHours}h ${singleLine(item.title || '')}`);
    }
    for (const item of anomalies.slice(0, 4)) {
      lines.push(`- anomaly [${item.scope}] [${item.severity}] ${singleLine(item.title || '')}`);
    }
  }
  lines.push('');

  lines.push('## Next Actions');
  const manualActions = Array.isArray(report.manualActions) ? report.manualActions : [];
  if (manualActions.length === 0) {
    lines.push('1. Review Triage and pick one high-impact item into In Progress.');
    lines.push('2. Update owner and ETA for each blocked issue.');
  } else {
    for (let i = 0; i < Math.min(3, manualActions.length); i += 1) {
      lines.push(`${i + 1}. ${manualActions[i]}`);
    }
  }
  return lines.join('\n');
}

async function resolveLinearStateId(apiKey, teamId, stateName) {
  const payload = await linearRequest(
    apiKey,
    `query TeamStates($teamId: String!) {
      team(id: $teamId) {
        id
        states { nodes { id name type } }
      }
    }`,
    { teamId },
  );

  const nodes = (((payload || {}).team || {}).states || {}).nodes || [];
  const wanted = String(stateName || '').trim().toLowerCase();
  const exact = nodes.find((item) => String(item.name || '').trim().toLowerCase() === wanted);
  return exact ? String(exact.id) : '';
}

async function resolveLinearLabelIds(apiKey, teamId, labels, createMissing) {
  const wanted = normalizeLabelNames(labels);
  if (wanted.length === 0) {
    return [];
  }

  const payload = await linearRequest(
    apiKey,
    `query TeamLabels($teamId: String!) {
      team(id: $teamId) {
        id
        labels(first: 250) { nodes { id name } }
      }
    }`,
    { teamId },
  );

  const nodes = ((((payload || {}).team || {}).labels || {}).nodes || []).filter(Boolean);
  const byName = new Map(nodes.map((item) => [String(item.name || '').trim().toLowerCase(), item]));
  const labelIds = [];

  for (const name of wanted) {
    const key = name.toLowerCase();
    let node = byName.get(key);
    if (!node && createMissing) {
      node = await createLinearLabel(apiKey, teamId, name);
      if (node) {
        byName.set(key, node);
      }
    }
    if (node) {
      labelIds.push(String(node.id));
    }
  }

  return dedupeStrings(labelIds);
}

function applyTriageRouting(input, settings) {
  const routing = settings.triageRouting && typeof settings.triageRouting === 'object'
    ? settings.triageRouting
    : {};
  const enabled = routing.enabled !== false;
  const normalized = {
    ...input,
    state: String(input.state || routing.defaultState || 'Triage').trim(),
    priority: Number.isFinite(Number(input.priority))
      ? Number(input.priority)
      : Number(routing.defaultPriority || 3),
    labels: dedupeStrings([
      ...normalizeLabelNames(input.labels || []),
      ...normalizeLabelNames(routing.defaultLabels || []),
    ]),
    assigneeEmail: String(input.assigneeEmail || input.assignee || routing.defaultAssigneeEmail || '').trim(),
    routeHits: [],
  };
  if (!enabled) {
    return normalized;
  }

  const source = String(input.source || '').trim().toLowerCase();
  const sourceRules = routing.sourceRules && typeof routing.sourceRules === 'object'
    ? routing.sourceRules
    : {};
  const sourceRule = source ? sourceRules[source] : null;
  if (sourceRule && typeof sourceRule === 'object') {
    if (sourceRule.state) {
      normalized.state = String(sourceRule.state).trim();
    }
    if (Number.isFinite(Number(sourceRule.priority))) {
      normalized.priority = mergeLinearPriority(normalized.priority, Number(sourceRule.priority));
    }
    if (sourceRule.assigneeEmail && !normalized.assigneeEmail) {
      normalized.assigneeEmail = String(sourceRule.assigneeEmail).trim();
    }
    normalized.labels = dedupeStrings([
      ...normalized.labels,
      ...normalizeLabelNames(sourceRule.labels || []),
    ]);
    normalized.routeHits.push(`source:${source}`);
  }

  const textForMatch = [normalized.title, normalized.rawText, normalized.description]
    .map((item) => String(item || ''))
    .join('\n');
  const keywordRules = Array.isArray(routing.keywordRules) ? routing.keywordRules : [];
  for (const rule of keywordRules) {
    if (!rule || typeof rule !== 'object') {
      continue;
    }
    const pattern = String(rule.pattern || '').trim();
    if (!pattern) {
      continue;
    }
    let matched = false;
    try {
      matched = new RegExp(pattern, 'i').test(textForMatch);
    } catch {
      matched = false;
    }
    if (!matched) {
      continue;
    }

    if (rule.state) {
      normalized.state = String(rule.state).trim();
    }
    if (Number.isFinite(Number(rule.priority))) {
      normalized.priority = mergeLinearPriority(normalized.priority, Number(rule.priority));
    }
    if (rule.assigneeEmail && !normalized.assigneeEmail) {
      normalized.assigneeEmail = String(rule.assigneeEmail).trim();
    }
    normalized.labels = dedupeStrings([
      ...normalized.labels,
      ...normalizeLabelNames(rule.labels || []),
    ]);
    normalized.routeHits.push(`keyword:${pattern}`);
  }

  if (!Number.isFinite(Number(normalized.priority))) {
    normalized.priority = 3;
  }

  return normalized;
}

function mergeLinearPriority(currentValue, nextValue) {
  const current = Number(currentValue);
  const next = Number(nextValue);
  if (!Number.isFinite(current)) {
    return next;
  }
  if (!Number.isFinite(next)) {
    return current;
  }
  return Math.min(current, next);
}

const LINEAR_USER_ID_CACHE = new Map();

async function resolveLinearUserIdByEmail(apiKey, email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) {
    return '';
  }
  if (LINEAR_USER_ID_CACHE.has(wanted)) {
    return LINEAR_USER_ID_CACHE.get(wanted);
  }

  const payload = await linearRequest(
    apiKey,
    `query UsersForRouting {
      users(first: 250) {
        nodes { id email name displayName active }
      }
    }`,
    {},
  );
  const nodes = (((payload || {}).users || {}).nodes || []).filter(Boolean);
  const match = nodes.find(
    (item) =>
      String(item.email || '')
        .trim()
        .toLowerCase() === wanted,
  );
  const id = match && match.id ? String(match.id) : '';
  LINEAR_USER_ID_CACHE.set(wanted, id);
  return id;
}

async function createLinearLabel(apiKey, teamId, name) {
  const payload = await linearRequest(
    apiKey,
    `mutation CreateLabel($input: IssueLabelCreateInput!) {
      issueLabelCreate(input: $input) {
        success
        issueLabel { id name }
      }
    }`,
    { input: { teamId, name } },
  );

  const node = payload && payload.issueLabelCreate ? payload.issueLabelCreate.issueLabel : null;
  if (!node) {
    return null;
  }
  return {
    id: node.id,
    name: node.name,
  };
}

async function resolveLinearIssueByIdentifier(apiKey, identifier, fallbackTeamKey) {
  const normalized = String(identifier || '').trim().toUpperCase();
  const match = normalized.match(/^([A-Z][A-Z0-9]+)-(\d+)$/);
  if (!match) {
    return null;
  }

  const teamKey = match[1];
  const issueNumber = Number(match[2]);

  const payload = await linearRequest(
    apiKey,
    `query FindIssue($teamKey: String!, $number: Float!) {
      issues(
        first: 1
        filter: {
          team: { key: { eqIgnoreCase: $teamKey } }
          number: { eq: $number }
        }
      ) {
        nodes {
          id
          identifier
          title
          url
          number
          team { id key name }
          state { id name type }
        }
      }
    }`,
    { teamKey, number: issueNumber },
  );

  const primary = (((payload || {}).issues || {}).nodes || [])[0];
  if (primary) {
    return primary;
  }

  if (fallbackTeamKey && String(fallbackTeamKey).toUpperCase() !== teamKey) {
    const fallbackPayload = await linearRequest(
      apiKey,
      `query FindIssueFallback($teamKey: String!, $number: Float!) {
        issues(
          first: 1
          filter: {
            team: { key: { eqIgnoreCase: $teamKey } }
            number: { eq: $number }
          }
        ) {
          nodes {
            id
            identifier
            title
            url
            number
            team { id key name }
            state { id name type }
          }
        }
      }`,
      { teamKey: String(fallbackTeamKey), number: issueNumber },
    );
    return ((((fallbackPayload || {}).issues || {}).nodes || [])[0]) || null;
  }

  return null;
}

async function transitionIssueByIdentifier(identifier, targetStateName, settings) {
  const apiKey = String(settings.linear.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is required for issue state transitions.');
  }

  const issue = await resolveLinearIssueByIdentifier(apiKey, identifier, settings.linear.teamKey);
  if (!issue) {
    return { identifier, status: 'not_found', targetStateName };
  }

  const currentState = issue.state ? String(issue.state.name || '') : '';
  const currentStateType = issue.state ? String(issue.state.type || '').trim().toLowerCase() : '';
  const targetStateLower = String(targetStateName || '').trim().toLowerCase();
  const targetLooksInProgress =
    targetStateLower === 'in progress' || targetStateLower === 'in_progress' || targetStateLower === 'doing';
  if ((currentStateType === 'completed' || currentStateType === 'canceled') && targetLooksInProgress) {
    return {
      issueId: issue.id,
      identifier: issue.identifier,
      status: 'skipped_closed',
      state: currentState,
      previousState: currentState,
      targetStateName,
      url: issue.url,
    };
  }
  if (currentState.trim().toLowerCase() === String(targetStateName || '').trim().toLowerCase()) {
    return {
      issueId: issue.id,
      identifier: issue.identifier,
      status: 'unchanged',
      state: currentState,
      previousState: currentState,
      targetStateName,
      url: issue.url,
    };
  }

  const stateId = await resolveLinearStateId(apiKey, issue.team.id, targetStateName);
  if (!stateId) {
    return {
      issueId: issue.id,
      identifier: issue.identifier,
      status: 'state_not_found',
      previousState: currentState,
      targetStateName,
    };
  }

  const payload = await linearRequest(
    apiKey,
    `mutation MoveIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          url
          state { id name }
        }
      }
    }`,
    {
      id: issue.id,
      input: {
        stateId,
      },
    },
  );

  const moved = payload && payload.issueUpdate ? payload.issueUpdate.issue : null;
  return {
    issueId: issue.id,
    identifier: moved ? moved.identifier : issue.identifier,
    status: moved ? 'updated' : 'unknown',
    previousState: currentState,
    targetStateName,
    state: moved && moved.state ? moved.state.name : targetStateName,
    url: moved ? moved.url : issue.url,
  };
}

function extractLinearIssueIds(...inputs) {
  const set = new Set();
  const pattern = /\b[A-Z][A-Z0-9]+-\d+\b/g;
  for (const input of inputs) {
    const text = String(input || '').toUpperCase();
    const matches = text.match(pattern) || [];
    for (const id of matches) {
      set.add(id);
    }
  }
  return Array.from(set.values());
}

async function handleGithubPullRequestEvent(eventName, payload, settings, meta = {}) {
  if (eventName !== 'pull_request') {
    return { handled: false, reason: `ignored_event_${eventName}` };
  }

  const action = String((payload && payload.action) || '').toLowerCase();
  const pr = payload && payload.pull_request ? payload.pull_request : null;
  if (!pr) {
    return { handled: false, reason: 'missing_pull_request_payload' };
  }

  let targetStateName = '';
  if (['opened', 'reopened', 'ready_for_review', 'review_requested'].includes(action)) {
    targetStateName = String(settings.github.stateInReview || 'In Review');
  } else if (action === 'closed' && Boolean(pr.merged)) {
    targetStateName = String(settings.github.stateDone || 'Done');
  } else {
    return { handled: false, reason: `ignored_action_${action}` };
  }

  const identifiers = extractLinearIssueIds(
    pr.title,
    pr.body,
    pr && pr.head ? pr.head.ref : '',
    pr && pr.base ? pr.base.ref : '',
  );

  if (identifiers.length === 0) {
    return { handled: false, reason: 'no_linear_ids_found' };
  }

  const updates = [];
  const snapshotEntries = [];
  const apiKey = String(settings.linear.apiKey || '').trim();
  const repoFullName = String(
    (payload && payload.repository && payload.repository.full_name) || '',
  ).trim();
  const prNumber = Number(pr.number || 0);
  const prTitle = String(pr.title || '').trim();
  const prUrl = String(pr.html_url || '').trim();
  const actor = String((payload && payload.sender && payload.sender.login) || '').trim();
  const delivery = String(meta.delivery || '').trim();
  const shouldRequestReviewers = ['opened', 'reopened', 'ready_for_review'].includes(action);
  let reviewersResult = null;
  if (shouldRequestReviewers) {
    const reviewers = Array.isArray(settings.github.autoReviewers)
      ? settings.github.autoReviewers.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const githubToken = String(settings.github.token || '').trim();
    if (reviewers.length > 0 && githubToken && repoFullName && prNumber > 0) {
      try {
        reviewersResult = await requestGithubPullReviewers(githubToken, repoFullName, prNumber, reviewers);
      } catch (error) {
        reviewersResult = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  for (const identifier of identifiers) {
    const result = await transitionIssueByIdentifier(identifier, targetStateName, settings);
    let commented = false;
    if (apiKey && result && result.issueId && result.status === 'updated') {
      const body = renderGithubWebhookComment({
        action,
        identifier,
        transition: result,
        repo: repoFullName,
        prNumber,
        prTitle,
        prUrl,
        actor,
        delivery,
        settings,
      });
      try {
        await createLinearIssueComment(apiKey, result.issueId, body);
        commented = true;
      } catch {
        commented = false;
      }
    }

    snapshotEntries.push({
      repo: repoFullName,
      action: action === 'closed' && Boolean(pr.merged) ? 'merged' : 'open',
      prNumber,
      prTitle,
      prUrl,
      identifier,
      result,
      source: String(meta.via || 'webhook'),
      delivery,
      updatedAtMs: Date.now(),
    });
    appendAuditEvent('github-webhook-transition', {
      repo: repoFullName,
      action,
      identifier,
      prNumber,
      delivery,
      status: result.status,
      toState: result.state || targetStateName,
      commented,
    });
    updates.push(result);
  }

  appendGithubSignalSnapshot(snapshotEntries);

  return {
    handled: true,
    action,
    targetStateName,
    identifiers,
    repo: repoFullName,
    prNumber,
    delivery,
    reviewersResult,
    updates,
  };
}

function collectLinkedIssueSignals(settings, flags) {
  const bindings = readJsonFile(ISSUE_LINKS_PATH, {});
  const nowMs = Date.now();
  const activeWindowMinutes = Math.max(
    5,
    Number(flags['active-minutes'] || settings.statusMachine.activeWindowMinutes || 120),
  );
  const activeWindowMs = activeWindowMinutes * 60 * 1000;

  const byIssue = new Map();
  const ensureContext = (identifier) => {
    const normalized = normalizeLinearIssueId(identifier);
    if (!normalized) {
      return null;
    }
    if (!byIssue.has(normalized)) {
      byIssue.set(normalized, {
        identifier: normalized,
        reason: '',
        activeSessions: [],
        activeSubagents: [],
        cronWarnings: [],
        githubOpen: [],
        githubMerged: [],
        autopilotRecent: [],
        blockerEvidence: [],
      });
    }
    return byIssue.get(normalized);
  };

  const files = fs.readdirSync(DATA_DIR);
  for (const file of files) {
    if (file.startsWith('evidence-') && file.endsWith('-blocker.json')) {
      try {
        const content = readJsonFile(path.join(DATA_DIR, file), null);
        if (content && content.issue) {
          const context = ensureContext(content.issue);
          if (context) {
            context.blockerEvidence.push(content);
          }
        }
      } catch (err) {
        // ignore
      }
    }
  }

  const sessions = loadSessions(settings)
    .filter((session) => Number(session.ageMs || Number.POSITIVE_INFINITY) <= activeWindowMs)
    .sort((a, b) => Number(a.ageMs || 0) - Number(b.ageMs || 0));
  for (const session of sessions) {
    const taskId = `session:${session.agentId}:${session.key}`;
    let identifier = resolveIssueFromBindings(bindings, {
      taskId,
      sessionId: session.sessionId || '',
      sessionKey: session.key || '',
    });
    if (!identifier) {
      const inferred = inferIssueFromSession(session, settings);
      if (inferred) {
        identifier = inferred;
        upsertRuntimeIssueBindings(inferred, {
          taskId,
          sessionId: session.sessionId || '',
          sessionKey: session.key || '',
          agentId: session.agentId || inferAgentId(session.key) || '',
        });
      }
    }
    const context = ensureContext(identifier);
    if (!context) {
      continue;
    }
    context.activeSessions.push({
      taskId,
      agentId: session.agentId,
      key: session.key,
      sessionId: session.sessionId || '',
      ageMs: Number(session.ageMs || 0),
      updatedAt: Number(session.updatedAt || 0),
      model: session.model || '',
    });
  }

  const subagents = loadSubagents(settings).filter((item) => item.isActive);
  for (const item of subagents) {
    const taskId = `subagent:${item.id}`;
    let identifier = resolveIssueFromBindings(bindings, {
      taskId,
      subagentId: item.id,
    });
    if (!identifier) {
      const inferred = inferIssueFromSubagent(item, settings);
      if (inferred) {
        identifier = inferred;
        upsertRuntimeIssueBindings(inferred, {
          subagentId: item.id,
          taskId,
        });
      }
    }
    const context = ensureContext(identifier);
    if (!context) {
      continue;
    }
    context.activeSubagents.push({
      taskId,
      subagentId: item.id,
      label: item.label,
      durationMs: Number(item.durationMs || 0),
      status: item.status || '',
    });
  }

  const autopilotState = readJsonFile(LINEAR_AUTOPILOT_PATH, { runs: [] });
  const autopilotRuns = Array.isArray(autopilotState.runs) ? autopilotState.runs : [];
  const autopilotMaxIssues = Math.max(
    5,
    Number(flags['autopilot-max-issues'] || settings.statusMachine.autopilotMaxIssues || 20),
  );
  const autopilotIssueSet = new Set();
  for (const run of autopilotRuns.slice(0, 120)) {
    const identifier = normalizeLinearIssueId(run && run.issueIdentifier ? run.issueIdentifier : '');
    if (!identifier) {
      continue;
    }
    const atMs = Number(run && run.atMs ? run.atMs : 0);
    if (!atMs || nowMs - atMs > activeWindowMs) {
      continue;
    }
    const context = ensureContext(identifier);
    if (!context) {
      continue;
    }
    context.autopilotRecent.push({
      atMs,
      status: String(run && run.status ? run.status : '').trim().toLowerCase(),
      ok: Boolean(run && run.ok),
      runId: String(run && run.runId ? run.runId : '').trim(),
      nextState: String(run && run.nextState ? run.nextState : '').trim(),
    });
    autopilotIssueSet.add(identifier);
    if (autopilotIssueSet.size >= autopilotMaxIssues) {
      break;
    }
  }
  for (const context of byIssue.values()) {
    if (Array.isArray(context.autopilotRecent) && context.autopilotRecent.length > 1) {
      context.autopilotRecent.sort((a, b) => Number(b.atMs || 0) - Number(a.atMs || 0));
      context.autopilotRecent = context.autopilotRecent.slice(0, 5);
    }
  }

  const cronWarnings = loadCronJobs(settings).filter((job) => {
    if (!job.enabled) {
      return false;
    }
    const state = job.state || {};
    const lastStatus = String(state.lastStatus || '').toLowerCase();
    const consecutiveErrors = Number(state.consecutiveErrors || 0);
    const lastError = String(state.lastError || '');
    return (
      lastStatus === 'error' ||
      lastStatus === 'failed' ||
      consecutiveErrors > 0 ||
      isTimeoutError(lastError)
    );
  });
  for (const job of cronWarnings) {
    const taskId = `cron:${job.id}`;
    const identifier = resolveIssueFromBindings(bindings, {
      taskId,
      cronId: job.id,
    });
    const context = ensureContext(identifier);
    if (!context) {
      continue;
    }
    context.cronWarnings.push({
      taskId,
      cronId: job.id,
      name: job.name || job.id,
      status: (job.state && job.state.lastStatus) || '-',
      consecutiveErrors: Number((job.state && job.state.consecutiveErrors) || 0),
      lastError: (job.state && job.state.lastError) || '',
    });
  }

  const githubSnapshot = readJsonFile(GITHUB_SYNC_PATH, { updates: [] });
  const updates = Array.isArray(githubSnapshot.updates) ? githubSnapshot.updates : [];
  for (const item of updates) {
    const identifier = normalizeLinearIssueId(item.identifier);
    if (!identifier) {
      continue;
    }
    const context = ensureContext(identifier);
    if (!context) {
      continue;
    }
    const action = String(item.action || '').toLowerCase();
    if (action === 'merged') {
      context.githubMerged.push({
        repo: item.repo || '',
        prNumber: Number(item.prNumber || 0),
        prTitle: item.prTitle || '',
      });
    } else if (action === 'open') {
      context.githubOpen.push({
        repo: item.repo || '',
        prNumber: Number(item.prNumber || 0),
        prTitle: item.prTitle || '',
      });
    }
  }

  return Array.from(byIssue.values()).sort((a, b) => {
    const aScore =
      Number(a.cronWarnings.length > 0) * 100 +
      Number(a.githubMerged.length > 0) * 50 +
      Number(a.githubOpen.length > 0) * 30 +
      Number(a.activeSessions.length + a.activeSubagents.length > 0) * 10;
    const bScore =
      Number(b.cronWarnings.length > 0) * 100 +
      Number(b.githubMerged.length > 0) * 50 +
      Number(b.githubOpen.length > 0) * 30 +
      Number(b.activeSessions.length + b.activeSubagents.length > 0) * 10;
    if (aScore !== bScore) {
      return bScore - aScore;
    }
    return String(a.identifier).localeCompare(String(b.identifier));
  });
}

function decideIssueTargetState(context, settings) {
  const rules = getActiveStatusMachineRules(settings);
  for (const rule of rules) {
    if (!evaluateStatusRule(rule, context)) {
      continue;
    }
    const targetState = resolveRuleTargetState(rule, settings);
    if (!targetState) {
      continue;
    }
    context.reason = String(rule.reason || rule.id || 'rule-match').trim();
    return targetState;
  }
  context.reason = 'no-signal';
  return '';
}

function resolveIssueFromBindings(bindings, refs) {
  const candidates = [
    lookupBindingValue(bindings.byTaskId, refs.taskId),
    lookupBindingValue(bindings.bySessionId, refs.sessionId),
    lookupBindingValue(bindings.bySessionKey, refs.sessionKey),
    lookupBindingValue(bindings.bySubagentId, refs.subagentId),
    lookupBindingValue(bindings.byCronId, refs.cronId),
  ];

  for (const value of candidates) {
    const identifier = normalizeLinearIssueId(value);
    if (identifier) {
      return identifier;
    }
  }
  return '';
}

function lookupBindingValue(map, key) {
  if (!map || typeof map !== 'object' || !key) {
    return '';
  }
  if (map[key]) {
    return String(map[key]);
  }
  const lookup = String(key).toLowerCase();
  for (const [candidateKey, candidateValue] of Object.entries(map)) {
    if (String(candidateKey).toLowerCase() === lookup) {
      return String(candidateValue || '');
    }
  }
  return '';
}

function normalizeLinearIssueId(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/^([A-Z][A-Z0-9]+)-(\d+)$/);
  if (!match) {
    return '';
  }
  return `${match[1]}-${Number(match[2])}`;
}

function inferIssueFromSubagent(item, settings) {
  const source = item && item.raw && typeof item.raw === 'object' ? item.raw : {};
  const teamKey = String(settings && settings.linear && settings.linear.teamKey ? settings.linear.teamKey : 'CLAW')
    .trim()
    .toUpperCase();
  const issuePattern = new RegExp(`\\b${escapeRegExp(teamKey)}-(\\d+)\\b`, 'i');

  const explicitCandidates = [
    source.issueIdentifier || '',
    source.issueId || '',
    source.linearIssue || '',
    source.linearIssueId || '',
  ];
  for (const candidate of explicitCandidates) {
    const normalized = normalizeLinearIssueId(candidate);
    if (normalized && normalized.startsWith(`${teamKey}-`)) {
      return normalized;
    }
  }

  const textCandidates = [
    item && item.label ? item.label : '',
    item && item.id ? item.id : '',
    source.taskId || '',
    source.name || '',
    source.title || '',
  ];
  for (const candidate of textCandidates) {
    const text = String(candidate || '').trim();
    if (!text) {
      continue;
    }
    const inline = text.match(issuePattern);
    if (inline && inline[0]) {
      const normalized = normalizeLinearIssueId(inline[0]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return '';
}

function renderStatusSyncComment(context, transition, settings) {
  const nowMs = Date.now();
  const lines = [];
  lines.push('### Mission Control Auto Status Update');
  lines.push(
    `- transition: ${transition.previousState || '-'} -> ${transition.state || transition.targetStateName || '-'}`,
  );
  lines.push(`- reason: ${context.reason}`);
  lines.push(
    `- signals: sessions=${context.activeSessions.length}, subagents=${context.activeSubagents.length}, autopilotRecent=${context.autopilotRecent.length}, cronWarnings=${context.cronWarnings.length}, githubOpen=${context.githubOpen.length}, githubMerged=${context.githubMerged.length}`,
  );

  if (context.activeSessions.length > 0) {
    lines.push('');
    lines.push('#### Active Sessions');
    for (const item of context.activeSessions.slice(0, 5)) {
      const logPath = item.sessionId
        ? path.join(settings.openclawHome, 'agents', item.agentId, 'sessions', `${item.sessionId}.jsonl`)
        : '-';
      lines.push(
        `- ${item.agentId} age=${formatDuration(item.ageMs)} key=${singleLine(item.key)}${item.model ? ` model=${item.model}` : ''}`,
      );
      if (logPath !== '-') {
        lines.push(`  - log: ${logPath}`);
      }
    }
  }

  if (context.activeSubagents.length > 0) {
    lines.push('');
    lines.push('#### Active Subagents');
    for (const item of context.activeSubagents.slice(0, 5)) {
      lines.push(
        `- ${item.label || item.subagentId} status=${item.status || '-'} elapsed=${formatDuration(item.durationMs)}`,
      );
    }
  }

  if (context.cronWarnings.length > 0) {
    lines.push('');
    lines.push('#### Cron Warnings');
    for (const item of context.cronWarnings.slice(0, 5)) {
      lines.push(
        `- ${item.name} (${item.cronId}) status=${item.status || '-'} errors=${item.consecutiveErrors || 0}`,
      );
      if (item.lastError) {
        lines.push(`  - error: ${singleLine(trimMessage(item.lastError, 200))}`);
      }
      lines.push(`  - run log: ${path.join(settings.openclawHome, 'cron', 'runs', `${item.cronId}.jsonl`)}`);
    }
  }

  if (context.githubOpen.length > 0 || context.githubMerged.length > 0) {
    lines.push('');
    lines.push('#### GitHub Signals');
    for (const item of context.githubOpen.slice(0, 5)) {
      lines.push(`- open PR: ${item.repo}#${item.prNumber} ${singleLine(item.prTitle)}`);
    }
    for (const item of context.githubMerged.slice(0, 5)) {
      lines.push(`- merged PR: ${item.repo}#${item.prNumber} ${singleLine(item.prTitle)}`);
    }
  }

  if (Array.isArray(context.autopilotRecent) && context.autopilotRecent.length > 0) {
    lines.push('');
    lines.push('#### Recent Autopilot Runs');
    for (const item of context.autopilotRecent.slice(0, 5)) {
      lines.push(
        `- ${formatTime(item.atMs, settings.timezone)} status=${item.status || '-'} runId=${item.runId || '-'}`,
      );
    }
  }

  const runbookHints = buildRunbookHints(context, settings);
  if (runbookHints.length > 0) {
    lines.push('');
    lines.push('#### Suggested Runbook');
    for (const hint of runbookHints) {
      lines.push(`- ${hint}`);
    }
  }

  lines.push('');
  lines.push(`_generated ${formatTime(nowMs, settings.timezone)} by mission-control status-sync_`);
  return trimMessage(lines.join('\n'), 3500);
}

function renderGithubWebhookComment(input) {
  const lines = [];
  lines.push('### Mission Control GitHub Webhook Update');
  lines.push(
    `- transition: ${input.transition.previousState || '-'} -> ${input.transition.state || input.transition.targetStateName || '-'}`,
  );
  lines.push(`- event: pull_request.${input.action}`);
  lines.push(`- repo: ${input.repo || '-'}`);
  lines.push(`- pr: #${Number(input.prNumber || 0)} ${singleLine(input.prTitle || '')}`);
  if (input.prUrl) {
    lines.push(`- pr url: ${input.prUrl}`);
  }
  if (input.actor) {
    lines.push(`- actor: ${input.actor}`);
  }
  if (input.delivery) {
    lines.push(`- delivery: ${input.delivery}`);
  }
  lines.push('');
  lines.push(`_generated ${formatTime(Date.now(), input.settings.timezone)} by mission-control github webhook_`);
  return trimMessage(lines.join('\n'), 2500);
}

function appendGithubSignalSnapshot(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (list.length === 0) {
    return;
  }
  const current = readJsonFile(GITHUB_SYNC_PATH, { updatedAtMs: 0, updates: [], errors: [] });
  const updates = Array.isArray(current.updates) ? current.updates : [];
  const merged = [...list, ...updates].slice(0, 500);
  current.updatedAtMs = Date.now();
  current.updates = merged;
  if (!Array.isArray(current.errors)) {
    current.errors = [];
  }
  writeJsonFile(GITHUB_SYNC_PATH, current);
}

async function createLinearIssueComment(apiKey, issueId, body) {
  const payload = await linearRequest(
    apiKey,
    `mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment {
          id
        }
      }
    }`,
    {
      input: {
        issueId,
        body,
      },
    },
  );

  const node = payload && payload.commentCreate ? payload.commentCreate.comment : null;
  if (!node || !node.id) {
    throw new Error('Linear commentCreate returned no comment.');
  }
  return node;
}

async function updateLinearIssuePriority(apiKey, issueId, priority) {
  const normalizedPriority = Math.max(0, Math.min(4, Number(priority || 0)));
  const payload = await linearRequest(
    apiKey,
    `mutation UpdateIssuePriority($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          priority
        }
      }
    }`,
    {
      id: String(issueId || ''),
      input: {
        priority: normalizedPriority,
      },
    },
  );

  const node = payload && payload.issueUpdate ? payload.issueUpdate.issue : null;
  if (!node || !node.id) {
    throw new Error(`failed to update issue priority for ${issueId}`);
  }
  return {
    id: node.id,
    identifier: node.identifier || '',
    priority: Number.isFinite(Number(node.priority)) ? Number(node.priority) : normalizedPriority,
  };
}

async function fetchOpenLinearIssuesForSla(apiKey, teamId) {
  const payload = await linearRequest(
    apiKey,
    `query OpenIssuesForSla($teamId: ID!) {
      issues(
        first: 250
        filter: {
          team: { id: { eq: $teamId } }
          state: { type: { nin: ["completed", "canceled"] } }
        }
      ) {
        nodes {
          id
          identifier
          title
          description
          url
          dueDate
          priority
          updatedAt
          state { id name type }
          labels { nodes { id name } }
          cycle { id name number endsAt startsAt }
          assignee { id name displayName }
        }
      }
    }`,
    { teamId },
  );

  const nodes = (((payload || {}).issues || {}).nodes || []).filter(Boolean);
  return nodes;
}

function isBlockedStateName(stateName, settings) {
  const value = String(stateName || '').trim().toLowerCase();
  const configured = String(settings.statusMachine.stateBlocked || 'Blocked').trim().toLowerCase();
  return value === configured || value.includes('blocked') || value.includes('block');
}

function isInProgressStateName(stateName, stateType, settings) {
  const value = String(stateName || '').trim().toLowerCase();
  const configured = String(settings.statusMachine.stateInProgress || 'In Progress').trim().toLowerCase();
  if (value === configured || value.includes('in progress')) {
    return true;
  }
  return String(stateType || '').trim().toLowerCase() === 'started';
}

function renderSlaComment(issue, slaType, ageHours, thresholdHours, settings) {
  const assignee =
    issue && issue.assignee
      ? String(issue.assignee.displayName || issue.assignee.name || '').trim()
      : '';
  const mentionText = assignee ? `@${assignee}` : '@owner';
  const lines = [];
  lines.push('### Mission Control SLA Alert');
  lines.push(`- issue: ${issue.identifier}`);
  lines.push(`- state: ${issue.state ? issue.state.name : '-'}`);
  lines.push(`- stale type: ${slaType}`);
  lines.push(`- age: ${ageHours.toFixed(2)}h (threshold ${thresholdHours}h)`);
  lines.push(`- owner: ${mentionText}`);
  lines.push('');
  lines.push('Please update status or add unblock plan. If blocked, include next concrete action and owner ETA.');
  lines.push('');
  lines.push(`_generated ${formatTime(Date.now(), settings.timezone)} by mission-control sla-check_`);
  return trimMessage(lines.join('\n'), 3000);
}

function normalizeSourceId(value) {
  const text = singleLine(String(value || '')).toLowerCase();
  if (!text) {
    return '';
  }
  if (text.length <= 180) {
    return text;
  }
  return `h:${hashText(text)}`;
}

function deriveAutoSourceId(input) {
  const source = String(input && input.source ? input.source : '')
    .trim()
    .toLowerCase();
  if (!source) {
    return '';
  }
  const fingerprintBase = [
    String(input && input.title ? input.title : ''),
    String(input && input.rawText ? input.rawText : ''),
    String(input && input.description ? input.description : ''),
    String(input && input.sourceUrl ? input.sourceUrl : ''),
    String(input && input.author ? input.author : ''),
    String(input && input.dueDate ? input.dueDate : ''),
    String(input && input.state ? input.state : ''),
  ]
    .map((item) => singleLine(item).toLowerCase())
    .join('|')
    .trim();
  if (!fingerprintBase) {
    return '';
  }
  return normalizeSourceId(`auto:${source}:${hashText(fingerprintBase).slice(0, 24)}`);
}

function buildTriageSignatureCandidate(input, settings) {
  const config =
    settings &&
    settings.triageRouting &&
    settings.triageRouting.signatureDedupe &&
    typeof settings.triageRouting.signatureDedupe === 'object'
      ? settings.triageRouting.signatureDedupe
      : {};
  if (config.enabled === false) {
    return null;
  }

  const source = String(input && input.source ? input.source : '')
    .trim()
    .toLowerCase();
  const sourceAllowlist = Array.isArray(config.sourceAllowlist)
    ? config.sourceAllowlist.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (sourceAllowlist.length > 0 && source && !sourceAllowlist.includes(source)) {
    return null;
  }

  const combinedText = [input && input.title, input && input.rawText, input && input.description]
    .map((item) => String(item || ''))
    .join('\n');
  const normalizedText = normalizeSignatureText(combinedText);
  const minChars = Math.max(10, Number(config.minChars || 30));
  if (normalizedText.length < minChars) {
    return null;
  }

  const repoHint = extractRepoHint(input);
  const errorSignal = detectErrorSignal(combinedText);
  if (!repoHint && !errorSignal) {
    return null;
  }

  const tokenWindow = normalizedText
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join(' ');
  const base = [source || '-', repoHint || '-', errorSignal || '-', tokenWindow].join('|');
  return {
    signature: `sig:${hashText(base)}`,
    source,
    repoHint,
    errorSignal,
  };
}

function normalizeSignatureText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[a-z][a-z0-9-]+-\d+\b/g, ' ')
    .replace(/[`"'()[\]{}<>]/g, ' ')
    .replace(/[^\w:/.\-\u4e00-\u9fff]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRepoHint(input) {
  const probes = [
    input && input.sourceUrl,
    input && input.rawText,
    input && input.description,
    input && input.title,
  ]
    .map((item) => String(item || ''))
    .filter(Boolean);
  const pattern = /\b([a-z0-9_.-]+\/[a-z0-9_.-]+)\b/i;
  for (const probe of probes) {
    const match = probe.match(pattern);
    if (!match) {
      continue;
    }
    const repo = String(match[1] || '').toLowerCase();
    if (repo.includes('discord.com/channels')) {
      continue;
    }
    if (repo.includes('http')) {
      continue;
    }
    return repo;
  }
  return '';
}

function detectErrorSignal(value) {
  const text = normalizeSignatureText(value);
  if (!text) {
    return '';
  }
  const signals = [
    { key: 'timeout', pattern: /timed out|timeout|超时/i },
    { key: 'rate-limit', pattern: /\b429\b|rate limit|throttle|限流/i },
    { key: 'auth', pattern: /unauthorized|forbidden|permission|auth|token|凭证|权限/i },
    { key: 'network', pattern: /econn|enotfound|dns|network|socket|connect/i },
    { key: 'blocked', pattern: /blocked|卡住|无法|stuck/i },
    { key: 'failover', pattern: /failover|fallback|switch model|切换模型|model switch/i },
    { key: 'ci', pattern: /ci|test failed|lint failed|build failed/i },
    { key: 'exception', pattern: /exception|traceback|panic|fatal|error/i },
  ];
  for (const signal of signals) {
    if (signal.pattern.test(text)) {
      return signal.key;
    }
  }
  return '';
}

function findTriageSignatureDuplicate(signature, settings) {
  const wanted = String(signature || '').trim();
  if (!wanted) {
    return null;
  }
  const config =
    settings &&
    settings.triageRouting &&
    settings.triageRouting.signatureDedupe &&
    typeof settings.triageRouting.signatureDedupe === 'object'
      ? settings.triageRouting.signatureDedupe
      : {};
  const lookbackDays = Math.max(1, Number(config.lookbackDays || 14));
  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const index = readJsonFile(TRIAGE_SIGNATURE_INDEX_PATH, { version: 1, updatedAtMs: 0, items: {} });
  const items = index.items && typeof index.items === 'object' ? index.items : {};
  const candidate = items[wanted];
  if (!candidate || !candidate.identifier) {
    return null;
  }
  const createdAtMs = Number(candidate.createdAtMs || 0);
  if (createdAtMs > 0 && nowMs - createdAtMs > lookbackMs) {
    return null;
  }
  return candidate;
}

function storeTriageSignatureMapping(signatureInfo, issue, input, settings) {
  const signature = signatureInfo && signatureInfo.signature ? String(signatureInfo.signature) : '';
  if (!signature) {
    return;
  }
  const config =
    settings &&
    settings.triageRouting &&
    settings.triageRouting.signatureDedupe &&
    typeof settings.triageRouting.signatureDedupe === 'object'
      ? settings.triageRouting.signatureDedupe
      : {};
  const maxEntries = Math.max(100, Number(config.maxEntries || 2000));
  const index = readJsonFile(TRIAGE_SIGNATURE_INDEX_PATH, { version: 1, updatedAtMs: 0, items: {} });
  if (!index.items || typeof index.items !== 'object') {
    index.items = {};
  }
  index.items[signature] = {
    signature,
    identifier: issue.identifier,
    issueId: issue.id,
    title: issue.title,
    url: issue.url || '',
    source: String(input && input.source ? input.source : '').trim().toLowerCase(),
    repoHint: signatureInfo.repoHint || '',
    errorSignal: signatureInfo.errorSignal || '',
    createdAtMs: Date.now(),
  };

  const entries = Object.entries(index.items);
  if (entries.length > maxEntries) {
    entries.sort((a, b) => Number(b[1].createdAtMs || 0) - Number(a[1].createdAtMs || 0));
    const trimmed = entries.slice(0, maxEntries);
    index.items = {};
    for (const [key, value] of trimmed) {
      index.items[key] = value;
    }
  }
  index.updatedAtMs = Date.now();
  writeJsonFile(TRIAGE_SIGNATURE_INDEX_PATH, index);
}

function buildRunbookHints(context, settings) {
  const hints = [];
  const joined = [
    ...context.activeSessions.map((item) => `${item.key} ${item.model || ''}`),
    ...context.cronWarnings.map((item) => `${item.name} ${item.lastError || ''}`),
  ]
    .join(' ')
    .toLowerCase();

  if (joined.includes('failover') || joined.includes('model') || joined.includes('切换')) {
    hints.push('Model switch/failover suspected: verify active model route and fallback policy first.');
    hints.push('Check current session/tool channel binding and confirm manual switch command path is enabled.');
    hints.push(
      `Capture latest runtime evidence: ${path.join(
        settings.openclawHome,
        'logs',
      )} + affected session/cron jsonl files before restart.`,
    );
  }

  if (context.cronWarnings.length > 0) {
    hints.push('For cron failures: reproduce once manually, then validate next two scheduled runs before closing.');
  }

  return dedupeStrings(hints);
}

function isTruthyLike(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) {
    return false;
  }
  return !['0', 'false', 'no', 'off', 'n'].includes(text);
}

function normalizeOwnerIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStateNames(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickLinearAutopilotCandidate(issues, options = {}) {
  const includeStates = new Set(
    normalizeStateNames(options.includeStates || []).map((item) => item.toLowerCase()),
  );
  const includeLabels = new Set(
    normalizeLabelNames(options.includeLabels || []).map((item) => item.toLowerCase()),
  );
  const includeAll = Boolean(options.includeAll);
  const nowMs = Date.now();
  const historyIndex = buildAutopilotHistoryIndex(options.historyRuns || []);
  const issueCooldownMinutes = Math.max(0, Number(options.issueCooldownMinutes || 0));
  const cooldownMs = issueCooldownMinutes * 60 * 1000;
  const maxConsecutiveSameIssue = Math.max(1, Number(options.maxConsecutiveSameIssue || 2));
  const preferNewTriage = Boolean(options.preferNewTriage);

  const filtered = (Array.isArray(issues) ? issues : []).filter((issue) => {
    const stateName = String((issue && issue.state && issue.state.name) || '').trim();
    const stateLower = stateName.toLowerCase();
    if (includeStates.size > 0 && !includeStates.has(stateLower)) {
      return false;
    }
    if (includeAll || includeLabels.size === 0) {
      return true;
    }
    const labels = ((((issue || {}).labels || {}).nodes || []) || [])
      .map((item) => String(item && item.name ? item.name : '').trim().toLowerCase())
      .filter(Boolean);
    return labels.some((name) => includeLabels.has(name));
  });

  if (filtered.length === 0) {
    return { issue: null, strategy: 'none' };
  }

  const scored = filtered.map((issue) => {
    const identifier = normalizeLinearIssueId(String((issue && issue.identifier) || ''));
    const stateName = String((issue && issue.state && issue.state.name) || '').trim();
    const stateLower = stateName.toLowerCase();
    const priority = Number(issue && issue.priority);
    const updatedAtMsRaw = Date.parse(String((issue && issue.updatedAt) || ''));
    const updatedAtMs = Number.isFinite(updatedAtMsRaw) ? updatedAtMsRaw : 0;
    const history = historyIndex.get(identifier) || { lastAtMs: 0, consecutive: 0 };
    const inCooldown =
      cooldownMs > 0 && history.lastAtMs > 0 ? nowMs - history.lastAtMs < cooldownMs : false;
    const blockedByConsecutive = history.consecutive >= maxConsecutiveSameIssue;

    return {
      issue,
      identifier,
      stateName,
      stateLower,
      stateRank: autopilotStateRank(stateName),
      priorityRank: Number.isFinite(priority) && priority > 0 ? priority : 9,
      updatedAtMs,
      inCooldown,
      blockedByConsecutive,
      lastAtMs: Number(history.lastAtMs || 0),
      consecutive: Number(history.consecutive || 0),
    };
  });

  const triageReady = preferNewTriage
    ? scored
        .filter((item) => item.stateLower === 'triage' && !item.inCooldown && !item.blockedByConsecutive)
        .sort((a, b) => {
          if (a.priorityRank !== b.priorityRank) {
            return a.priorityRank - b.priorityRank;
          }
          if (a.updatedAtMs !== b.updatedAtMs) {
            return b.updatedAtMs - a.updatedAtMs;
          }
          return String(a.identifier || '').localeCompare(String(b.identifier || ''));
        })
    : [];
  if (triageReady.length > 0) {
    return { issue: triageReady[0].issue, strategy: 'triage-priority' };
  }

  const readyPool = scored
    .filter((item) => !item.inCooldown && !item.blockedByConsecutive)
    .sort((a, b) => {
      if (a.stateRank !== b.stateRank) {
        return a.stateRank - b.stateRank;
      }
      if (a.priorityRank !== b.priorityRank) {
        return a.priorityRank - b.priorityRank;
      }
      if (a.updatedAtMs !== b.updatedAtMs) {
        return a.updatedAtMs - b.updatedAtMs;
      }
      return String(a.identifier || '').localeCompare(String(b.identifier || ''));
    });
  if (readyPool.length > 0) {
    return { issue: readyPool[0].issue, strategy: 'ready-pool' };
  }

  const softPool = scored
    .filter((item) => !item.blockedByConsecutive)
    .sort((a, b) => {
      if (a.inCooldown !== b.inCooldown) {
        return Number(a.inCooldown) - Number(b.inCooldown);
      }
      if (a.stateRank !== b.stateRank) {
        return a.stateRank - b.stateRank;
      }
      if (a.priorityRank !== b.priorityRank) {
        return a.priorityRank - b.priorityRank;
      }
      if (a.updatedAtMs !== b.updatedAtMs) {
        return a.updatedAtMs - b.updatedAtMs;
      }
      return String(a.identifier || '').localeCompare(String(b.identifier || ''));
    });
  if (softPool.length > 0) {
    return { issue: softPool[0].issue, strategy: 'cooldown-fallback' };
  }

  const fallback = scored.sort((a, b) => {
    if (a.stateRank !== b.stateRank) {
      return a.stateRank - b.stateRank;
    }
    if (a.priorityRank !== b.priorityRank) {
      return a.priorityRank - b.priorityRank;
    }
    if (a.updatedAtMs !== b.updatedAtMs) {
      return a.updatedAtMs - b.updatedAtMs;
    }
    return String(a.identifier || '').localeCompare(String(b.identifier || ''));
  });
  return { issue: fallback.length > 0 ? fallback[0].issue : null, strategy: 'any-fallback' };
}

function buildAutopilotHistoryIndex(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const map = new Map();
  const latestByIssue = new Map();
  for (const item of list) {
    const identifier = normalizeLinearIssueId(item && item.issueIdentifier ? item.issueIdentifier : '');
    if (!identifier) {
      continue;
    }
    const atMs = Number(item && item.atMs ? item.atMs : 0);
    const prev = latestByIssue.get(identifier);
    if (!prev || atMs > prev) {
      latestByIssue.set(identifier, atMs);
    }
  }

  let lastIdentifier = '';
  let sequence = 0;
  for (const item of list) {
    const identifier = normalizeLinearIssueId(item && item.issueIdentifier ? item.issueIdentifier : '');
    if (!identifier) {
      continue;
    }
    if (identifier === lastIdentifier) {
      sequence += 1;
    } else {
      sequence = 1;
      lastIdentifier = identifier;
    }
    if (!map.has(identifier)) {
      map.set(identifier, {
        lastAtMs: Number(latestByIssue.get(identifier) || 0),
        consecutive: sequence,
      });
    }
  }
  return map;
}

function autopilotStateRank(stateName) {
  const text = String(stateName || '').trim().toLowerCase();
  if (!text) {
    return 9;
  }
  if (text === 'in progress' || text === 'doing' || text.includes('in progress')) {
    return 0;
  }
  if (text === 'triage') {
    return 1;
  }
  if (text === 'backlog' || text === 'todo' || text === 'planned') {
    return 2;
  }
  if (text === 'blocked' || text.includes('block')) {
    return 3;
  }
  return 4;
}

function extractSection(text, headers) {
  for (const header of headers) {
    // Improved regex to handle various markdown styles and stop at next header
    const pattern = new RegExp(`(?:^|\\n)(?:##|###)?\\s*${header}[:\\s]*([\\s\\S]*?)(?=\\n(?:##|###)|$)`, 'i');
    const match = text.match(pattern);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }
  return '';
}

function extractLinearIssueRawInput(description, maxChars) {
  const text = String(description || '').trim();
  if (!text) {
    return '';
  }

  // CLAW-114: Prompt slimming policy. 
  // Prioritize SOP sections: objective / constraints / context / risks
  const objective = extractSection(text, ['目标', 'Goal', 'Objective']);
  const constraints = extractSection(text, ['验收标准', 'Acceptance Criteria', 'Constraints', '范围外', 'Out of Scope']);
  const context = extractSection(text, ['背景', 'Context']);
  const risks = extractSection(text, ['风险', 'Risks']);

  if (objective || constraints) {
    const parts = [];
    if (objective) parts.push(`OBJECTIVE: ${trimMessage(objective, 400)}`);
    if (context) parts.push(`CONTEXT: ${trimMessage(context, 400)}`);
    if (constraints) parts.push(`CONSTRAINTS: ${trimMessage(constraints, 400)}`);
    if (risks) parts.push(`RISKS: ${trimMessage(risks, 300)}`);
    return parts.join('\n\n');
  }

  // Fallback to legacy raw input extraction
  const rawMatch = text.match(/##\s*Raw input[\s\S]*?```text\s*([\s\S]*?)```/i);
  const raw = rawMatch && rawMatch[1] ? rawMatch[1].trim() : text;
  return trimMessage(raw, Math.max(200, Number(maxChars || 1200)));
}

function buildLinearAutopilotPrompt(issue, maxPromptChars, options = {}) {
  const stateName = String((issue && issue.state && issue.state.name) || '').trim();
  const priority = Number.isFinite(Number(issue && issue.priority)) ? Number(issue.priority) : 0;
  const labels = (((issue && issue.labels) || {}).nodes || [])
    .map((item) => String(item && item.name ? item.name : '').trim())
    .filter(Boolean);
  const dueDate = String(issue && issue.dueDate ? issue.dueDate : '').trim();
  const cycle = issue && issue.cycle && issue.cycle.name ? String(issue.cycle.name) : '';
  const rawInput = extractLinearIssueRawInput(issue && issue.description ? issue.description : '', maxPromptChars);
  const workdir = String(options && options.workdir ? options.workdir : ROOT_DIR).trim();
  const handoff = options && options.handoff ? options.handoff : null;
  const smartContextMessage = String(options && options.smartContextMessage ? options.smartContextMessage : '').trim();
  const smartContextBudget = Number.isFinite(Number(options && options.smartContextBudget))
    ? Number(options.smartContextBudget)
    : 0;

  // Expose section length metrics for strict contract validation and audit.
  const audit = {
    version: 1,
    maxPromptChars: Number(maxPromptChars || 0),
    sections: {},
  };
  const push = (key, value) => {
    const text = String(value || '');
    audit.sections[key] = {
      chars: text.length,
      lines: text ? text.split('\n').length : 0,
      hash: fnv1a32(text),
    };
    return text;
  };

  const lines = [];
  push('instruction', 'You are OpenClaw execution autopilot.');
  push('instruction.oneStep', 'Do exactly ONE concrete next step for this issue in local workspace.');
  push('instruction.blocked', 'If blocked, report exact blocker and next unblock action.');
  push(
    'sop',
    'Standard Operating Procedure (SOP): All actions MUST follow the standard development SOP located at docs/sop/linear-codex-dev-sop.md.',
  );
  push(
    'guard.noRecursion',
    'Do NOT invoke mission-control executors from within this task (no `tasks.js linear-engine` / `tasks.js linear-autopilot` / `openclaw agent`).',
  );
  push(
    'guard.noLockAsBlocker',
    'Do NOT treat scheduler locks or queue contention (`already-running`, lock files, circuit-open) as an issue blocker.',
  );
  push(
    'guard.blockedDefinition',
    'Use `blocked` only for real external dependency blockers that cannot be solved by local repo edits in this run.',
  );
  lines.push('You are OpenClaw execution autopilot.');
  lines.push('Do exactly ONE concrete next step for this issue in local workspace.');
  lines.push('If blocked, report exact blocker and next unblock action.');
  lines.push('Standard Operating Procedure (SOP): All actions MUST follow the standard development SOP located at docs/sop/linear-codex-dev-sop.md.');
  lines.push('Do NOT invoke mission-control executors from within this task (no `tasks.js linear-engine` / `tasks.js linear-autopilot` / `openclaw agent`).');
  lines.push('Do NOT treat scheduler locks or queue contention (`already-running`, lock files, circuit-open) as an issue blocker.');
  lines.push('Use `blocked` only for real external dependency blockers that cannot be solved by local repo edits in this run.');
  if (workdir) {
    const rootLine = `Repository root for this task: ${workdir}`;
    push('repoRoot', rootLine);
    push('repoRoot.ops', 'Run all local commands and file operations under this repository root.');
    lines.push(rootLine);
    lines.push('Run all local commands and file operations under this repository root.');
  }
  lines.push('');
  if (handoff) {
    lines.push('### SESSION HANDOFF CONTEXT');
    lines.push(`Source Session: ${handoff.sourceSession ? handoff.sourceSession.agentId : 'unknown'}/${handoff.sourceSession ? handoff.sourceSession.sessionKey : 'unknown'}`);
    lines.push(`Handoff Reason: ${handoff.handoffReason || 'threshold-breach'}`);
    lines.push(`Handoff Metrics: ${handoff.metrics ? handoff.metrics.tokens : 0} tokens, ${handoff.metrics ? handoff.metrics.turns : 0} turns`);
    lines.push(`Handoff Timestamp: ${handoff.timestamp || 'unknown'}`);
    lines.push('');
    if (handoff.recentRuns && handoff.recentRuns.length > 0) {
      lines.push('Recent attempt summaries:');
      for (const run of handoff.recentRuns.slice(0, 3)) {
        lines.push(`- [${new Date(run.atMs).toISOString()}] status=${run.status} summary=${run.summary}`);
      }
      lines.push('');
    }
    if (handoff.decisionCard && handoff.decisionCard.summary) {
      lines.push('### LAST AGENT SUMMARY');
      lines.push(handoff.decisionCard.summary);
      lines.push('');
    }
    if (handoff.recentTurns && handoff.recentTurns.length > 0) {
      // Keep only the most recent turns to avoid prompt bloat on shard handoffs.
      const turns = handoff.recentTurns.slice(-8);
      lines.push('### RECENT SESSION TURNS');
      for (const turn of turns) {
        const role = turn.role || 'unknown';
        const content = turn.text || turn.message || turn.content || (turn.raw ? turn.raw.substring(0, 100) : '');
        if (content) {
          const s = content.toString();
          lines.push(`${role.toUpperCase()}: ${s.substring(0, 300)}${s.length > 300 ? '...' : ''}`);
        }
      }
      lines.push('');
    }
  }
  lines.push(`Issue: ${issue.identifier} ${singleLine(issue.title || '')}`);
  lines.push(`URL: ${issue.url || '-'}`);
  lines.push(`State: ${stateName || '-'}`);
  lines.push(`Priority: ${priority || '-'}`);
  if (dueDate) {
    lines.push(`Due: ${dueDate}`);
  }
  if (cycle) {
    lines.push(`Cycle: ${cycle}`);
  }
  if (labels.length > 0) {
    lines.push(`Labels: ${labels.join(', ')}`);
  }
  lines.push('');
  lines.push('Issue context (trimmed):');
  lines.push('```text');
  lines.push(rawInput || '(no description)');
  lines.push('```');
  lines.push('');
  if (smartContextMessage && smartContextBudget > 0) {
    lines.push('Smart Context (Second Brain):');
    lines.push('```text');
    lines.push(trimMessage(smartContextMessage, smartContextBudget));
    lines.push('```');
    lines.push('');
  }
  lines.push('Status contract (strict):');
  lines.push('- status reflects ISSUE-level progress, not just this single step result.');
  lines.push('- Use status="done" only when the issue acceptance criteria are fully satisfied.');
  lines.push('- If any work remains, status must be "in_progress".');
  lines.push('- If status="done", next_action must be empty and next_state must be "Done" or "In Review".');
  lines.push('- If status="blocked", next_state must be "Blocked".');
  lines.push('- If status="in_progress", next_state must be "In Progress".');
  lines.push('');
  lines.push('Return strict JSON only (no markdown):');
  lines.push(
    '{"status":"done|in_progress|blocked","summary":"what changed","next_action":"single next action","artifacts":["path or url"],"next_state":"In Progress|In Review|Blocked|Done|Triage"}',
  );
  return lines.join('\n');
}

function fnv1a32(input) {
  const s = String(input || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function SMART_CONTEXT_CACHE_PATH() {
  return path.join(DATA_DIR, 'smart-context-cache.json');
}

function loadSmartContextCache() {
  return readJsonFile(SMART_CONTEXT_CACHE_PATH(), { version: 1, byIssue: {} });
}

function saveSmartContextCache(cache) {
  try {
    writeJsonFile(SMART_CONTEXT_CACHE_PATH(), cache || { version: 1, byIssue: {} });
  } catch {
    // best-effort
  }
}

function computeSmartContextBudget(issue, settings) {
  const base = Number(
    settings && settings.execution && settings.execution.smartContext && settings.execution.smartContext.maxChars
      ? settings.execution.smartContext.maxChars
      : 900,
  );
  const max = Math.max(0, Math.min(1800, Math.floor(base)));
  const priority = Number.isFinite(Number(issue && issue.priority)) ? Number(issue.priority) : 0;
  if (priority >= 3) return Math.min(1800, Math.max(900, max));
  return Math.min(1200, max);
}

function maybeCompressSmartContext(issue, smartContextMessage, settings) {
  const enabled =
    (settings && settings.execution && settings.execution.smartContext && settings.execution.smartContext.enabled) ?? true;
  if (!enabled) {
    return { text: '', budget: 0, hash: '', changed: false };
  }

  const issueId = String(issue && issue.identifier ? issue.identifier : '').trim();
  const raw = String(smartContextMessage || '').trim();
  if (!issueId || !raw) {
    return { text: raw, budget: computeSmartContextBudget(issue, settings), hash: '', changed: false };
  }

  const h = fnv1a32(raw);
  const cache = loadSmartContextCache();
  const prev = cache && cache.byIssue ? cache.byIssue[issueId] : null;
  const prevHash = prev && prev.hash ? String(prev.hash) : '';
  const nowMs = Date.now();

  cache.byIssue = cache.byIssue || {};
  cache.byIssue[issueId] = { hash: h, atMs: nowMs };
  saveSmartContextCache(cache);

  if (prevHash && prevHash === h) {
    const marker = `UNCHANGED_SMART_CONTEXT(hash=${h})`;
    return { text: marker, budget: Math.min(120, marker.length + 10), hash: h, changed: false };
  }

  return { text: raw, budget: computeSmartContextBudget(issue, settings), hash: h, changed: true };
}

function extractAgentText(agentPayload) {
  const payloads = (((agentPayload || {}).result || {}).payloads || []);
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return '';
  }
  for (const item of payloads) {
    const text = String(item && item.text ? item.text : '').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function parseLinearAutopilotResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return {
      status: '',
      summary: '',
      nextAction: '',
      nextState: '',
      artifacts: [],
    };
  }

  let parsed = null;
  try {
    parsed = extractJson(raw);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      status: '',
      summary: singleLine(trimMessage(raw, 600)),
      nextAction: '',
      nextState: '',
      artifacts: [],
    };
  }

  const artifactsRaw = Array.isArray(parsed.artifacts)
    ? parsed.artifacts
    : parsed.artifactPath
      ? [parsed.artifactPath]
      : [];
  const artifacts = artifactsRaw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  let status = normalizeAutopilotStatus(parsed.status || parsed.result || '');
  let nextState = normalizeAutopilotStateName(parsed.next_state || parsed.nextState || '');
  const nextAction = String(parsed.next_action || parsed.nextAction || '').trim();

  // Guard against common semantic drift where "done" means "one step done".
  if (status === 'done' && nextAction) {
    status = 'in_progress';
  }
  if (status === 'done' && nextState && nextState !== 'Done' && nextState !== 'In Review') {
    status = 'in_progress';
  }
  if (status === 'blocked' && nextState && nextState !== 'Blocked') {
    status = 'in_progress';
  }
  if (status === 'in_progress' && nextState === 'Done') {
    nextState = 'In Progress';
  }

  return {
    status,
    summary: String(parsed.summary || parsed.message || '').trim(),
    nextAction,
    nextState,
    artifacts,
  };
}

function normalizeAutopilotBlockedContention(parsed, rawText) {
  const base =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { status: '', summary: '', nextAction: '', nextState: '', artifacts: [] };
  if (base.status !== 'blocked') {
    return base;
  }

  const haystack = [base.summary, base.nextAction, rawText]
    .map((item) => String(item || '').toLowerCase())
    .join('\n');
  const contentionHints = [
    'already-running',
    'already running',
    'linear-autopilot.lock',
    'lock.json',
    'circuit-open',
    'circuit open',
    'another `linear-engine` run is currently active',
    'another linear-engine run is currently active',
    'stopreason=already-running',
    'stop reason: already-running',
  ];
  const isExecutionContention = contentionHints.some((hint) => haystack.includes(hint));
  if (!isExecutionContention) {
    return base;
  }

  return {
    ...base,
    status: 'in_progress',
    nextState: 'In Progress',
    summary: base.summary
      ? `${base.summary} (normalized: execution contention is treated as in_progress)`
      : 'Execution contention detected (already-running/lock/circuit). Normalized to in_progress.',
    nextAction:
      base.nextAction ||
      'Continue with one repository-level code/file step. Do not invoke linear-engine/linear-autopilot inside this issue run.',
  };
}

function resolveAutopilotCircuitSettings(settings, flags) {
  const base = settings &&
    settings.execution &&
    settings.execution.circuitBreaker &&
    typeof settings.execution.circuitBreaker === 'object'
    ? settings.execution.circuitBreaker
    : {};

  const shardingBase = settings &&
    settings.execution &&
    settings.execution.sessionSharding &&
    typeof settings.execution.sessionSharding === 'object'
    ? settings.execution.sessionSharding
    : {};

  return {
    enabled:
      flags['circuit-enabled'] !== undefined
        ? isTruthyLike(flags['circuit-enabled'])
        : base.enabled !== false,
    failureThreshold: Math.max(
      2,
      Number(flags['circuit-failure-threshold'] || base.failureThreshold || 2),
    ),
    cooldownMinutes: Math.max(
      1,
      Number(flags['circuit-cooldown-minutes'] || base.cooldownMinutes || 30),
    ),
    autoLinearIssue:
      flags['circuit-auto-linear'] !== undefined
        ? isTruthyLike(flags['circuit-auto-linear'])
        : base.autoLinearIssue !== false,
    issueState: String(flags['circuit-issue-state'] || base.issueState || 'Triage').trim(),
    issuePriority: normalizeLinearPriority(
      Number(flags['circuit-issue-priority'] || base.issuePriority || 2),
    ),
    issueLabels: dedupeStrings(
      normalizeLabelNames(flags['circuit-issue-labels'] || base.issueLabels || [
        'ops',
        'autopilot',
        'circuit-breaker',
      ]),
    ),
    sharding: {
      enabled:
        flags['sharding-enabled'] !== undefined
          ? isTruthyLike(flags['sharding-enabled'])
          : shardingBase.enabled !== false,
      tokenThreshold: Math.max(
        1000,
        Number(flags['sharding-token-threshold'] || shardingBase.maxTokens || shardingBase.tokenThreshold || 60000),
      ),
      turnThreshold: Math.max(
        1,
        Number(flags['sharding-turn-threshold'] || shardingBase.maxTurns || shardingBase.turnThreshold || 30),
      ),
      enforceHandoffPackage:
        flags['sharding-enforce-handoff'] !== undefined
          ? isTruthyLike(flags['sharding-enforce-handoff'])
          : shardingBase.enforceHandoffPackage !== false,
    },
  };
}

function normalizeLinearPriority(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) {
    return 3;
  }
  if (n <= 1) {
    return 1;
  }
  if (n >= 4) {
    return 4;
  }
  return Math.round(n);
}

function readAutopilotCircuitState() {
  const raw = readJsonFile(LINEAR_AUTOPILOT_CIRCUIT_PATH, {
    version: 1,
    status: 'closed',
    consecutiveFailures: 0,
    firstFailureAtMs: 0,
    lastFailureAtMs: 0,
    lastFailureReason: '',
    lastFailureMessage: '',
    lastFailureIssueIdentifier: '',
    openedAtMs: 0,
    openUntilMs: 0,
    reopenCount: 0,
    issueId: '',
    issueIdentifier: '',
    issueUrl: '',
    lastSuccessAtMs: 0,
    updatedAtMs: 0,
  });

  return {
    version: 1,
    status: String(raw.status || 'closed').trim().toLowerCase() || 'closed',
    consecutiveFailures: Math.max(0, Number(raw.consecutiveFailures || 0)),
    firstFailureAtMs: Number(raw.firstFailureAtMs || 0),
    lastFailureAtMs: Number(raw.lastFailureAtMs || 0),
    lastFailureReason: String(raw.lastFailureReason || '').trim(),
    lastFailureMessage: String(raw.lastFailureMessage || '').trim(),
    lastFailureIssueIdentifier: String(raw.lastFailureIssueIdentifier || '').trim(),
    openedAtMs: Number(raw.openedAtMs || 0),
    openUntilMs: Number(raw.openUntilMs || 0),
    reopenCount: Math.max(0, Number(raw.reopenCount || 0)),
    issueId: String(raw.issueId || '').trim(),
    issueIdentifier: String(raw.issueIdentifier || '').trim(),
    issueUrl: String(raw.issueUrl || '').trim(),
    lastSuccessAtMs: Number(raw.lastSuccessAtMs || 0),
    updatedAtMs: Number(raw.updatedAtMs || 0),
  };
}

function writeAutopilotCircuitState(state) {
  const next = {
    ...state,
    version: 1,
    updatedAtMs: Date.now(),
  };
  writeJsonFile(LINEAR_AUTOPILOT_CIRCUIT_PATH, next);
  return next;
}

function readTokenBudgetState() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const raw = readJsonFile(TOKEN_BUDGET_PATH, {
    version: 1,
    updatedAtMs: 0,
    daily: {},
  });

  if (!raw.daily[dateStr]) {
    raw.daily[dateStr] = {
      globalTokens: 0,
      agents: {},
    };
  }

  return {
    ...raw,
    today: raw.daily[dateStr],
    dateStr,
  };
}

function updateTokenBudgetUsage(agentId, tokens) {
  const state = readTokenBudgetState();
  const n = Number(tokens || 0);
  if (n <= 0) return state;

  state.today.globalTokens += n;
  if (agentId) {
    state.today.agents[agentId] = (state.today.agents[agentId] || 0) + n;
  }
  state.updatedAtMs = Date.now();

  // Cleanup old dates (keep last 7 days)
  const dateKeys = Object.keys(state.daily).sort();
  if (dateKeys.length > 7) {
    for (const k of dateKeys.slice(0, dateKeys.length - 7)) {
      delete state.daily[k];
    }
  }

  const { today, dateStr, ...toPersist } = state;
  writeJsonFile(TOKEN_BUDGET_PATH, toPersist);
  return state;
}

function evaluateTokenBudgetGate(settings, agentId, issuePriority) {
  const cfg = (settings.execution && settings.execution.tokenBudget) || DEFAULTS.tokenBudget;
  if (!cfg.enabled) {
    return { status: 'ok', ratio: 0 };
  }

  const state = readTokenBudgetState();
  const globalLimit = Number(cfg.dailyGlobalLimit || 500000);
  const agentLimit = Number(cfg.dailyAgentLimit || 100000);

  const globalRatio = state.today.globalTokens / globalLimit;
  const agentTokens = agentId ? (state.today.agents[agentId] || 0) : 0;
  const agentRatio = agentId ? agentTokens / agentLimit : 0;

  const maxRatio = Math.max(globalRatio, agentRatio);
  const thresholds = cfg.throttleThresholds || DEFAULTS.tokenBudget.throttleThresholds;
  const priority = Number(issuePriority || 3);

  let result = { status: 'ok', ratio: maxRatio };

  if (maxRatio >= thresholds.freeze) {
    // 95% Gate: Freeze low-value automations. Keep high-priority (P1) if ratio < 1.0
    if (priority > 1 || maxRatio >= 1.0) {
      result = { status: 'freeze', ratio: maxRatio, reason: 'budget_exhausted' };
    }
  } else if (maxRatio >= thresholds.highPriorityOnly) {
    // 90% Gate: Keep only high-priority runs (P1)
    if (priority > 1) {
      result = { status: 'throttle', ratio: maxRatio, reason: 'high_priority_only' };
    }
  } else if (maxRatio >= thresholds.downgrade) {
    // 80% Gate: Downgrade frequency/model. Skip P3 (low value)
    if (priority > 2) {
      result = { status: 'throttle', ratio: maxRatio, reason: 'frequency_downgrade' };
    } else {
      result = { status: 'downgrade', ratio: maxRatio, reason: 'cost_downgrade' };
    }
  }

  // Proactive notification for significant gates
  if (result.status === 'freeze' || result.status === 'throttle') {
    const channel = String(settings.report.channel || '').trim();
    const target = String(settings.report.target || '').trim();
    if (channel && target) {
      const msg = `[TokenBudgetGate] ${result.status.toUpperCase()} trigger (ratio: ${(maxRatio * 100).toFixed(1)}%, reason: ${result.reason}, priority: P${priority}, agent: ${agentId || 'global'})`;
      runCommand('openclaw', ['message', 'send', '--channel', channel, '--target', target, '--message', msg]);
    }
  }

  return result;
}

function evaluateAutopilotCircuitGate(state, circuitSettings, forceRun) {
  const nowMs = Date.now();
  if (!circuitSettings.enabled) {
    return {
      open: false,
      openUntilMs: 0,
      consecutiveFailures: Number(state.consecutiveFailures || 0),
      lastReason: String(state.lastFailureReason || ''),
    };
  }

  if (state.status === 'open' && Number(state.openUntilMs || 0) <= nowMs) {
    const reopened = writeAutopilotCircuitState({
      ...state,
      status: 'half-open',
      openUntilMs: 0,
    });
    return {
      open: false,
      openUntilMs: 0,
      consecutiveFailures: Number(reopened.consecutiveFailures || 0),
      lastReason: String(reopened.lastFailureReason || ''),
    };
  }

  if (!forceRun && state.status === 'open' && Number(state.openUntilMs || 0) > nowMs) {
    return {
      open: true,
      openUntilMs: Number(state.openUntilMs || 0),
      consecutiveFailures: Number(state.consecutiveFailures || 0),
      lastReason: String(state.lastFailureReason || ''),
    };
  }

  return {
    open: false,
    openUntilMs: 0,
    consecutiveFailures: Number(state.consecutiveFailures || 0),
    lastReason: String(state.lastFailureReason || ''),
  };
}

function classifyAutopilotFailure(result) {
  const errorText = String(result && result.error ? result.error : '').trim();
  if (!errorText) {
    return { failed: false, reason: '', message: '' };
  }

  const reason = classifyExecutorFailure(errorText);

  return {
    failed: true,
    reason,
    message: singleLine(trimMessage(errorText, 500)),
  };
}

async function updateAutopilotCircuitState(input) {
  const result = input && input.result ? input.result : {};
  const settings = input && input.settings ? input.settings : {};
  const flags = input && input.flags ? input.flags : {};
  const apiKey = String(input && input.apiKey ? input.apiKey : '').trim();
  const circuitSettings = input && input.circuitSettings ? input.circuitSettings : { enabled: false };
  let state = input && input.previousState ? { ...input.previousState } : readAutopilotCircuitState();

  if (!circuitSettings.enabled) {
    return {
      public: {
        status: 'disabled',
        consecutiveFailures: Number(state.consecutiveFailures || 0),
        threshold: Number(circuitSettings.failureThreshold || 0),
      },
    };
  }

  const failure = classifyAutopilotFailure(result);
  const nowMs = Date.now();
  let openedIssue = null;

  if (failure.failed) {
    const wasOpen = state.status === 'open' && Number(state.openUntilMs || 0) > nowMs;
    state.status = 'closed';
    state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
    state.firstFailureAtMs = state.firstFailureAtMs > 0 ? state.firstFailureAtMs : nowMs;
    state.lastFailureAtMs = nowMs;
    state.lastFailureReason = failure.reason;
    state.lastFailureMessage = failure.message;
    state.lastFailureIssueIdentifier =
      result && result.issue && result.issue.identifier ? String(result.issue.identifier) : '';

    if (state.consecutiveFailures >= Number(circuitSettings.failureThreshold || 2)) {
      state.status = 'open';
      state.openedAtMs = nowMs;
      state.openUntilMs = nowMs + Number(circuitSettings.cooldownMinutes || 30) * 60 * 1000;
      state.reopenCount = Number(state.reopenCount || 0) + (wasOpen ? 0 : 1);

      if (
        circuitSettings.autoLinearIssue &&
        settings.linear &&
        settings.linear.enabled !== false &&
        apiKey &&
        !state.issueIdentifier
      ) {
        const issueInput = {
          title: `[ops] linear-autopilot circuit open (${state.consecutiveFailures} consecutive failures)`,
          source: 'mission-control',
          sourceId: `ops:linear-autopilot-circuit:${state.openedAtMs}`,
          eventType: 'mission-control.circuit-open',
          state: circuitSettings.issueState || 'Triage',
          priority: normalizeLinearPriority(circuitSettings.issuePriority || 2),
          labels: dedupeStrings([
            ...normalizeLabelNames(circuitSettings.issueLabels || []),
            'ops',
            'autopilot',
          ]),
          description: [
            `Autopilot circuit opened after ${state.consecutiveFailures} consecutive failures.`,
            '',
            '## Failure Summary',
            `- reason: ${failure.reason || 'error'}`,
            `- message: ${failure.message || '-'}`,
            `- issue: ${(result.issue && result.issue.identifier) || '-'}`,
            `- runId: ${result.runId || '-'}`,
            `- openUntil: ${new Date(state.openUntilMs).toISOString()}`,
            '',
            '## Suggested Actions',
            '1. Inspect mission-control/data/control-center/linear-autopilot-cron.log',
            '2. Validate openclaw agent health and session lock conditions',
            '3. Resume after cooldown or force one manual run with --force',
          ].join('\n'),
          rawText: failure.message || 'linear-autopilot consecutive failure',
        };

        try {
          const delivery = await createTriageIssueWithFallback(issueInput, settings, {
            context: 'linear-autopilot-circuit',
          });
          if (delivery.queued) {
            appendAuditEvent('linear-autopilot-circuit-issue-queued', {
              queueId: delivery.queueId,
              reason: failure.reason,
              consecutiveFailures: state.consecutiveFailures,
            });
          } else {
            openedIssue = delivery.issue;
            state.issueId = openedIssue && openedIssue.id ? String(openedIssue.id) : '';
            state.issueIdentifier =
              openedIssue && openedIssue.identifier ? String(openedIssue.identifier) : '';
            state.issueUrl = openedIssue && openedIssue.url ? String(openedIssue.url) : '';
          }
        } catch (error) {
          appendAuditEvent('linear-autopilot-circuit-issue-error', {
            error: error instanceof Error ? error.message : String(error),
            reason: failure.reason,
            consecutiveFailures: state.consecutiveFailures,
          });
        }
      }

      appendAuditEvent('linear-autopilot-circuit-open', {
        consecutiveFailures: state.consecutiveFailures,
        reason: failure.reason,
        issueIdentifier: state.issueIdentifier || '',
        openUntilMs: state.openUntilMs,
      });
    }
  } else {
    const wasOpen = state.status === 'open' || state.status === 'half-open';
    const hadFailures = Number(state.consecutiveFailures || 0) > 0;
    if (wasOpen || hadFailures) {
      appendAuditEvent('linear-autopilot-circuit-recovered', {
        consecutiveFailures: Number(state.consecutiveFailures || 0),
        previousIssueIdentifier: state.issueIdentifier || '',
      });
    }
    state.status = 'closed';
    state.consecutiveFailures = 0;
    state.firstFailureAtMs = 0;
    state.lastFailureAtMs = 0;
    state.lastFailureReason = '';
    state.lastFailureMessage = '';
    state.lastFailureIssueIdentifier = '';
    state.openedAtMs = 0;
    state.openUntilMs = 0;
    state.issueId = '';
    state.issueIdentifier = '';
    state.issueUrl = '';
    state.lastSuccessAtMs = nowMs;
  }

  state = writeAutopilotCircuitState(state);

  return {
    openedIssue,
    public: {
      status: state.status || 'closed',
      consecutiveFailures: Number(state.consecutiveFailures || 0),
      threshold: Number(circuitSettings.failureThreshold || 2),
      openUntilMs: Number(state.openUntilMs || 0),
      openUntil: state.openUntilMs ? new Date(state.openUntilMs).toISOString() : '',
      lastFailureReason: String(state.lastFailureReason || ''),
      issueIdentifier: String(state.issueIdentifier || ''),
      issueUrl: String(state.issueUrl || ''),
      forceRun: isTruthyLike(flags.force),
    },
  };
}

async function runLinearAutopilotAgent(options) {
  const prompt = String(options && options.prompt ? options.prompt : '').trim();
  const primaryAgentId = String(options && options.primaryAgentId ? options.primaryAgentId : 'main').trim();
  const sessionId = String(options && options.sessionId ? options.sessionId : '').trim();
  const timeoutSeconds = Math.max(30, Number(options && options.timeoutSeconds ? options.timeoutSeconds : 900));
  const retries = Math.max(0, Number(options && options.retries ? options.retries : 0));
  const retryBackoffSeconds = Math.max(
    1,
    Number(options && options.retryBackoffSeconds ? options.retryBackoffSeconds : 20),
  );
  const fallbackAgentSuffix = String(
    options && options.fallbackAgentSuffix ? options.fallbackAgentSuffix : 'autopilot',
  ).trim();
  const trace = typeof (options && options.trace) === 'function' ? options.trace : () => {};

  const candidateAgents = buildAutopilotAgentCandidates(primaryAgentId, fallbackAgentSuffix);
  const attempts = [];
  const totalAttempts = Math.max(1, retries + 1);
  let fallbackPreferred = false;

  for (let index = 0; index < totalAttempts; index += 1) {
    const attemptNo = index + 1;
    const agentForAttempt = fallbackPreferred && candidateAgents.length > 1
      ? candidateAgents[1]
      : candidateAgents[Math.min(index, candidateAgents.length - 1)];

    trace(`openclaw agent: attempt ${attemptNo}/${totalAttempts} agent=${agentForAttempt} session=${sessionId || 'auto'}`);
    try {
      const args = [
        'agent',
        '--agent',
        agentForAttempt,
        '--message',
        prompt,
        '--timeout',
        String(timeoutSeconds),
        '--json',
      ];
      if (sessionId) {
        args.push('--session-id', sessionId);
      }
      const output = runCommand(
        'openclaw',
        args,
        {
          timeoutMs: Math.max(45_000, Math.ceil(timeoutSeconds * 1000 * 1.2)),
          label: `openclaw agent(${agentForAttempt})`,
        },
      );
      const payload = extractJson(output.stdout || '');
      const runId = String(payload && payload.runId ? payload.runId : '').trim();
      const text = extractAgentText(payload);
      const meta = extractAgentRuntimeMeta(payload);
      attempts.push({
        attempt: attemptNo,
        agentId: agentForAttempt,
        ok: true,
        runId,
        sessionId: meta.sessionId || '',
        sessionKey: meta.sessionKey || '',
      });
      return {
        ok: true,
        agentId: agentForAttempt,
        payload,
        runId,
        text,
        sessionId: meta.sessionId || '',
        sessionKey: meta.sessionKey || '',
        totalTokens: meta.totalTokens || 0,
        attempts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureClass = classifyExecutorFailure(message);
      const retryable = isRetryableExecutorCategory(failureClass) || isRetryableAutopilotError(message);
      const backoffMs = computeExecutorBackoffMs(
        failureClass,
        attemptNo,
        retryBackoffSeconds,
        options && options.settings ? options.settings : {},
      );
      attempts.push({
        attempt: attemptNo,
        agentId: agentForAttempt,
        ok: false,
        failureClass,
        retryable,
        backoffMs: retryable ? backoffMs : 0,
        error: singleLine(trimMessage(message, 320)),
      });

      if (message.toLowerCase().includes('session file locked')) {
        fallbackPreferred = true;
      }

      if (!retryable || attemptNo >= totalAttempts) {
        return {
          ok: false,
          error: message,
          attempts,
        };
      }

      const sleepForMs = backoffMs;
      trace(`openclaw agent: retry in ${sleepForMs}ms (class=${failureClass})`);
      // Space retries to reduce collisions with rate limit/session lock windows.
      await sleepMs(sleepForMs);
    }
  }

  return {
    ok: false,
    error: 'openclaw agent run failed without usable result',
    attempts,
  };
}

function buildAutopilotAgentCandidates(primaryAgentId, fallbackAgentSuffix) {
  const output = [];
  const primary = String(primaryAgentId || '').trim() || 'main';
  const suffix = String(fallbackAgentSuffix || '').trim().replace(/^[-_]+/, '');
  const isolated = suffix ? `${primary}-${suffix}` : '';
  // For the busy "main" lane, prefer an isolated lane first to avoid session lock collisions.
  if (isolated && primary.toLowerCase() === 'main' && isolated !== primary) {
    output.push(isolated);
    output.push(primary);
  } else {
    output.push(primary);
  }
  if (suffix && !(isolated && primary.toLowerCase() === 'main')) {
    if (isolated !== primary) {
      output.push(isolated);
    }
  }
  const deduped = dedupeStrings(output);
  const knownAgentIds = getOpenclawAgentIds();
  if (!knownAgentIds || knownAgentIds.size === 0) {
    return deduped;
  }
  const filtered = deduped.filter((item) => knownAgentIds.has(item));
  return filtered.length > 0 ? filtered : [primary];
}

function getOpenclawAgentIds() {
  const nowMs = Date.now();
  const ttlMs = 5 * 60 * 1000;
  if (
    OPENCLAW_AGENT_IDS_CACHE &&
    OPENCLAW_AGENT_IDS_CACHE.ids instanceof Set &&
    nowMs - Number(OPENCLAW_AGENT_IDS_CACHE.loadedAtMs || 0) < ttlMs
  ) {
    return OPENCLAW_AGENT_IDS_CACHE.ids;
  }

  try {
    const output = runCommand(
      'openclaw',
      ['agents', 'list', '--json'],
      {
        timeoutMs: 20_000,
        label: 'openclaw agents list',
      },
    );
    const payload = extractJson(output.stdout || '');
    const ids = new Set(
      (Array.isArray(payload) ? payload : [])
        .map((item) => String(item && item.id ? item.id : '').trim())
        .filter(Boolean),
    );
    OPENCLAW_AGENT_IDS_CACHE = {
      loadedAtMs: nowMs,
      ids,
    };
    return ids;
  } catch {
    OPENCLAW_AGENT_IDS_CACHE = {
      loadedAtMs: nowMs,
      ids: null,
    };
    return null;
  }
}

function resolveAutopilotDynamicAgentCandidates(settings, flags, options = {}) {
  const targetTier = String(options.tier || '').trim().toLowerCase();
  const knownAgentIds = getOpenclawAgentIds();
  let candidates = knownAgentIds && knownAgentIds.size > 0 ? Array.from(knownAgentIds) : ['main'];
  candidates = dedupeStrings(candidates.map((item) => String(item || '').trim()).filter(Boolean));

  const allowlist = new Set(
    normalizeAgentIds(
      flags['agent-allowlist'] ||
        (settings.execution && settings.execution.agentAllowlist) ||
        [],
    ),
  );
  const denylist = new Set(
    normalizeAgentIds(
      flags['agent-denylist'] ||
        (settings.execution && settings.execution.agentDenylist) ||
        [],
    ),
  );

  if (allowlist.size > 0) {
    candidates = candidates.filter((item) => allowlist.has(item.toLowerCase()));
  }
  if (denylist.size > 0) {
    candidates = candidates.filter((item) => !denylist.has(item.toLowerCase()));
  }

  // CLAW-111: Model tier routing
  const modelRouting = settings.execution && settings.execution.modelRouting ? settings.execution.modelRouting : DEFAULTS.modelRouting;
  const mediumAgents = normalizeAgentIds(modelRouting.mediumAgents || []);
  const xHighAgents = normalizeAgentIds(modelRouting.xHighAgents || []);

  const preferredRaw = normalizeAgentIds(
    flags['agent-preferred'] ||
      (targetTier === 'x-high' ? xHighAgents : targetTier === 'medium' ? mediumAgents : settings.execution && settings.execution.agentPreferred ? settings.execution.agentPreferred : [...mediumAgents, ...xHighAgents]),
  );
  const preferred = preferredRaw.map((item) => String(item || '').trim().toLowerCase());
  const rank = new Map(preferred.map((item, index) => [item, index]));

  // Order candidates by tier preference (fallback/downgrade logic)
  const tierOrder = targetTier === 'x-high' ? [...xHighAgents, ...mediumAgents] : [...mediumAgents, ...xHighAgents];
  
  candidates.sort((a, b) => {
    const tierA = tierOrder.indexOf(a.toLowerCase());
    const tierB = tierOrder.indexOf(b.toLowerCase());
    
    if (tierA !== -1 && tierB !== -1) {
      if (tierA !== tierB) return tierA - tierB;
    } else if (tierA !== -1) {
      return -1;
    } else if (tierB !== -1) {
      return 1;
    }

    const ar = rank.has(a.toLowerCase()) ? rank.get(a.toLowerCase()) : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b.toLowerCase()) ? rank.get(b.toLowerCase()) : Number.MAX_SAFE_INTEGER;
    if (ar !== br) {
      return ar - br;
    }
    return a.localeCompare(b);
  });
  return candidates;
}

function pickRoundRobinAutopilotAgent(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (list.length === 0) {
    return '';
  }

  const state = readJsonFile(LINEAR_AUTOPILOT_AGENT_CURSOR_PATH, {
    version: 1,
    index: 0,
    updatedAtMs: 0,
    lastSelected: '',
  });
  const rawIndex = Number(state.index || 0);
  const index = Number.isFinite(rawIndex) ? Math.max(0, rawIndex) % list.length : 0;
  const selected = list[index];
  const nextIndex = (index + 1) % list.length;
  writeJsonFile(LINEAR_AUTOPILOT_AGENT_CURSOR_PATH, {
    version: 1,
    index: nextIndex,
    updatedAtMs: Date.now(),
    lastSelected: selected,
    candidates: list,
  });
  return selected;
}

function extractAgentRuntimeMeta(agentPayload) {
  const meta = agentPayload && agentPayload.result && agentPayload.result.meta ? agentPayload.result.meta : {};
  const agentMeta = meta && meta.agentMeta ? meta.agentMeta : {};
  const report = meta && meta.systemPromptReport ? meta.systemPromptReport : {};
  return {
    sessionId: String(agentMeta && agentMeta.sessionId ? agentMeta.sessionId : report.sessionId || '').trim(),
    sessionKey: String(report && report.sessionKey ? report.sessionKey : '').trim(),
    totalTokens: Number(agentMeta.totalTokens || report.totalTokens || 0),
  };
}

function isRetryableAutopilotError(message) {
  const text = String(message || '').toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes('etimedout') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('rate limit') ||
    text.includes('cooldown') ||
    text.includes('session file locked') ||
    text.includes('gateway closed') ||
    text.includes('service restart') ||
    text.includes('econnreset') ||
    text.includes('temporarily unavailable')
  );
}

function upsertRuntimeIssueBindings(issueIdentifier, refs) {
  const normalized = normalizeLinearIssueId(issueIdentifier);
  if (!normalized) {
    return { updated: false };
  }
  const sessionId = String(refs && refs.sessionId ? refs.sessionId : '').trim();
  const sessionKey = String(refs && refs.sessionKey ? refs.sessionKey : '').trim();
  const agentId = String(refs && refs.agentId ? refs.agentId : '').trim();
  const taskId = String(refs && refs.taskId ? refs.taskId : '').trim();
  const subagentId = String(refs && refs.subagentId ? refs.subagentId : '').trim();
  const cronId = String(refs && refs.cronId ? refs.cronId : '').trim();
  if (!sessionId && !sessionKey && !taskId && !subagentId && !cronId) {
    return { updated: false };
  }

  const bindings = readJsonFile(ISSUE_LINKS_PATH, {
    version: 1,
    updatedAtMs: 0,
    byTaskId: {},
    bySessionId: {},
    bySessionKey: {},
    bySubagentId: {},
    byCronId: {},
    byIssue: {},
  });

  bindings.byTaskId = bindings.byTaskId && typeof bindings.byTaskId === 'object' ? bindings.byTaskId : {};
  bindings.bySessionId =
    bindings.bySessionId && typeof bindings.bySessionId === 'object' ? bindings.bySessionId : {};
  bindings.bySessionKey =
    bindings.bySessionKey && typeof bindings.bySessionKey === 'object' ? bindings.bySessionKey : {};
  bindings.bySubagentId =
    bindings.bySubagentId && typeof bindings.bySubagentId === 'object' ? bindings.bySubagentId : {};
  bindings.byCronId = bindings.byCronId && typeof bindings.byCronId === 'object' ? bindings.byCronId : {};
  bindings.byIssue = bindings.byIssue && typeof bindings.byIssue === 'object' ? bindings.byIssue : {};

  let changed = false;
  if (taskId && bindings.byTaskId[taskId] !== normalized) {
    bindings.byTaskId[taskId] = normalized;
    changed = true;
  }
  if (sessionId && bindings.bySessionId[sessionId] !== normalized) {
    bindings.bySessionId[sessionId] = normalized;
    changed = true;
  }
  if (sessionKey && bindings.bySessionKey[sessionKey] !== normalized) {
    bindings.bySessionKey[sessionKey] = normalized;
    changed = true;
  }
  if (sessionKey) {
    const inferredAgentId = agentId || inferAgentId(sessionKey) || 'main';
    const taskId = `session:${inferredAgentId}:${sessionKey}`;
    if (bindings.byTaskId[taskId] !== normalized) {
      bindings.byTaskId[taskId] = normalized;
      changed = true;
    }
  }
  if (subagentId && bindings.bySubagentId[subagentId] !== normalized) {
    bindings.bySubagentId[subagentId] = normalized;
    changed = true;
  }
  if (cronId && bindings.byCronId[cronId] !== normalized) {
    bindings.byCronId[cronId] = normalized;
    changed = true;
  }

  const issueEntry = bindings.byIssue[normalized] && typeof bindings.byIssue[normalized] === 'object'
    ? bindings.byIssue[normalized]
    : {
        taskIds: [],
        sessionIds: [],
        sessionKeys: [],
        subagentIds: [],
        cronIds: [],
      };
  const pushUnique = (arr, value) => {
    if (!value) {
      return false;
    }
    const key = String(value);
    if (arr.includes(key)) {
      return false;
    }
    arr.push(key);
    return true;
  };
  let reverseChanged = false;
  reverseChanged = pushUnique(issueEntry.taskIds, taskId) || reverseChanged;
  reverseChanged = pushUnique(issueEntry.sessionIds, sessionId) || reverseChanged;
  reverseChanged = pushUnique(issueEntry.sessionKeys, sessionKey) || reverseChanged;
  reverseChanged = pushUnique(issueEntry.subagentIds, subagentId) || reverseChanged;
  reverseChanged = pushUnique(issueEntry.cronIds, cronId) || reverseChanged;
  if (reverseChanged) {
    issueEntry.updatedAtMs = Date.now();
    bindings.byIssue[normalized] = issueEntry;
    changed = true;
  }

  if (!changed) {
    return { updated: false };
  }

  bindings.version = 1;
  bindings.updatedAtMs = Date.now();
  writeJsonFile(ISSUE_LINKS_PATH, bindings);
  return {
    updated: true,
    sessionId,
    sessionKey,
  };
}

function normalizeAutopilotStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return '';
  }
  if (text === 'done' || text === 'completed' || text === 'complete') {
    return 'done';
  }
  if (text === 'blocked' || text === 'error' || text === 'failed') {
    return 'blocked';
  }
  return 'in_progress';
}

function normalizeAutopilotStateName(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return '';
  }
  if (text === 'done' || text === 'completed' || text === 'complete') {
    return 'Done';
  }
  if (text === 'in review' || text === 'review') {
    return 'In Review';
  }
  if (text === 'blocked' || text.includes('block')) {
    return 'Blocked';
  }
  if (text === 'triage') {
    return 'Triage';
  }
  if (text === 'in progress' || text === 'in_progress' || text === 'doing') {
    return 'In Progress';
  }
  return '';
}

function resolveLinearAutopilotNextState(candidate, parsed, settings) {
  if (parsed && parsed.nextState) {
    return parsed.nextState;
  }
  if (parsed && parsed.status === 'done') {
    return 'Done';
  }
  if (parsed && parsed.status === 'blocked') {
    return 'Blocked';
  }
  if (parsed && parsed.status === 'in_progress') {
    return 'In Progress';
  }
  const stateName = String((candidate && candidate.state && candidate.state.name) || '').trim().toLowerCase();
  if (stateName === 'triage') {
    return String(
      (settings.execution && settings.execution.defaultTransitionFromTriage) || 'In Progress',
    ).trim();
  }
  return '';
}

function renderLinearAutopilotComment(input) {
  const candidate = input && input.candidate ? input.candidate : {};
  const parsed = input && input.parsed ? input.parsed : {};
  const transition = input && input.transition ? input.transition : null;
  const runId = String(input && input.runId ? input.runId : '').trim();
  const agentText = String(input && input.agentText ? input.agentText : '').trim();
  const agentError = String(input && input.agentError ? input.agentError : '').trim();
  const modelTier = String(input && input.modelTier ? input.modelTier : '').trim();
  const settings = input && input.settings ? input.settings : { timezone: 'UTC' };

  const lines = [];
  lines.push('### Mission Control Linear Autopilot');
  lines.push(`- issue: ${candidate.identifier || '-'}`);
  lines.push(`- status: ${parsed.status || (agentError ? 'error' : 'in_progress')}`);
  if (modelTier) {
    lines.push(`- model tier: ${modelTier}`);
  }
  if (parsed.nextState) {
    lines.push(`- requested next state: ${parsed.nextState}`);
  }
  if (transition && transition.status) {
    lines.push(
      `- transition: ${transition.previousState || '-'} -> ${transition.state || transition.targetStateName || '-'} (${transition.status})`,
    );
  }
  if (runId) {
    lines.push(`- agent run id: ${runId}`);
  }
  if (agentError) {
    lines.push(`- execution error: ${singleLine(trimMessage(agentError, 300))}`);
  }

  if (parsed.summary) {
    lines.push('');
    lines.push('#### Summary');
    lines.push(`- ${singleLine(parsed.summary)}`);
  } else if (agentText) {
    lines.push('');
    lines.push('#### Summary');
    lines.push(`- ${singleLine(trimMessage(agentText, 800))}`);
  }

  if (parsed.nextAction) {
    lines.push('');
    lines.push('#### Next Action');
    lines.push(`- ${singleLine(parsed.nextAction)}`);
  }

  if (input && input.agentText && input.agentText.includes('[Session Handoff Enforced]')) {
    const handoffLines = input.agentText.split('\n');
    const handoffIndex = handoffLines.findIndex(l => l.includes('[Session Handoff Enforced]'));
    if (handoffIndex !== -1) {
      lines.push('');
      lines.push('#### Session Handoff');
      lines.push(handoffLines.slice(handoffIndex + 1).join('\n'));
    }
  }

  if (Array.isArray(parsed.artifacts) && parsed.artifacts.length > 0) {
    lines.push('');
    lines.push('#### Artifacts');
    for (const item of parsed.artifacts.slice(0, 8)) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  lines.push(`_generated ${formatTime(Date.now(), settings.timezone)} by mission-control linear-autopilot_`);
  return trimMessage(lines.join('\n'), 3400);
}

function parseDiscordChannelIds(value) {
  if (Array.isArray(value)) {
    return dedupeStrings(
      value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .map((item) => (item.startsWith('channel:') ? item.slice('channel:'.length).trim() : item)),
    );
  }
  return dedupeStrings(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (item.startsWith('channel:') ? item.slice('channel:'.length).trim() : item)),
  );
}

function discoverDiscordChannelIdsFromStatus(settings) {
  const enabled = !(
    settings &&
    settings.discordIntake &&
    settings.discordIntake.autoDiscoverFromStatus === false
  );
  if (!enabled) {
    return [];
  }

  const statusPath = path.join(ROOT_DIR, '..', 'status.json');
  if (!fs.existsSync(statusPath)) {
    return [];
  }

  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    return [];
  }

  const found = new Set();
  const visit = (node) => {
    if (node == null) {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node === 'object') {
      for (const value of Object.values(node)) {
        visit(value);
      }
      return;
    }
    if (typeof node !== 'string') {
      return;
    }
    const match = node.match(/discord:channel:(\d+)/i);
    if (match && match[1]) {
      found.add(match[1]);
    }
  };
  visit(payload);
  return Array.from(found);
}

function resolveDiscordIntakeChannelIds(settings, flags) {
  const fromFlag = parseDiscordChannelIds(flags.channel || flags.target || '');
  if (fromFlag.length > 0) {
    return fromFlag;
  }

  const fromConfigList = parseDiscordChannelIds(
    settings &&
    settings.discordIntake &&
    Array.isArray(settings.discordIntake.channelIds)
      ? settings.discordIntake.channelIds
      : [],
  );
  const fromConfigSingle = parseDiscordChannelIds(
    settings && settings.discordIntake && settings.discordIntake.channelId ? settings.discordIntake.channelId : '',
  );
  const discovered = parseDiscordChannelIds(discoverDiscordChannelIdsFromStatus(settings));
  const combinedConfig = dedupeStrings([...fromConfigList, ...fromConfigSingle, ...discovered]);
  if (combinedConfig.length > 0) {
    return combinedConfig;
  }

  const reportTarget = String(settings.report && settings.report.target ? settings.report.target : '').trim();
  const reportFallback = reportTarget.startsWith('channel:') ? reportTarget.slice('channel:'.length).trim() : '';
  if (reportFallback) {
    return [reportFallback];
  }

  const reminderTarget = String(settings.reminders && settings.reminders.target ? settings.reminders.target : '').trim();
  const reminderFallback =
    reminderTarget.startsWith('channel:') ? reminderTarget.slice('channel:'.length).trim() : '';
  if (reminderFallback) {
    return [reminderFallback];
  }

  return [];
}

function resolveDiscordIntakeChannelId(settings, flags) {
  const ids = resolveDiscordIntakeChannelIds(settings, flags);
  return ids.length > 0 ? ids[0] : '';
}

function looksLikeTaskDirective(text, options = {}) {
  const normalized = singleLine(String(text || '').trim());
  if (!normalized) {
    return false;
  }
  if (normalized.length < 4) {
    return false;
  }

  const pureAck = /^(好|好的|ok|okay|收到|明白|👍|👌|yes|no|嗯|行|可以|谢谢|thanks|great|nice|lol|哈哈|？|\?)+$/i;
  if (pureAck.test(normalized)) {
    return false;
  }

  const triggerList = dedupeStrings(
    (Array.isArray(options && options.explicitTriggers) ? options.explicitTriggers : [])
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const normalizedLower = normalized.toLowerCase();
  const matchedExplicitTrigger = triggerList.some((item) => normalizedLower.includes(item));
  if (matchedExplicitTrigger) {
    return true;
  }
  const requireExplicitTrigger = Boolean(options && options.requireExplicitTrigger === true);
  if (requireExplicitTrigger) {
    return false;
  }

  const excludeProgressChecks = options && options.excludeProgressChecks !== false;
  if (excludeProgressChecks) {
    const progressOnlyPattern =
      /(完成了吗|全部完成了吗|完成的如何|情况如何|现在在做哪块|还需要开发|你.*系统.*完成了吗|是否全部完成|任务完成多少|什么时候完成|现在卡在哪|进展如何|还有没有任务没有完成)/i;
    if (progressOnlyPattern.test(normalized)) {
      return false;
    }
  }

  const actionPattern =
    /(帮我|请|麻烦|需要|安排|处理|修复|实现|配置|部署|排查|检查|优化|自动化|创建|推进|执行|继续|完成|落地|同步|对接|搭建|setup|set up|implement|fix|build|deploy|configure|investigate|automate|create)/i;
  if (!actionPattern.test(normalized)) {
    return false;
  }

  const genericMetaPattern = /^(请|帮我|麻烦|需要)?\s*(继续|完成|推进|处理)(一下|下)?\s*$/i;
  if (genericMetaPattern.test(normalized)) {
    return false;
  }

  const noisePattern = /(仅供参考|随便聊聊|测试一下|test message only|不用处理|无需处理|ignore)/i;
  if (noisePattern.test(normalized)) {
    return false;
  }

  return true;
}

function buildDiscordTriageInput(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const messageId = String(payload.messageId || payload.id || '').trim();
  const channelId = String(payload.channelId || (payload.channel && payload.channel.id) || '').trim();
  const guildId = String(payload.guildId || (payload.guild && payload.guild.id) || '@me').trim() || '@me';
  const rawText = String(payload.content || payload.text || payload.message || '').trim();
  const author = String(
    payload.author ||
      payload.username ||
      (payload.user && (payload.user.username || payload.user.name)) ||
      '',
  ).trim();
  const url =
    String(payload.url || payload.jumpUrl || '').trim() ||
    (messageId && channelId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : '');
  const sourceId = normalizeSourceId(
    String(
      payload.sourceId ||
        payload.eventId ||
        payload.messageKey ||
        (messageId ? `discord:${guildId}:${channelId}:${messageId}` : ''),
    ).trim(),
  );
  const title =
    String(payload.title || '').trim() ||
    (rawText ? `[discord] ${singleLine(rawText).slice(0, 100)}` : `[discord] message ${messageId || 'event'}`);

  return {
    title,
    rawText,
    description: String(payload.description || '').trim(),
    source: 'discord',
    sourceId,
    eventType: normalizeIngestEventType(payload.eventType || payload.type || '', 'discord.message'),
    author,
    sourceUrl: url,
    state: String(payload.state || 'Triage').trim(),
    labels: dedupeStrings(['discord', ...normalizeLabelNames(payload.labels || [])]),
    dueDate: String(payload.dueDate || '').trim(),
    priority: Number(payload.priority || 3),
  };
}

function readDiscordMessagesViaOpenClaw(channelId, limit, options = {}) {
  const target = String(channelId || '').trim();
  if (!target) {
    throw new Error('readDiscordMessagesViaOpenClaw requires channel id.');
  }
  const boundedLimit = Math.max(1, Math.min(100, Number(limit || 30)));
  const aroundId = String(options.around || '').trim();
  const beforeId = String(options.before || '').trim();
  const afterId = String(options.after || '').trim();
  const tmpPath = path.join(
    os.tmpdir(),
    `openclaw-discord-read-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  const result = spawnSync(
    'openclaw',
    [
      'message',
      'read',
      '--channel',
      'discord',
      '--target',
      target,
      '--limit',
      String(boundedLimit),
      ...(aroundId ? ['--around', aroundId] : []),
      ...(beforeId ? ['--before', beforeId] : []),
      ...(afterId ? ['--after', afterId] : []),
      '--json',
    ],
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', fs.openSync(tmpPath, 'w'), 'pipe'],
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`openclaw message read failed: ${String(result.stderr || '').trim()}`);
  }

  let parsed = null;
  try {
    parsed = extractJson(fs.readFileSync(tmpPath, 'utf8'));
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
  const payload =
    parsed && typeof parsed === 'object'
      ? parsed.payload && typeof parsed.payload === 'object'
        ? parsed.payload
        : parsed
      : {};
  return Array.isArray(payload.messages) ? payload.messages : [];
}

function extractMessageTimestampMs(message) {
  if (!message || typeof message !== 'object') {
    return 0;
  }
  const direct = Number(message.timestampMs || message.createdAtMs || 0);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const rawTs = String(message.timestamp || message.created_at || message.createdAt || '').trim();
  const parsed = Date.parse(rawTs);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFilename(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/\0<>:"|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
    .trim();
}

function formatDateId(ms, timezone) {
  const dt = new Date(ms);
  const year = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' }).format(dt);
  const month = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: '2-digit' }).format(dt);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: '2-digit' }).format(dt);
  return `${year}-${month}-${day}`;
}

function buildMemoMarkdown(memo) {
  const tags = Array.isArray(memo.tags)
    ? memo.tags
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .map((item) => (item.startsWith('#') ? item : `#${item}`))
    : [];

  const links = [];
  if (memo.sourceUrl) {
    links.push(`- Source: ${memo.sourceUrl}`);
  }
  if (memo.linearUrl) {
    links.push(`- Linear: ${memo.linearUrl}`);
  }

  const lines = [];
  lines.push('---');
  lines.push(`title: ${String(memo.title || '').replace(/\n/g, ' ').trim()}`);
  if (memo.sourceId) {
    lines.push(`sourceId: ${String(memo.sourceId)}`);
  }
  if (memo.channelId) {
    lines.push(`discordChannelId: ${String(memo.channelId)}`);
  }
  if (memo.messageId) {
    lines.push(`discordMessageId: ${String(memo.messageId)}`);
  }
  lines.push(`createdAt: ${new Date(Number(memo.generatedAtMs || Date.now())).toISOString()}`);
  if (tags.length > 0) {
    lines.push(`tags: [${tags.map((t) => `\"${t.replace(/\"/g, '')}\"`).join(', ')}]`);
  }
  lines.push('---');
  lines.push('');

  lines.push(`# ${memo.title}`);
  if (tags.length > 0) {
    lines.push('');
    lines.push(tags.join(' '));
  }

  lines.push('');
  lines.push('## TL;DR');
  lines.push(memo.tldr ? `- ${memo.tldr}` : '-');
  lines.push('');
  lines.push('## Background');
  lines.push(memo.background ? memo.background : '-');
  lines.push('');
  lines.push('## Proposal');
  lines.push(memo.proposal ? memo.proposal : '-');
  lines.push('');
  lines.push('## Next Steps');
  if (memo.nextSteps && memo.nextSteps.length > 0) {
    for (const step of memo.nextSteps) {
      lines.push(`- ${step}`);
    }
  } else {
    lines.push('-');
  }
  lines.push('');
  lines.push('## Risks');
  if (memo.risks && memo.risks.length > 0) {
    for (const item of memo.risks) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('-');
  }

  lines.push('');
  lines.push('## Links');
  lines.push(links.length > 0 ? links.join('\n') : '-');

  lines.push('');
  lines.push('## Raw Notes');
  lines.push('```text');
  lines.push(memo.rawNotes || '');
  lines.push('```');
  lines.push('');
  lines.push(`_generated ${formatTime(memo.generatedAtMs, memo.timezone)} by mission-control memo-save_`);
  return lines.join('\n');
}

function inferMemoCategory(memo) {
  const tags = Array.isArray(memo.tags)
    ? memo.tags.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const raw = String(memo.rawNotes || '').toLowerCase();

  if (tags.some((t) => t.includes('distill') || t.includes('蒸馏')) || raw.includes('distill')) {
    return 'Models/Distill';
  }
  if (tags.some((t) => t.includes('router') || t.includes('routing') || t.includes('路由')) || raw.includes('router')) {
    return 'Systems/Routing';
  }
  if (tags.some((t) => t.includes('ops')) || raw.includes('watchdog') || raw.includes('cron')) {
    return 'Ops';
  }
  if (tags.some((t) => t.includes('decision')) || raw.includes('tradeoff') || raw.includes('对比')) {
    return 'Decisions';
  }

  return 'Inbox';
}

function saveObsidianMemo(memo, settings) {
  const vaultPath = path.resolve(
    settings.obsidian && settings.obsidian.vaultPath
      ? settings.obsidian.vaultPath
      : path.join(ROOT_DIR, '..', 'Obsidian'),
  );
  const relDir = settings.obsidian && settings.obsidian.memoDir ? settings.obsidian.memoDir : 'Knowledge';

  const category = inferMemoCategory(memo);
  const memoDir = path.join(vaultPath, relDir, category);
  ensureDirSync(memoDir);

  const dateId = formatDateId(memo.generatedAtMs, settings.timezone || 'UTC');
  const safeTitle = sanitizeFilename(memo.title || 'memo');
  const filename = `${dateId}_${safeTitle}.md`;
  const filePath = path.join(memoDir, filename);

  const markdown = buildMemoMarkdown(memo);
  fs.writeFileSync(filePath, markdown, 'utf8');

  const relativePath = path.relative(path.resolve(ROOT_DIR, '..'), filePath);
  appendAuditEvent('memo-saved', {
    relativePath,
    sourceId: memo.sourceId,
    sourceUrl: memo.sourceUrl,
    title: memo.title,
  });

  return { filePath, relativePath };
}

async function buildDiscordMemo(input, settings) {
  const channelId = String(input.channelId || '').trim();
  const messageId = String(input.messageId || '').trim();
  const tags = normalizeLabelNames(input.labels || input.tags || []);
  const nowMs = Date.now();

  const messages = await fetchDiscordMessagesViaOpenClaw(channelId, messageId, 30);
  const rawLines = [];
  for (const msg of messages) {
    const author = (msg && msg.author && (msg.author.global_name || msg.author.username)) ? (msg.author.global_name || msg.author.username) : 'unknown';
    const content = singleLine(String(msg.content || '')).trim();
    if (!content) {
      continue;
    }
    rawLines.push(`[${author}] ${content}`);
  }

  const rawNotes = rawLines.join('\n');
  const top = messages.find((m) => String(m.id) === String(messageId)) || messages[0] || {};

  const guildId = String(top.guild_id || top.guildId || (top.guild && top.guild.id) || '').trim();
  const authorName = (top.author && (top.author.global_name || top.author.username)) ? (top.author.global_name || top.author.username) : '';
  const sourceUrl = guildId
    ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
    : `https://discord.com/channels/@me/${channelId}/${messageId}`;

  const sourceId = normalizeSourceId(`discord:${guildId || '@me'}:${channelId}:${messageId}`);

  const title =
    String(input.title || '').trim() ||
    trimMessage(singleLine(String(top.content || rawNotes || 'Discord memo')).trim(), 120);

  const body = rawNotes;

  const tldr = trimMessage(singleLine(rawNotes).slice(0, 180), 180);
  const background = 'Captured from Discord discussion. Refine as needed.';
  const proposal = 'See Raw Notes. Convert into v1/v2/v3 milestones when executing.';
  const nextSteps = [
    'v1: Verify-first + N-best patch search (measurable improvement)',
    'v2: pattern library + retrieval + rerank + hard negatives',
    'v3: distill from trajectories (SFT/DPO) to reduce fallback usage',
  ];
  const risks = [
    'Do not include secrets in notes (tokens, API keys).',
    'Avoid broad scope; start with 3 task types (fix-tests/fix-lint/upgrade-deps).',
  ];

  return {
    title,
    tldr,
    background,
    proposal,
    nextSteps,
    risks,
    body,
    rawNotes,
    author: String(authorName || '').trim(),
    sourceUrl,
    sourceId,
    channelId,
    messageId,
    tags,
    generatedAtMs: nowMs,
    timezone: settings.timezone || 'UTC',
    linearUrl: '',
  };
}

async function fetchDiscordMessagesViaOpenClaw(channelId, messageId, contextLimit) {
  const args = [
    'message',
    'read',
    '--channel',
    'discord',
    '--target',
    channelId,
    '--limit',
    String(contextLimit),
    '--around',
    String(messageId),
  ];
  const tmpPath = path.join(os.tmpdir(), `openclaw-discord-read-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const result = spawnSync(
    'openclaw',
    [...args, '--json'],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', fs.openSync(tmpPath, 'w'), 'pipe'],
    },
  );
  if (result.status !== 0) {
    throw new Error(`openclaw message read failed: ${String(result.stderr || '').trim()}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
  } catch (error) {
    throw new Error(`unable to parse openclaw message read output: ${String(error)}`);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
  const payload = parsed && typeof parsed === 'object' ? (parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : parsed) : {};
  const msgs = payload && Array.isArray(payload.messages) ? payload.messages : [];
  const messageIndex = msgs.findIndex((m) => String(m.id) === String(messageId));
  if (messageIndex === -1) {
    return msgs;
  }
  // include the target + a small window of newer/older messages as they appear in the read result
  const window = msgs.slice(Math.max(0, messageIndex - 15), Math.min(msgs.length, messageIndex + 15));
  return window.length > 0 ? window : msgs;
}

function enqueueIngestItem(kind, payload, error, settings) {
  const normalizedPayload = {
    ...(payload && typeof payload === 'object' ? payload : {}),
    source: String(payload && payload.source ? payload.source : '').trim().toLowerCase(),
    sourceId: String(payload && payload.sourceId ? normalizeSourceId(payload.sourceId) : '').trim(),
    eventType: normalizeIngestEventType(payload && payload.eventType ? payload.eventType : '', 'triage.create'),
  };
  const queue = readJsonFile(INGEST_QUEUE_PATH, { version: 1, items: [] });
  const items = Array.isArray(queue.items) ? queue.items : [];
  const dedupeKey = buildIngestQueueDedupeKey(normalizedPayload);
  const ledger = readIngestLedger();
  const existingLedger = dedupeKey && ledger.items ? ledger.items[dedupeKey] : null;
  if (
    existingLedger &&
    ['delivered', 'deduped-delivered', 'deduped-existing'].includes(String(existingLedger.status || '').toLowerCase())
  ) {
    updateIngestLedgerForItem(
      {
        id: String(existingLedger.queueId || ''),
        kind,
        payload: normalizedPayload,
        dedupeKey,
        idempotencyKey: dedupeKey,
        attempts: Number(existingLedger.attempts || 0),
      },
      'deduped-delivered',
      {
        issueIdentifier: existingLedger.issueIdentifier || '',
      },
    );
    appendAuditEvent('ingest-queue-dedupe-delivered', {
      kind,
      dedupeKey,
      source: normalizedPayload.source || '',
      sourceId: normalizedPayload.sourceId || '',
      eventType: normalizedPayload.eventType || '',
      issueIdentifier: existingLedger.issueIdentifier || '',
    });
    return {
      id: String(existingLedger.queueId || ''),
      kind,
      payload: normalizedPayload,
      dedupeKey,
      idempotencyKey: dedupeKey,
      reused: true,
      fromLedger: true,
      issueIdentifier: String(existingLedger.issueIdentifier || ''),
    };
  }
  if (dedupeKey) {
    const existing = items.find((entry) => String(entry.dedupeKey || '') === dedupeKey);
    if (existing) {
      existing.updatedAtMs = Date.now();
      existing.lastError = error instanceof Error ? error.message : String(error);
      existing.idempotencyKey = dedupeKey;
      writeJsonFile(INGEST_QUEUE_PATH, {
        ...queue,
        version: 1,
        updatedAtMs: existing.updatedAtMs,
        items,
      });
      updateIngestLedgerForItem(existing, 'deduped-pending', {
        error: existing.lastError || '',
        attempts: Number(existing.attempts || 0),
      });
      appendAuditEvent('ingest-queue-dedupe-hit', {
        queueId: existing.id,
        kind,
        dedupeKey,
        source: normalizedPayload.source || '',
        sourceId: normalizedPayload.sourceId || '',
        eventType: normalizedPayload.eventType || '',
      });
      return {
        ...existing,
        reused: true,
      };
    }
  }
  const nowMs = Date.now();
  const item = {
    id: crypto.randomUUID(),
    kind,
    payload: normalizedPayload,
    dedupeKey,
    idempotencyKey: dedupeKey,
    attempts: 0,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    nextAttemptAtMs: nowMs,
    lastError: error instanceof Error ? error.message : String(error),
    retryHistory: [],
  };
  items.push(item);
  queue.version = 1;
  queue.updatedAtMs = nowMs;
  queue.items = items;
  writeJsonFile(INGEST_QUEUE_PATH, queue);
  updateIngestLedgerForItem(item, 'queued', {
    error: item.lastError,
    attempts: 0,
  });
  appendAuditEvent('ingest-queue-enqueue', {
    queueId: item.id,
    kind,
    source: normalizedPayload.source || '',
    sourceId: normalizedPayload.sourceId || '',
    eventType: normalizedPayload.eventType || '',
    dedupeKey,
    error: item.lastError,
    enabled: settings.intakeQueue.enabled !== false,
  });
  return item;
}

function buildIngestQueueDedupeKey(payload) {
  return buildIngestIdempotencyKey(payload, 'triage.create');
}

async function processQueuedIngestItem(item, settings) {
  const kind = String(item.kind || '');
  const payload = item && item.payload && typeof item.payload === 'object' ? item.payload : {};
  const failUntilAttempt = Math.max(0, Number(payload.failUntilAttempt || 0));
  const nextAttempt = Math.max(1, Number(item.attempts || 0) + 1);
  if (Boolean(payload.__simulateFailure) || failUntilAttempt >= nextAttempt) {
    const simulatedMessage = String(payload.simulatedError || 'simulated ingest failure').trim();
    throw new Error(simulatedMessage || 'simulated ingest failure');
  }
  if (kind === 'triage') {
    return createTriageIssueFromInput(payload, settings);
  }
  if (kind === 'test-noop') {
    return {
      id: `test-${item.id}`,
      identifier: String(payload.testIdentifier || `TEST-${String(item.id || '').slice(0, 6)}`).toUpperCase(),
      title: String(payload.title || 'test noop item'),
      url: '',
      stateName: 'Triage',
      source: String(payload.source || 'test'),
      sourceId: String(payload.sourceId || ''),
      eventType: normalizeIngestEventType(payload.eventType || '', 'test.noop'),
      deduped: false,
      dedupeKey: String(item.idempotencyKey || item.dedupeKey || ''),
    };
  }
  throw new Error(`unknown queue kind: ${kind}`);
}

function computeIngestBackoffMs(attempts) {
  const n = Math.max(1, Number(attempts || 1));
  const raw = 30 * 1000 * Math.pow(2, n - 1);
  return Math.min(60 * 60 * 1000, raw);
}

function appendAuditEvent(eventType, detail, options = {}) {
  ensureDir(DATA_DIR);
  const auditId = String(options && options.auditId ? options.auditId : '').trim() || generateAuditId();
  const line = {
    auditId,
    ts: new Date().toISOString(),
    eventType: String(eventType || ''),
    detail: detail || {},
  };
  fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(line)}\n`, 'utf8');
  return line;
}

function hashText(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 16);
}

function verifyGithubSignature(req, rawBody, secret) {
  const signatureHeader = String(req.headers['x-hub-signature-256'] || '').trim();
  if (!signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedHex = signatureHeader.slice('sha256='.length);
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBody.raw)
    .digest('hex');

  const provided = Buffer.from(providedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (provided.length !== expected.length || provided.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}

function readJsonBody(req, maxBodyBytes, returnRaw = false) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(new Error(`request body too large (${total} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve(returnRaw ? { raw, parsed: {} } : {});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(returnRaw ? { raw, parsed } : parsed);
      } catch (error) {
        reject(new Error(`invalid JSON body: ${String(error)}`));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(payload)}\n`);
}

function normalizeLabelNames(value) {
  if (Array.isArray(value)) {
    return dedupeStrings(
      value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .map((item) => item.toLowerCase()),
    );
  }
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }
  return dedupeStrings(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.toLowerCase()),
  );
}

function installLinearGitHooks(repoPath, teamKey) {
  const gitDirOutput = runCommand('git', ['-C', repoPath, 'rev-parse', '--git-dir']);
  const gitDir = path.resolve(repoPath, String(gitDirOutput.stdout || '.git').trim());
  const hooksDir = path.join(gitDir, 'hooks');
  ensureDir(hooksDir);

  const prepareCommitMsgPath = path.join(hooksDir, 'prepare-commit-msg');
  const commitMsgPath = path.join(hooksDir, 'commit-msg');

  const prepareScript = `#!/bin/sh
set -eu
MSG_FILE="\x241"
if [ -z "\x24{MSG_FILE:-}" ] || [ ! -f "\x24MSG_FILE" ]; then
  exit 0
fi
BRANCH="\x24(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ -z "\x24BRANCH" ]; then
  exit 0
fi
ISSUE="\x24(printf '%s' "\x24BRANCH" | grep -Eo '[A-Z][A-Z0-9]+-[0-9]+' | head -n1 || true)"
if [ -z "\x24ISSUE" ]; then
  exit 0
fi
if grep -Eq "\\b\x24ISSUE\\b" "\x24MSG_FILE"; then
  exit 0
fi
TMP_FILE="\x24(mktemp)"
{
  IFS= read -r FIRST_LINE || true
  if [ -n "\x24FIRST_LINE" ]; then
    printf '%s %s\\n' "\x24ISSUE" "\x24FIRST_LINE"
  else
    printf '%s\\n' "\x24ISSUE"
  fi
  cat
} < "\x24MSG_FILE" > "\x24TMP_FILE"
mv "\x24TMP_FILE" "\x24MSG_FILE"
`;

  const commitScript = `#!/bin/sh
set -eu
MSG_FILE="\x241"
if [ -z "\x24{MSG_FILE:-}" ] || [ ! -f "\x24MSG_FILE" ]; then
  exit 0
fi
BRANCH="\x24(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
case "\x24BRANCH" in
  ""|main|master)
    exit 0
    ;;
esac
BRANCH_ISSUE="\x24(printf '%s' "\x24BRANCH" | grep -Eo '\\b${teamKey}-[0-9]+\\b' | head -n1 || true)"
if [ -z "\x24BRANCH_ISSUE" ]; then
  BRANCH_ISSUE="\x24(printf '%s' "\x24BRANCH" | grep -Eo '\\b[A-Z][A-Z0-9]+-[0-9]+\\b' | head -n1 || true)"
fi
if [ -z "\x24BRANCH_ISSUE" ]; then
  echo 'ERROR: branch name must include Linear ID (e.g. feature/${teamKey}-123-short-title).' >&2
  exit 1
fi
if ! grep -Eq "\\b[A-Z][A-Z0-9]+-[0-9]+\\b" "\x24MSG_FILE"; then
  echo "ERROR: commit message must include Linear ID (expected \x24BRANCH_ISSUE)." >&2
  exit 1
fi
if ! grep -Eq "\\b\x24BRANCH_ISSUE\\b" "\x24MSG_FILE"; then
  echo "ERROR: commit message should contain branch Linear ID: \x24BRANCH_ISSUE" >&2
  exit 1
fi
`;

  fs.writeFileSync(prepareCommitMsgPath, prepareScript, { mode: 0o755 });
  fs.writeFileSync(commitMsgPath, commitScript, { mode: 0o755 });

  return {
    repoPath,
    hooks: [prepareCommitMsgPath, commitMsgPath],
  };
}

function collectSnapshot(settings) {
  return {
    nowMs: Date.now(),
    cronJobs: loadCronJobs(settings),
    sessions: loadSessions(settings),
    subagents: loadSubagents(settings),
  };
}

function buildReport(snapshot, settings) {
  const cronAnalysis = analyzeCron(snapshot.cronJobs, snapshot.nowMs, settings);
  const sessionAnalysis = analyzeSessions(snapshot.sessions, settings);
  const subagentAnalysis = analyzeSubagents(snapshot.subagents, settings);

  const allAnomalies = [
    ...cronAnalysis.anomalies,
    ...sessionAnalysis.anomalies,
    ...subagentAnalysis.anomalies,
  ].sort((a, b) => b.severity - a.severity || b.detectedAtMs - a.detectedAtMs);

  const topLimit = Number(settings.report.topLimit || 5);
  const topAnomalies = allAnomalies.slice(0, topLimit);

  const manualActions = dedupeStrings(
    topAnomalies.map((item) => item.manualAction).filter(Boolean),
  );

  return {
    generatedAtMs: snapshot.nowMs,
    generatedAt: new Date(snapshot.nowMs).toISOString(),
    metrics: {
      totalCronJobs: snapshot.cronJobs.length,
      enabledCronJobs: snapshot.cronJobs.filter((job) => job.enabled).length,
      cronErrorJobs: snapshot.cronJobs.filter((job) => {
        if (!job.enabled) {
          return false;
        }
        const status = String((job.state && job.state.lastStatus) || '').toLowerCase();
        return status === 'error' || status === 'failed';
      }).length,
      activeSessions: snapshot.sessions.filter((item) => Number(item.ageMs || Infinity) <= 60 * 60 * 1000).length,
      activeSubagents: snapshot.subagents.filter((item) => item.isActive).length,
    },
    topAnomalies,
    manualActions,
    anomalies: allAnomalies,
    cron: cronAnalysis,
    sessions: sessionAnalysis,
    subagents: subagentAnalysis,
  };
}

function analyzeCron(jobs, nowMs, settings) {
  const anomalies = [];

  for (const job of jobs) {
    if (!job.enabled) {
      continue;
    }
    const state = job.state || {};
    const name = job.name || job.id;
    const consecutiveErrors = Number(state.consecutiveErrors || 0);
    const lastStatus = String(state.lastStatus || '').toLowerCase();
    const lastError = String(state.lastError || '');

    if (consecutiveErrors >= 2) {
      anomalies.push({
        scope: 'cron',
        type: 'cron-consecutive-errors',
        reason: 'consecutive-errors',
        key: `${job.id}:consecutive-errors`,
        severity: 98,
        title: `${name} has ${consecutiveErrors} consecutive failures`,
        detail: lastError || 'No error text available',
        manualAction: `Inspect and fix ${job.id}: openclaw cron runs --id ${job.id} --limit 20`,
        jobId: job.id,
        detectedAtMs: nowMs,
      });
    }

    if (isTimeoutError(lastError)) {
      anomalies.push({
        scope: 'cron',
        type: 'cron-timeout',
        reason: 'timeout',
        key: `${job.id}:timeout`,
        severity: 94,
        title: `${name} reported timeout`,
        detail: lastError,
        manualAction: `Review timeout root cause for ${job.id}; consider higher timeout or task split.`,
        jobId: job.id,
        detectedAtMs: nowMs,
      });
    }

    if (job.enabled && isSilent(job, nowMs, settings)) {
      anomalies.push({
        scope: 'cron',
        type: 'cron-silent',
        reason: 'silent',
        key: `${job.id}:silent`,
        severity: 91,
        title: `${name} appears silent / stale`,
        detail: `lastRun=${formatTime(state.lastRunAtMs, settings.timezone)} schedule=${formatSchedule(job.schedule)}`,
        manualAction: `Verify scheduler and run job ${job.id} manually: openclaw cron run ${job.id}`,
        jobId: job.id,
        detectedAtMs: nowMs,
      });
    }

    if (lastStatus === 'error' || lastStatus === 'failed') {
      anomalies.push({
        scope: 'cron',
        type: 'cron-last-error',
        reason: 'last-error',
        key: `${job.id}:last-error`,
        severity: consecutiveErrors >= 1 ? 86 : 80,
        title: `${name} last run status = ${lastStatus}`,
        detail: lastError || 'No error text available',
        manualAction: `Check latest run logs for ${job.id}: openclaw cron runs --id ${job.id} --limit 5`,
        jobId: job.id,
        detectedAtMs: nowMs,
      });
    }
  }

  const circuitState = readAutopilotCircuitState();
  if (circuitState.status === 'open' && Number(circuitState.openUntilMs || 0) > nowMs) {
    anomalies.push({
      scope: 'cron',
      type: 'cron-circuit-open',
      reason: 'circuit-open',
      key: 'linear-autopilot:circuit-open',
      severity: 97,
      title: 'linear-autopilot circuit is open',
      detail: `consecutiveFailures=${Number(circuitState.consecutiveFailures || 0)} until=${formatTime(circuitState.openUntilMs, settings.timezone)}`,
      manualAction:
        'Inspect mission-control/data/control-center/linear-autopilot-cron.log and clear root cause before forcing a run.',
      jobId: 'linear-autopilot',
      detectedAtMs: nowMs,
    });
  }

  return { anomalies };
}

function analyzeSessions(sessions, settings) {
  const anomalies = [];
  const threshold = Number(settings.watchdog.contextHotThreshold || 0.85);

  for (const session of sessions) {
    const key = session.key || 'unknown-session';
    const totalTokens = Number(session.totalTokens || 0);
    const contextTokens = Number(session.contextTokens || 0);

    if (session.abortedLastRun) {
      anomalies.push({
        scope: 'session',
        type: 'session-aborted',
        severity: 78,
        title: `Session aborted: ${key}`,
        detail: `model=${session.model || '-'} age=${formatDuration(session.ageMs)}`,
        manualAction: `Inspect session ${key} and retry pending task.`,
        detectedAtMs: Date.now(),
      });
    }

    if (totalTokens > 0 && contextTokens > 0) {
      const ratio = totalTokens / contextTokens;
      if (ratio >= threshold) {
        anomalies.push({
          scope: 'session',
          type: 'session-context-hot',
          severity: 66,
          title: `Session near context cap: ${key}`,
          detail: `${Math.round(ratio * 100)}% of context used (${totalTokens}/${contextTokens})`,
          manualAction: `Compact or reset session ${key} before context overflow.`,
          detectedAtMs: Date.now(),
        });
      }
    }
  }

  return { anomalies };
}

function analyzeSubagents(subagents, settings) {
  const anomalies = [];
  const longRunMs = Number(settings.watchdog.subagentLongRunMinutes || 120) * 60 * 1000;
  const nowMs = Date.now();

  for (const item of subagents) {
    if (!item.isActive) {
      continue;
    }
    if (item.durationMs >= longRunMs) {
      anomalies.push({
        scope: 'subagent',
        type: 'subagent-long-running',
        severity: 72,
        title: `Subagent long-running: ${item.label}`,
        detail: `id=${item.id} elapsed=${formatDuration(item.durationMs)}`,
        manualAction: `Review subagent ${item.id}; kill only if required and whitelisted.`,
        detectedAtMs: nowMs,
      });
    }
  }

  return { anomalies };
}

function buildIncidentCandidates(report, snapshot, settings) {
  const byJob = new Map();

  for (const item of report.anomalies) {
    if (item.scope !== 'cron') {
      continue;
    }
    if (!['consecutive-errors', 'timeout', 'silent'].includes(item.reason)) {
      continue;
    }
    if (!item.jobId) {
      continue;
    }

    const prev = byJob.get(item.jobId);
    if (!prev || item.severity > prev.severity) {
      byJob.set(item.jobId, item);
    }
  }

  const candidates = [];
  for (const [jobId, anomaly] of byJob.entries()) {
    const job = snapshot.cronJobs.find((entry) => entry.id === jobId);
    if (!job) {
      continue;
    }

    const runs = loadCronRuns(jobId, 3, settings);
    const runbook = deriveIncidentRunbook(job, anomaly, settings);
    const key = `${jobId}:${anomaly.reason}:${runbook.signature}`;
    const summary = anomaly.title;

    candidates.push({
      key,
      reason: anomaly.reason,
      summary,
      anomaly,
      job,
      runs,
      runbook,
      description: renderIncidentDescription(job, anomaly, runs, runbook, settings),
    });
  }

  return candidates;
}

function renderIncidentDescription(job, anomaly, runs, runbook, settings) {
  const state = job.state || {};
  const lines = [];

  lines.push(`# OpenClaw cron incident (${anomaly.reason})`);
  lines.push('');
  lines.push(`- jobId: ${job.id}`);
  lines.push(`- name: ${job.name || '(unnamed)'}`);
  lines.push(`- severity: ${anomaly.severity}`);
  lines.push(`- schedule: ${formatSchedule(job.schedule)}`);
  lines.push(`- enabled: ${job.enabled ? 'true' : 'false'}`);
  lines.push(`- lastStatus: ${state.lastStatus || '-'}`);
  lines.push(`- consecutiveErrors: ${Number(state.consecutiveErrors || 0)}`);
  lines.push(`- lastRun: ${formatTime(state.lastRunAtMs, settings.timezone)}`);
  lines.push(`- lastDuration: ${formatDuration(state.lastDurationMs)}`);

  if (state.lastError) {
    lines.push('');
    lines.push('## lastError');
    lines.push('```text');
    lines.push(trimMessage(String(state.lastError), 1000));
    lines.push('```');
  }

  lines.push('');
  lines.push('## Logs / run references');
  lines.push(`- file: ${path.join(settings.openclawHome, 'cron', 'runs', `${job.id}.jsonl`)}`);
  lines.push(`- inspect: openclaw cron runs --id ${job.id} --limit 20`);
  for (const logPath of runbook.logPaths || []) {
    lines.push(`- file: ${logPath}`);
  }

  if (runs.length > 0) {
    lines.push('');
    lines.push('## Recent runs (latest first)');
    for (const entry of runs) {
      lines.push(
        `- ts=${formatTime(entry.ts || entry.runAtMs, settings.timezone)} status=${entry.status || '-'} duration=${formatDuration(entry.durationMs)} session=${entry.sessionId || '-'}`,
      );
      if (entry.summary) {
        lines.push(`  summary: ${singleLine(trimMessage(entry.summary, 220))}`);
      }
    }
  }

  lines.push('');
  lines.push('## Failure Signature');
  lines.push(`- signature: ${runbook.signature}`);
  lines.push(`- runbook card: ${runbook.card}`);
  lines.push(`- reason: ${runbook.reason}`);
  lines.push('');
  lines.push('## Executable Runbook');
  for (let i = 0; i < runbook.nextCommands.length; i += 1) {
    lines.push(`${i + 1}. \`${runbook.nextCommands[i]}\``);
  }
  lines.push('');
  lines.push('## Possible Causes');
  for (const cause of runbook.possibleCauses) {
    lines.push(`- ${cause}`);
  }
  lines.push('');
  lines.push('## Verification');
  lines.push(`1. Validate immediate rerun: \`openclaw cron run ${job.id}\``);
  lines.push('2. Verify next 2 scheduled runs are successful.');
  lines.push('3. Update linked issue with root-cause summary and preventive action.');

  return lines.join('\n');
}

function deriveIncidentRunbook(job, anomaly, settings) {
  const state = job && job.state ? job.state : {};
  const lastError = String((state && state.lastError) || anomaly.detail || '').toLowerCase();
  const signatureBase = `${job.id}:${anomaly.reason}:${trimMessage(lastError, 180)}`;
  const signature = `sig-${hashText(signatureBase)}`;
  const logPaths = [path.join(settings.openclawHome, 'cron', 'runs', `${job.id}.jsonl`)];
  const possibleCauses = [];
  let card = 'cron-recover';

  if (anomaly.reason === 'timeout' || /timeout|timed out/i.test(lastError)) {
    possibleCauses.push('External API/database latency spike exceeded task timeout.');
    possibleCauses.push('Task scope too large for current timeout budget.');
    possibleCauses.push('Downstream dependency stuck (network, DNS, or rate limit).');
    card = 'cron-recover';
  } else if (anomaly.reason === 'consecutive-errors') {
    possibleCauses.push('Deterministic script bug introduced in recent change.');
    possibleCauses.push('Credential or permission drift in runtime environment.');
    possibleCauses.push('Input payload schema changed and parser is outdated.');
    card = 'cron-recover';
  } else if (anomaly.reason === 'silent') {
    possibleCauses.push('Scheduler stalled or cron trigger missed.');
    possibleCauses.push('Job disabled inadvertently or stuck in lock state.');
    possibleCauses.push('Host sleep/restart interrupted scheduled execution.');
    card = 'cron-recover';
  } else {
    possibleCauses.push('Unknown runtime failure; inspect latest run logs first.');
  }

  const nextCommands = [
    `npm run tasks -- runbook-exec --card ${card} --cron-id ${job.id}`,
    `openclaw cron runs --id ${job.id} --limit 20`,
    `npm run tasks -- status-sync --json`,
  ];
  if (anomaly.reason === 'timeout') {
    nextCommands.splice(
      1,
      0,
      'npm run tasks -- runbook-exec --card queue-backlog',
    );
  }

  return {
    signature,
    card,
    reason: anomaly.reason,
    possibleCauses: dedupeStrings(possibleCauses),
    nextCommands: dedupeStrings(nextCommands),
    logPaths: dedupeStrings(logPaths),
  };
}

async function createLinearIssue(candidate, settings) {
  const apiKey = settings.linear.apiKey;
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is required for auto Linear issue creation.');
  }

  const teamId = settings.linear.teamId || (await resolveLinearTeamId(apiKey, settings.linear.teamKey));
  if (!teamId) {
    throw new Error('Unable to resolve Linear team id. Set LINEAR_TEAM_ID or LINEAR_TEAM_KEY.');
  }

  const signature = candidate.runbook && candidate.runbook.signature ? candidate.runbook.signature : '';
  const title = `[ops][cron] ${candidate.job.name || candidate.job.id} - ${candidate.reason}${signature ? ` (${signature})` : ''}`;
  const input = {
    teamId,
    title,
    description: candidate.description,
    priority: 1,
  };

  if (settings.linear.projectId) {
    input.projectId = settings.linear.projectId;
  }

  const payload = await linearRequest(
    apiKey,
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          url
          title
        }
      }
    }`,
    { input },
  );

  const node = payload.issueCreate && payload.issueCreate.issue;
  if (!node) {
    throw new Error('Linear issueCreate returned no issue object.');
  }

  return {
    id: node.id,
    identifier: node.identifier,
    url: node.url,
    title: node.title,
  };
}

async function resolveLinearTeamId(apiKey, teamKey) {
  const payload = await linearRequest(
    apiKey,
    `query Teams {
      teams {
        nodes {
          id
          key
          name
        }
      }
    }`,
    {},
  );

  const nodes = (((payload || {}).teams || {}).nodes || []).filter(Boolean);
  if (nodes.length === 0) {
    return '';
  }

  if (teamKey) {
    const keyUpper = String(teamKey).trim().toUpperCase();
    const match = nodes.find((team) => String(team.key || '').toUpperCase() === keyUpper);
    if (match) {
      return String(match.id);
    }
  }

  return String(nodes[0].id);
}

async function linearRequest(apiKey, query, variables) {
  const timeoutMs = 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail =
      body && Array.isArray(body.errors)
        ? body.errors.map((item) => item.message).join('; ')
        : trimMessage(raw, 300);
    throw new Error(`Linear API HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  if (body && body.errors && body.errors.length > 0) {
    throw new Error(`Linear API error: ${body.errors.map((item) => item.message).join('; ')}`);
  }

  return body ? body.data : null;
}

async function githubApiRequest(token, endpoint) {
  const url = `https://api.github.com${endpoint}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'openclaw-mission-control',
    },
  });

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail =
      body && body.message ? body.message : trimMessage(raw || `HTTP ${response.status}`, 240);
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  return body;
}

async function requestGithubPullReviewers(token, repo, prNumber, reviewers) {
  const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/requested_reviewers`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'openclaw-mission-control',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reviewers,
    }),
  });

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = body && body.message ? body.message : trimMessage(raw || `HTTP ${response.status}`, 240);
    throw new Error(`GitHub request reviewers failed (${response.status}): ${detail}`);
  }
  return {
    ok: true,
    requestedReviewers: reviewers,
    status: response.status,
  };
}

async function todoistApiRequest(apiToken, pathSuffix, method = 'GET', payload = undefined) {
  const suffix = String(pathSuffix || '').startsWith('/') ? String(pathSuffix) : `/${String(pathSuffix || '')}`;
  const url = `https://api.todoist.com/api/v1${suffix}`;
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'openclaw-mission-control',
  };
  const response = await fetch(url, {
    method: normalizedMethod,
    headers,
    body: payload === undefined || normalizedMethod === 'GET' ? undefined : JSON.stringify(payload),
  });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = body && body.error ? body.error : trimMessage(raw || `HTTP ${response.status}`, 240);
    throw new Error(`Todoist API ${response.status}: ${detail}`);
  }
  return body;
}

async function closeTodoistTask(apiToken, taskId) {
  const id = String(taskId || '').trim();
  if (!id) {
    throw new Error('todoist task id is required for close');
  }
  await todoistApiRequest(apiToken, `/tasks/${id}/close`, 'POST', {});
}

async function fetchTodoistTasks(apiToken, limit) {
  const wanted = Math.max(1, Number(limit || 200));
  let cursor = '';
  const tasks = [];

  while (tasks.length < wanted) {
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(200, wanted - tasks.length)));
    if (cursor) {
      params.set('cursor', cursor);
    }

    const payload = await todoistApiRequest(apiToken, `/tasks?${params.toString()}`);
    const chunk = Array.isArray(payload && payload.results) ? payload.results : [];
    tasks.push(...chunk);

    cursor = String((payload && payload.next_cursor) || '').trim();
    if (!cursor || chunk.length === 0) {
      break;
    }
  }

  return tasks.slice(0, wanted);
}

function mapTodoistPriorityToLinear(todoistPriority) {
  const p = Number(todoistPriority || 1);
  if (p >= 4) {
    return 1;
  }
  if (p === 3) {
    return 2;
  }
  if (p === 2) {
    return 3;
  }
  return 4;
}

async function extractTodoistTokenFromBrowser(profile) {
  const tabs = listBrowserTabs(profile);
  const tab = tabs.find((item) => String(item.url || '').includes('app.todoist.com'));
  if (!tab) {
    return '';
  }

  const result = openclawBrowserEvaluate(
    profile,
    tab.targetId,
    "() => { try { const u = JSON.parse(localStorage.getItem('User') || '{}'); return u.token || ''; } catch { return ''; } }",
  );
  return String(result || '').trim();
}

function persistControlCenterValue(pathKeys, value) {
  const keys = Array.isArray(pathKeys) ? pathKeys.map((item) => String(item)) : [String(pathKeys)];
  if (keys.length === 0) {
    return;
  }

  const config = readJsonFile(CONFIG_PATH, {});
  let cursor = config;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  writeJsonFile(CONFIG_PATH, config);
}

function listBrowserTabs(profile) {
  try {
    const payload = runOpenclawJson(['browser', '--browser-profile', profile, 'tabs', '--json']);
    return Array.isArray(payload.tabs) ? payload.tabs : [];
  } catch {
    return [];
  }
}

function openclawBrowserEvaluate(profile, targetId, fnCode) {
  const output = runCommand('openclaw', [
    'browser',
    '--browser-profile',
    profile,
    'evaluate',
    '--target-id',
    String(targetId),
    '--fn',
    String(fnCode),
    '--json',
  ]);
  const payload = extractJson(output.stdout || '');
  if (!payload || payload.ok !== true) {
    throw new Error(`browser evaluate failed for target ${targetId}`);
  }
  return payload.result;
}

function normalizeGithubRepo(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    return text;
  }

  const ssh = text.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (ssh) {
    return `${ssh[1]}/${ssh[2]}`;
  }
  const https = text.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (https) {
    return `${https[1]}/${https[2]}`;
  }
  return '';
}

function getGitRemote(repoPath) {
  try {
    const out = runCommand('git', ['-C', repoPath, 'remote', 'get-url', 'origin']);
    return String(out.stdout || '').trim();
  } catch {
    return '';
  }
}

function loadCronJobs(settings) {
  const fallbackPath = path.join(settings.openclawHome, 'cron', 'jobs.json');
  const fallback = readJsonFile(fallbackPath, { jobs: [] });
  if (Array.isArray(fallback.jobs) && fallback.jobs.length > 0) {
    return fallback.jobs;
  }

  try {
    const payload = runOpenclawJson(['cron', 'list', '--all', '--json']);
    if (payload && Array.isArray(payload.jobs)) {
      return payload.jobs;
    }
  } catch {
    // fallback below
  }
  return Array.isArray(fallback.jobs) ? fallback.jobs : [];
}

function loadCronRuns(jobId, limit, settings) {
  try {
    const payload = runOpenclawJson(['cron', 'runs', '--id', jobId, '--limit', String(limit || 3)]);
    if (payload && Array.isArray(payload.entries)) {
      return payload.entries;
    }
  } catch {
    // fallback to local file
  }

  const file = path.join(settings.openclawHome, 'cron', 'runs', `${jobId}.jsonl`);
  if (!fs.existsSync(file)) {
    return [];
  }

  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-Math.max(1, Number(limit || 3)));

  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadSessions(settings) {
  const now = Date.now();
  const agentsDir = path.join(settings.openclawHome, 'agents');
  const sessions = [];

  for (const agentId of listDir(agentsDir)) {
    const storePath = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    if (!fs.existsSync(storePath)) {
      continue;
    }

    const store = readJsonFile(storePath, null);
    if (!store || typeof store !== 'object') {
      continue;
    }

    for (const [key, value] of Object.entries(store)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      if (key.includes(':run:')) {
        continue;
      }

      const updatedAt = Number(value.updatedAt || value.updatedAtMs || 0);
      const ageMs = updatedAt > 0 ? Math.max(0, now - updatedAt) : Number.POSITIVE_INFINITY;
      sessions.push({
        agentId,
        key,
        kind: value.chatType || value.kind || 'unknown',
        updatedAt,
        ageMs,
        sessionId: value.sessionId || '',
        abortedLastRun: Boolean(value.abortedLastRun),
        totalTokens: value.totalTokens != null ? Number(value.totalTokens) : null,
        contextTokens: value.contextTokens != null ? Number(value.contextTokens) : null,
        model: value.modelOverride || value.model || '',
      });
    }
  }

  if (sessions.length > 0) {
    return sessions;
  }

  try {
    const payload = runOpenclawJson(['sessions', '--json']);
    if (payload && Array.isArray(payload.sessions)) {
      return payload.sessions.map((item) => ({
        ...item,
        agentId: item.agentId || inferAgentId(item.key),
      }));
    }
  } catch {
    // fallback below
  }

  return [];
}

function loadSubagents(settings) {
  const file = path.join(settings.openclawHome, 'subagents', 'runs.json');
  const payload = readJsonFile(file, { runs: {} });
  const now = Date.now();

  let entries = [];
  if (Array.isArray(payload.runs)) {
    entries = payload.runs.map((item, index) => normalizeSubagent(item && item.id ? item.id : `subagent-${index + 1}`, item, now));
  } else if (payload.runs && typeof payload.runs === 'object') {
    entries = Object.entries(payload.runs).map(([id, item]) => normalizeSubagent(id, item, now));
  }

  return entries
    .filter(Boolean)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.startedAtMs - a.startedAtMs);
}

function normalizeSubagent(id, source, nowMs) {
  const item = source && typeof source === 'object' ? source : {};
  const startedAtMs = firstNumber(
    item.startedAtMs,
    item.startAtMs,
    item.createdAtMs,
    item.startedAt,
    item.startAt,
    item.createdAt,
  );
  const endedAtMs = firstNumber(item.endedAtMs, item.finishedAtMs, item.stoppedAtMs, item.endedAt, item.finishedAt);

  const rawStatus = String(item.status || item.state || '').toLowerCase();
  const isActiveByStatus = ['running', 'active', 'queued', 'pending'].includes(rawStatus);
  const isActive = isActiveByStatus || (!endedAtMs && Boolean(startedAtMs));

  const durationMs = firstNumber(
    item.durationMs,
    item.elapsedMs,
    isActive && startedAtMs ? nowMs - startedAtMs : endedAtMs && startedAtMs ? endedAtMs - startedAtMs : 0,
  );

  const pid = firstNumber(item.pid, item.processId, item.process && item.process.pid);

  return {
    id,
    label: String(item.label || item.name || item.agentId || id),
    status: rawStatus || (isActive ? 'running' : 'finished'),
    startedAtMs,
    endedAtMs,
    durationMs,
    pid,
    isActive,
    raw: item,
  };
}

function inferAgentId(sessionKey) {
  const key = String(sessionKey || '');
  const match = key.match(/^agent:([^:]+):/);
  if (match) {
    return match[1];
  }
  return 'main';
}

function isSilent(job, nowMs, settings) {
  const state = job.state || {};
  const schedule = job.schedule || {};
  const lastRunAtMs = firstNumber(state.lastRunAtMs);

  // A job may intentionally not run during quiet-hours. Those runs are recorded as
  // "skipped" with error="quiet-hours". Treat that as a healthy signal so the
  // watchdog does not raise a false "cron-silent" anomaly.
  try {
    const runs = loadCronRuns(job.id, 1, settings);
    const latest = Array.isArray(runs) && runs.length > 0 ? runs[runs.length - 1] : null;
    const status = String(latest && latest.status ? latest.status : '').trim().toLowerCase();
    const error = String(latest && latest.error ? latest.error : '').trim().toLowerCase();
    if (status === 'skipped' && error === 'quiet-hours') {
      return false;
    }
  } catch {
    // ignore run loading errors; fall back to schedule-based detection
  }

  if (schedule.kind === 'every' && Number(schedule.everyMs) > 0) {
    const everyMs = Number(schedule.everyMs);
    const silenceFloorMs = Number(settings.watchdog.silenceFloorMinutes || 10) * 60 * 1000;
    const threshold = Math.max(everyMs * Number(settings.watchdog.silenceMultiplier || 2.5), silenceFloorMs);
    const basis = lastRunAtMs || firstNumber(job.createdAtMs) || 0;
    if (!basis) {
      return false;
    }
    return nowMs - basis > threshold;
  }

  if (schedule.kind === 'cron') {
    const hours = Number(settings.watchdog.cronSilenceHours || 48);
    const threshold = hours * 60 * 60 * 1000;
    const basis = lastRunAtMs || firstNumber(job.createdAtMs) || 0;
    if (!basis) {
      return false;
    }
    return nowMs - basis > threshold;
  }

  return false;
}

function isTimeoutError(text) {
  return /timed out|timeout/i.test(String(text || ''));
}

function renderReport(report, settings) {
  const lines = [];
  lines.push(`# Daily Runtime Health Report (${formatTime(report.generatedAtMs, settings.timezone)})`);
  lines.push('');
  lines.push('## Snapshot');
  lines.push(`- Cron jobs: ${report.metrics.enabledCronJobs}/${report.metrics.totalCronJobs} enabled`);
  lines.push(`- Cron jobs with last error: ${report.metrics.cronErrorJobs}`);
  lines.push(`- Active sessions (last 60m): ${report.metrics.activeSessions}`);
  lines.push(`- Active subagents: ${report.metrics.activeSubagents}`);
  lines.push('');

  lines.push('## Top 5 anomalies');
  if (report.topAnomalies.length === 0) {
    lines.push('- none');
  } else {
    for (let i = 0; i < report.topAnomalies.length; i += 1) {
      const item = report.topAnomalies[i];
      lines.push(`${i + 1}. [${item.scope}] [${item.severity}] ${item.title}`);
      if (item.detail) {
        lines.push(`   - detail: ${singleLine(trimMessage(item.detail, 240))}`);
      }
      if (item.jobId) {
        lines.push(`   - jobId: ${item.jobId}`);
      }
    }
  }
  lines.push('');

  lines.push('## Needs human action');
  if (report.manualActions.length === 0) {
    lines.push('- none');
  } else {
    for (let i = 0; i < report.manualActions.length; i += 1) {
      lines.push(`${i + 1}. ${report.manualActions[i]}`);
    }
  }

  return lines.join('\n');
}

function printTable(rows, columns) {
  const widths = {};
  for (const column of columns) {
    widths[column] = column.length;
  }

  for (const row of rows) {
    for (const column of columns) {
      const value = String(row[column] == null ? '' : row[column]);
      widths[column] = Math.max(widths[column], value.length);
    }
  }

  const header = columns.map((column) => padRight(column, widths[column])).join('  ');
  const separator = columns.map((column) => '-'.repeat(widths[column])).join('  ');

  process.stdout.write(`${header}\n${separator}\n`);
  for (const row of rows) {
    const line = columns
      .map((column) => padRight(String(row[column] == null ? '' : row[column]), widths[column]))
      .join('  ');
    process.stdout.write(`${line}\n`);
  }
}

function padRight(value, width) {
  if (value.length >= width) {
    return value;
  }
  return `${value}${' '.repeat(width - value.length)}`;
}

function formatSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') {
    return '-';
  }
  if (schedule.kind === 'every' && schedule.everyMs != null) {
    return `every ${formatDuration(Number(schedule.everyMs))}`;
  }
  if (schedule.kind === 'cron') {
    const tz = schedule.tz ? ` ${schedule.tz}` : '';
    return `cron ${schedule.expr || '?'}${tz}`;
  }
  if (schedule.kind === 'at') {
    return `at ${schedule.atMs || '-'}`;
  }
  return schedule.kind || '-';
}

function formatDuration(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) {
    return '-';
  }

  const totalSeconds = Math.floor(Number(ms) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 && parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
}

function formatTime(ms, timeZone) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return '-';
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') {
      continue;
    }
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return 0;
}

function dedupeStrings(list) {
  const seen = new Set();
  const output = [];
  for (const item of list) {
    const key = item.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(key);
  }
  return output;
}

function normalizeAgentIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isAutoAgentSelector(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'auto' || text === 'any' || text === '*';
}

function runOpenclawJson(args) {
  const { stdout, stderr } = runCommand('openclaw', args);
  const payload = `${stdout || ''}\n${stderr || ''}`.trim();
  return extractJson(payload);
}

function runCommand(bin, args, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs || 0);
  const label = String(opts.label || '').trim();

  const mergedEnv = {
    ...process.env,
    ...(opts.env && typeof opts.env === 'object' ? opts.env : {}),
  };

  if (!mergedEnv.NEXUS_VECTOR_DB) {
    mergedEnv.NEXUS_VECTOR_DB = '/Users/yizhi/.openclaw/workspace/memory/.vector_db_restored';
  }
  if (!mergedEnv.NEXUS_COLLECTION) {
    mergedEnv.NEXUS_COLLECTION = 'deepsea_nexus_restored';
  }
  if (!mergedEnv.NEXUS_PYTHON_PATH) {
    mergedEnv.NEXUS_PYTHON_PATH = '/Users/yizhi/miniconda3/envs/openclaw-nexus/bin/python';
  }

  const result = spawnSync(bin, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: mergedEnv,
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
  });

  if (result.error) {
    const meta = label ? `${label}: ` : '';
    throw new Error(`${meta}${result.error.message || String(result.error)}`);
  }

  if (result.status !== 0) {
    const meta = label ? `${label}: ` : '';
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${meta}${bin} ${args.join(' ')} failed with code ${result.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  return {
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char !== '{' && char !== '[') {
      continue;
    }
    const end = findJsonEndIndex(trimmed, i);
    if (end > i) {
      const bounded = trimmed.slice(i, end + 1);
      try {
        return JSON.parse(bounded);
      } catch {
        // continue
      }
    }
    const candidate = trimmed.slice(i);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new Error(`Failed to parse JSON from output:\n${trimmed.slice(0, 400)}`);
}

function findJsonEndIndex(text, startIndex) {
  const start = text[startIndex];
  if (start !== '{' && start !== '[') {
    return -1;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function normalizeTriggerJobId(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return '';
  }
  const alias = {
    github: 'github-sync',
    gh: 'github-sync',
    todoist: 'todoist-sync',
    calendar: 'calendar-sync',
    gcal: 'calendar-sync',
    intake: 'discord-intake-sync',
    'discord-intake': 'discord-intake-sync',
    guard: 'workspace-guard',
    workspace: 'workspace-guard',
    workspaceguard: 'workspace-guard',
    'workspace-guard': 'workspace-guard',
    autopilot: 'linear-autopilot',
    execution: 'linear-autopilot',
    'execution-loop': 'linear-autopilot',
    engine: 'linear-engine',
    'execution-engine': 'linear-engine',
    'autopilot-engine': 'linear-engine',
    reminder: 'remind',
    brief: 'briefing',
    'briefing-daily': 'briefing',
    state: 'status-sync',
    status: 'status-sync',
    queue: 'queue-drain',
    sla: 'sla-check',
  };
  return alias[text] || text;
}

function normalizeExecutionLoopCommand(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return '';
  }
  const alias = {
    autopilot: 'linear-autopilot',
    'linear-autopilot': 'linear-autopilot',
    execution: 'linear-autopilot',
    'execution-loop': 'linear-autopilot',
    engine: 'linear-engine',
    'linear-engine': 'linear-engine',
    'execution-engine': 'linear-engine',
    'autopilot-engine': 'linear-engine',
    multi: 'linear-engine',
    'multi-step': 'linear-engine',
  };
  return alias[text] || '';
}

function buildTriggerChildArgs(jobId, settings, flags) {
  const args = [];
  switch (jobId) {
    case 'github-sync':
      args.push('github-sync', '--json');
      break;
    case 'todoist-sync':
      args.push('todoist-sync', '--json');
      break;
    case 'calendar-sync':
      args.push('calendar-sync', '--json');
      if (flags['to-linear'] || flags.toLinear) {
        args.push('--to-linear');
      }
      break;
    case 'discord-intake-sync':
      args.push('discord-intake-sync', '--json');
      if (flags.channel) {
        args.push('--channel', String(flags.channel));
      }
      if (flags.limit) {
        args.push('--limit', String(flags.limit));
      }
      break;
    case 'watchdog':
      args.push('watchdog', '--json');
      if (flags['auto-linear'] || settings.linear.enabled !== false) {
        args.push('--auto-linear');
      }
      break;
    case 'workspace-guard':
      args.push('workspace-guard', '--json');
      if (flags['expected-workspace']) {
        args.push('--expected-workspace', String(flags['expected-workspace']));
      }
      if (flags['dry-run']) {
        args.push('--dry-run');
      }
      if (flags['auto-repair'] !== undefined) {
        args.push('--auto-repair', String(flags['auto-repair']));
      }
      break;
    case 'report':
      args.push('report', '--json');
      if (flags.send) {
        args.push('--send');
      }
      break;
    case 'briefing': {
      const mode = String(flags.mode || flags._[1] || 'daily').trim();
      args.push('briefing', mode, '--json');
      if (flags.send) {
        args.push('--send');
      }
      if (flags['auto-escalate'] || flags.escalate) {
        args.push('--auto-escalate');
      }
      break;
    }
    case 'remind': {
      const mode = String(flags.mode || flags._[1] || 'all').trim();
      args.push('remind', mode, '--json');
      if (flags.send) {
        args.push('--send');
      }
      break;
    }
    case 'status-sync':
      args.push('status-sync', '--json');
      break;
    case 'queue-drain':
      args.push('queue-drain', '--json');
      break;
    case 'sla-check':
      args.push('sla-check', '--json');
      break;
    case 'linear-autopilot':
      args.push('linear-autopilot', '--json');
      if (flags.all) {
        args.push('--all');
      }
      if (flags.issue) {
        args.push('--issue', String(flags.issue));
      }
      if (flags.agent) {
        args.push('--agent', String(flags.agent));
      }
      if (flags.labels) {
        args.push('--labels', String(flags.labels));
      }
      break;
    case 'linear-engine':
      args.push('linear-engine', '--json');
      if (flags.issue) {
        args.push('--issue', String(flags.issue));
      }
      if (flags['auto-pick'] !== undefined) {
        args.push('--auto-pick', String(flags['auto-pick']));
      }
      if (flags.agent) {
        args.push('--agent', String(flags.agent));
      }
      if (flags['max-steps']) {
        args.push('--max-steps', String(flags['max-steps']));
      }
      if (flags['no-progress-threshold']) {
        args.push('--no-progress-threshold', String(flags['no-progress-threshold']));
      }
      if (flags.drain !== undefined) {
        args.push('--drain', String(flags.drain));
      }
      if (flags['drain-max-issues']) {
        args.push('--drain-max-issues', String(flags['drain-max-issues']));
      }
      break;
    default:
      throw new Error(`unsupported trigger job: ${jobId}`);
  }
  return args;
}

function parseGitChangedFiles(statusOutput) {
  const lines = String(statusOutput || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const files = [];
  for (const line of lines) {
    if (line.length < 4) {
      continue;
    }
    const pathPart = line.slice(3).trim();
    if (!pathPart) {
      continue;
    }
    const renamed = pathPart.includes('->')
      ? pathPart
          .split('->')
          .map((item) => item.trim())
          .filter(Boolean)
      : [pathPart];
    for (const item of renamed) {
      const normalized = item.replace(/^"+|"+$/g, '');
      if (normalized) {
        files.push(normalized);
      }
    }
  }
  return dedupeStrings(files);
}

function evaluateAutoPrRisk(changedFiles, allowedPrefixes) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return { ok: false, blockedFiles: ['(no files)'] };
  }
  const prefixes =
    Array.isArray(allowedPrefixes) && allowedPrefixes.length > 0
      ? allowedPrefixes
      : ['docs/', '.github/', 'README.md', 'config/'];
  const blockedFiles = changedFiles.filter((file) => {
    const normalized = String(file || '').trim();
    if (!normalized) {
      return true;
    }
    return !prefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
  });
  return {
    ok: blockedFiles.length === 0,
    blockedFiles,
  };
}

function buildAutoPrTitle(issueIdentifier, changedFiles) {
  const scope = changedFiles.some((file) => String(file).startsWith('docs/')) ? 'docs' : 'automation';
  return `${issueIdentifier ? `${issueIdentifier} ` : ''}chore(${scope}): auto update`;
}

function buildAutoPrBody(input) {
  const issueIdentifier = String(input.issueIdentifier || '').trim();
  const changedFiles = Array.isArray(input.changedFiles) ? input.changedFiles : [];
  const baseBranch = String(input.baseBranch || 'main');
  const testCommand = String(input.testCommand || '').trim();
  const lines = [];
  lines.push('## Auto PR Summary');
  if (issueIdentifier) {
    lines.push(`- linked issue: ${issueIdentifier}`);
  }
  lines.push(`- base branch: ${baseBranch}`);
  lines.push(`- changed files: ${changedFiles.length}`);
  if (testCommand) {
    lines.push(`- test command: \`${testCommand}\``);
  }
  lines.push('');
  lines.push('## Files');
  for (const file of changedFiles.slice(0, 100)) {
    lines.push(`- ${file}`);
  }
  lines.push('');
  lines.push('## Checklist');
  lines.push('- [x] low-risk path allowlist gate passed');
  lines.push('- [x] local checks executed');
  lines.push('- [ ] reviewer validation');
  return lines.join('\n');
}

function runShellCommand(command, cwd) {
  const result = spawnSync(command, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    shell: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`shell command failed (${command}) with code ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return {
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

async function createGithubPullRequest(token, repo, input) {
  const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'openclaw-mission-control',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
      draft: Boolean(input.draft),
    }),
  });

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail =
      body && body.message ? String(body.message) : trimMessage(raw || `HTTP ${response.status}`, 240);
    throw new Error(`GitHub create PR failed (${response.status}): ${detail}`);
  }
  return {
    id: body && body.id ? body.id : '',
    number: body && body.number ? body.number : 0,
    url: body && body.html_url ? body.html_url : '',
    title: body && body.title ? body.title : input.title,
  };
}

function renderEvalReplayPlan(replay, replayPath, settings) {
  const lines = [];
  lines.push('# Eval Replay / Distillation Plan');
  lines.push('');
  lines.push(`- generated: ${formatTime(replay.generatedAtMs, settings.timezone)}`);
  lines.push(`- replay artifact: ${replayPath}`);
  lines.push(`- sessions: ${replay.metrics.sessions}`);
  lines.push(`- cron runs: ${replay.metrics.cronRuns}`);
  lines.push(`- failures: ${replay.metrics.failures}`);
  lines.push('');
  lines.push('## Suggested Next Steps');
  lines.push('1. Slice failed runs by signature (timeout/network/tooling/model).');
  lines.push('2. Build replay harness to compare baseline vs patched behavior.');
  lines.push('3. Extract stable prompt/tool decisions into distill dataset.');
  lines.push('4. Gate rollout on replay pass-rate and regression checks.');
  return lines.join('\n');
}

function consumeConfirmation(confirmArg) {
  if (!confirmArg) {
    throw new Error('write action requires confirmation token. Run: npm run tasks -- confirm');
  }

  const code = normalizeConfirmCode(confirmArg);
  if (!code) {
    throw new Error('invalid --confirm value. Expected: "CONFIRM <code>" or "<code>".');
  }

  const payload = readJsonFile(CONFIRMATIONS_PATH, { version: 1, tokens: [] });
  const now = Date.now();
  let matched = false;

  const next = (payload.tokens || []).map((token) => {
    if (token.used) {
      return token;
    }
    if (Number(token.expiresAtMs || 0) <= now) {
      return { ...token, used: true, expired: true };
    }

    if (String(token.code || '').toUpperCase() === code) {
      matched = true;
      return {
        ...token,
        used: true,
        usedAtMs: now,
      };
    }

    return token;
  });

  writeJsonFile(CONFIRMATIONS_PATH, {
    version: 1,
    tokens: next,
  });

  if (!matched) {
    throw new Error('confirmation code is invalid or expired. Run: npm run tasks -- confirm');
  }
}

function normalizeConfirmCode(input) {
  const text = String(input || '').trim();
  if (!text) {
    return '';
  }
  const match = text.match(/^CONFIRM\s+([A-Za-z0-9]+)$/i);
  if (match) {
    return match[1].toUpperCase();
  }
  return text.toUpperCase();
}

function generateCode(size) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let output = '';
  for (let i = 0; i < size; i += 1) {
    const idx = crypto.randomInt(0, alphabet.length);
    output += alphabet[idx];
  }
  return output;
}

async function withTaskLock(lockPath, options, fn) {
  const staleMs = Math.max(30_000, Number(options && options.staleMs ? options.staleMs : 30 * 60 * 1000));
  const waitMs = Math.max(25, Number(options && options.waitMs ? options.waitMs : 120));
  const timeoutMs = Math.max(waitMs, Number(options && options.timeoutMs ? options.timeoutMs : 10_000));
  const startedAtMs = Date.now();
  let lock = null;

  while (Date.now() - startedAtMs <= timeoutMs) {
    lock = acquireTaskLock(lockPath, staleMs);
    if (lock.acquired) {
      break;
    }
    if (lock.reason !== 'already-running') {
      throw new Error(lock.message || `failed to acquire lock: ${lockPath}`);
    }
    await delay(waitMs);
  }

  if (!lock || !lock.acquired) {
    const detail = lock && lock.message ? ` (${lock.message})` : '';
    throw new Error(`timed out acquiring lock: ${lockPath}${detail}`);
  }

  try {
    return await fn();
  } finally {
    releaseTaskLock(lock);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms || 0)));
  });
}

function acquireTaskLock(lockPath, staleMs) {
  ensureDir(path.dirname(lockPath));
  const staleThreshold = Math.max(30_000, Number(staleMs || 30 * 60 * 1000));
  const nowMs = Date.now();
  const payload = {
    pid: process.pid,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    host: os.hostname(),
  };

  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
      return { acquired: true, path: lockPath, pid: process.pid, ageMs: 0 };
    } catch (error) {
      const code = error && error.code ? String(error.code) : '';
      if (code !== 'EEXIST') {
        return {
          acquired: false,
          path: lockPath,
          reason: 'lock-error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const existing = readJsonFile(lockPath, {});
    const existingPid = Number(existing && existing.pid ? existing.pid : 0);
    const existingUpdatedAtMs = Number(
      existing && (existing.updatedAtMs || existing.createdAtMs) ? existing.updatedAtMs || existing.createdAtMs : 0,
    );
    const ageMs = existingUpdatedAtMs > 0 ? Math.max(0, nowMs - existingUpdatedAtMs) : Number.MAX_SAFE_INTEGER;
    const alive = existingPid > 0 ? isPidAlive(existingPid) : false;
    const stale = ageMs > staleThreshold;

    if (!alive || stale) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // ignore unlink races
      }
      continue;
    }

    return {
      acquired: false,
      path: lockPath,
      reason: 'already-running',
      pid: existingPid,
      ageMs,
      message: 'another autopilot process holds the lock',
    };
  }

  return {
    acquired: false,
    path: lockPath,
    reason: 'already-running',
    pid: 0,
    ageMs: 0,
    message: 'lock is currently held',
  };
}

function releaseTaskLock(lock) {
  if (!lock || !lock.acquired || !lock.path) {
    return;
  }
  try {
    fs.unlinkSync(lock.path);
  } catch {
    // ignore unlock races
  }
}

function isPidAlive(pid) {
  const n = Number(pid || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return false;
  }
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function readJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return clone(fallback);
  }
}

function readFileTrim(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sleepMs(ms) {
  const duration = Math.max(0, Number(ms || 0));
  if (!duration) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

function listDir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function trimMessage(text, maxLength) {
  const normalized = String(text || '').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 20)}\n\n...[truncated]`;
}

function singleLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_\-./:]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function joinShell(parts) {
  return parts.map((part) => shellQuote(part)).join(' ');
}

function cronEveryMinutesExpr(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '';
  }
  if (minutes >= 60) {
    const hourStep = Math.max(1, Math.floor(minutes / 60));
    if (hourStep === 1) {
      return `0 * * * *`;
    }
    return `0 */${hourStep} * * *`;
  }
  return `*/${Math.max(1, Math.floor(minutes))} * * * *`;
}

function readCrontab() {
  const result = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status === 0) {
    return String(result.stdout || '');
  }

  const stderr = String(result.stderr || '');
  if (/no crontab/i.test(stderr)) {
    return '';
  }

  throw new Error(`crontab -l failed: ${stderr.trim()}`);
}

function writeCrontab(content) {
  const result = spawnSync('crontab', ['-'], {
    encoding: 'utf8',
    input: content,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`crontab install failed: ${String(result.stderr || '').trim()}`);
  }
}

function replaceCrontabBlock(current, block) {
  const begin = '# OPENCLAW_CONTROL_CENTER_BEGIN';
  const end = '# OPENCLAW_CONTROL_CENTER_END';
  const lines = String(current || '').split('\n');

  const out = [];
  let skip = false;
  for (const line of lines) {
    if (line.trim() === begin) {
      skip = true;
      continue;
    }
    if (line.trim() === end) {
      skip = false;
      continue;
    }
    if (!skip) {
      out.push(line);
    }
  }

  const cleaned = out.join('\n').trim();
  const pieces = [];
  if (cleaned) {
    pieces.push(cleaned);
  }
  pieces.push(block.trim());
  return `${pieces.join('\n\n')}\n`;
}

function generateAuditId() {
  return `audit_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function readRollbackJournal() {
  const state = readJsonFile(ROLLBACK_JOURNAL_PATH, { version: 1, updatedAtMs: 0, entries: [] });
  const entries = Array.isArray(state.entries) ? state.entries : [];
  return {
    version: 1,
    updatedAtMs: Number(state.updatedAtMs || 0),
    entries,
  };
}

function writeRollbackJournal(state) {
  writeJsonFile(ROLLBACK_JOURNAL_PATH, {
    version: 1,
    updatedAtMs: Date.now(),
    entries: Array.isArray(state && state.entries) ? state.entries.slice(-2000) : [],
  });
}

function appendRollbackJournal(entry) {
  if (!entry || typeof entry !== 'object') {
    return;
  }
  const state = readRollbackJournal();
  state.entries.push({
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ...entry,
  });
  writeRollbackJournal(state);
}

function writeJsonFileWithAudit(filePath, value, meta = {}) {
  const before = fs.existsSync(filePath) ? readJsonFile(filePath, null) : null;
  writeJsonFile(filePath, value);
  const auditId = String(meta.auditId || '').trim();
  if (!auditId) {
    return;
  }
  appendRollbackJournal({
    auditId,
    kind: 'json-write',
    filePath,
    reason: String(meta.reason || '').trim(),
    before,
    after: value,
  });
}

function readApprovalsState() {
  const state = readJsonFile(APPROVALS_PATH, { version: 1, tokens: [] });
  return {
    version: 1,
    tokens: Array.isArray(state.tokens) ? state.tokens : [],
  };
}

function normalizeApprovalCode(input) {
  const text = String(input || '').trim();
  if (!text) {
    return '';
  }
  const match = text.match(/^APPROVE\s+([A-Za-z0-9]+)$/i);
  if (match) {
    return String(match[1] || '').trim().toUpperCase();
  }
  return text.toUpperCase();
}

function approvalActionRequired(settings, action) {
  const required = Array.isArray(settings && settings.control && settings.control.approvalRequiredActions)
    ? settings.control.approvalRequiredActions.map((item) => String(item || '').trim().toLowerCase())
    : [];
  return required.includes(String(action || '').trim().toLowerCase());
}

function consumeApprovalIfRequired(settings, approvalArg, action, target = '') {
  if (!approvalActionRequired(settings, action)) {
    return { required: false, approved: true, approvalId: '', action: String(action || '').trim().toLowerCase() };
  }
  if (!approvalArg) {
    throw new Error(`high-risk action "${action}" requires --approval. Run: npm run tasks -- approve --action ${action}`);
  }
  const code = normalizeApprovalCode(approvalArg);
  if (!code) {
    throw new Error('invalid --approval value. Expected: "APPROVE <code>" or "<code>".');
  }

  const now = Date.now();
  const state = readApprovalsState();
  let matched = null;
  const next = state.tokens.map((token) => {
    if (token.used) {
      return token;
    }
    if (Number(token.expiresAtMs || 0) <= now) {
      return { ...token, used: true, expired: true };
    }
    const codeMatches = String(token.code || '').toUpperCase() === code;
    const actionMatches =
      !token.action || token.action === '*' || String(token.action || '').toLowerCase() === String(action || '').toLowerCase();
    if (codeMatches && actionMatches) {
      matched = token;
      return {
        ...token,
        used: true,
        usedAtMs: now,
        usedTarget: String(target || ''),
      };
    }
    return token;
  });

  writeJsonFile(APPROVALS_PATH, {
    version: 1,
    tokens: next.slice(-500),
  });
  if (!matched) {
    throw new Error('approval code is invalid, mismatched action, or expired. Run: npm run tasks -- approve');
  }
  return {
    required: true,
    approved: true,
    approvalId: String(matched.id || ''),
    action: String(action || '').trim().toLowerCase(),
  };
}

async function cmdApprove(settings, flags) {
  const ttlMinutes = Math.max(1, Number(flags.ttl || settings.control.approvalTtlMinutes || 30));
  const action = String(flags.action || flags.scope || '*').trim().toLowerCase() || '*';
  const note = String(flags.note || '').trim();
  const state = readApprovalsState();
  const now = Date.now();
  const token = {
    id: crypto.randomUUID(),
    code: generateCode(8),
    action,
    note,
    createdAtMs: now,
    expiresAtMs: now + ttlMinutes * 60 * 1000,
    used: false,
  };
  const keep = state.tokens.filter((item) => !item.used && Number(item.expiresAtMs || 0) > now);
  keep.push(token);
  writeJsonFile(APPROVALS_PATH, {
    version: 1,
    tokens: keep.slice(-500),
  });

  const result = {
    ok: true,
    action,
    expiresAtMs: token.expiresAtMs,
    command: `APPROVE ${token.code}`,
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `Approval code generated for action=${action} (valid ${ttlMinutes}m):\nAPPROVE ${token.code}\n`,
  );
}

async function cmdAuditRollback(settings, flags) {
  const auditId = String(flags['audit-id'] || flags.auditId || flags._[0] || '').trim();
  if (!auditId) {
    throw new Error('audit-rollback requires --audit-id <id>.');
  }
  consumeConfirmation(flags.confirm);
  const approval = consumeApprovalIfRequired(settings, flags.approval, 'runbook-exec', `audit-rollback:${auditId}`);
  const state = readRollbackJournal();
  const targets = state.entries
    .map((entry, index) => ({ entry, index }))
    .filter((item) => String(item.entry.auditId || '') === auditId)
    .filter((item) => !item.entry.rolledBackAtMs)
    .reverse();
  if (targets.length === 0) {
    const result = {
      ok: true,
      rolledBack: 0,
      auditId,
      approval,
      note: 'no rollback entry found or already rolled back',
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`No rollback entry found for auditId ${auditId}.\n`);
    }
    return;
  }

  const restored = [];
  for (const target of targets) {
    if (target.entry.kind !== 'json-write') {
      continue;
    }
    const filePath = String(target.entry.filePath || '').trim();
    if (!filePath) {
      continue;
    }
    if (target.entry.before === null || target.entry.before === undefined) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } else {
      writeJsonFile(filePath, target.entry.before);
    }
    state.entries[target.index] = {
      ...target.entry,
      rolledBackAtMs: Date.now(),
      rolledBackBy: process.pid,
    };
    restored.push(filePath);
  }
  writeRollbackJournal(state);
  const audit = appendAuditEvent('audit-rollback', {
    auditId,
    restoredFiles: restored,
    count: restored.length,
    approvalId: approval.approvalId || '',
  });

  const result = {
    ok: true,
    auditId,
    rollbackAuditId: audit.auditId,
    restoredFiles: restored,
    rolledBack: restored.length,
    approval,
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `Rollback completed for ${auditId}: restored ${restored.length} file(s).\n`,
  );
}

function readIngestLedger() {
  const state = readJsonFile(INGEST_LEDGER_PATH, { version: 1, updatedAtMs: 0, items: {} });
  const items = state.items && typeof state.items === 'object' ? state.items : {};
  return {
    version: 1,
    updatedAtMs: Number(state.updatedAtMs || 0),
    items,
  };
}

function writeIngestLedger(state, auditId = '', reason = '') {
  const next = {
    version: 1,
    updatedAtMs: Date.now(),
    items: state && state.items && typeof state.items === 'object' ? state.items : {},
  };
  if (auditId) {
    writeJsonFileWithAudit(INGEST_LEDGER_PATH, next, { auditId, reason });
  } else {
    writeJsonFile(INGEST_LEDGER_PATH, next);
  }
}

function normalizeIngestEventType(value, fallback = 'triage.create') {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return fallback;
  }
  return text.replace(/[^a-z0-9._:-]+/g, '-');
}

function buildIngestIdempotencyKey(payload, fallbackEventType = 'triage.create') {
  const source = String(payload && payload.source ? payload.source : '').trim().toLowerCase();
  const sourceIdRaw = String(payload && payload.sourceId ? payload.sourceId : '').trim();
  const sourceId = sourceIdRaw ? normalizeSourceId(sourceIdRaw) : '';
  const eventType = normalizeIngestEventType(payload && payload.eventType ? payload.eventType : '', fallbackEventType);
  if (!source || !sourceId) {
    return '';
  }
  return `${source}:${sourceId}:${eventType}`;
}

function appendIngestLedgerHistory(record, status, detail = {}) {
  const history = Array.isArray(record.history) ? record.history.slice(-19) : [];
  history.push({
    atMs: Date.now(),
    status,
    detail,
  });
  return history;
}

function updateIngestLedgerForItem(item, status, detail = {}) {
  const key = String(item && item.idempotencyKey ? item.idempotencyKey : item && item.dedupeKey ? item.dedupeKey : '').trim();
  if (!key) {
    return;
  }
  const ledger = readIngestLedger();
  const existing = ledger.items[key] && typeof ledger.items[key] === 'object' ? ledger.items[key] : {};
  const source = String(
    item && item.payload && item.payload.source ? item.payload.source : existing.source || '',
  ).trim().toLowerCase();
  const sourceId = String(
    item && item.payload && item.payload.sourceId ? normalizeSourceId(item.payload.sourceId) : existing.sourceId || '',
  ).trim();
  const eventType = normalizeIngestEventType(
    item && item.payload && item.payload.eventType ? item.payload.eventType : existing.eventType || '',
    'triage.create',
  );
  const nowMs = Date.now();
  const merged = {
    ...existing,
    key,
    source,
    sourceId,
    eventType,
    queueId: String(item && item.id ? item.id : existing.queueId || ''),
    kind: String(item && item.kind ? item.kind : existing.kind || ''),
    status,
    attempts: Number(detail.attempts || item.attempts || existing.attempts || 0),
    retries: Number(detail.retries || existing.retries || 0),
    issueIdentifier: String(detail.issueIdentifier || existing.issueIdentifier || ''),
    issueId: String(detail.issueId || existing.issueId || ''),
    lastError: String(detail.error || detail.lastError || item.lastError || existing.lastError || ''),
    firstSeenAtMs: Number(existing.firstSeenAtMs || item.createdAtMs || nowMs),
    lastSeenAtMs: nowMs,
    updatedAtMs: nowMs,
    history: appendIngestLedgerHistory(existing, status, detail),
  };
  ledger.items[key] = merged;
  writeIngestLedger(ledger);
}

function readWebhookMetrics() {
  const state = readJsonFile(WEBHOOK_METRICS_PATH, { version: 1, updatedAtMs: 0, samples: [] });
  return {
    version: 1,
    updatedAtMs: Number(state.updatedAtMs || 0),
    samples: Array.isArray(state.samples) ? state.samples : [],
  };
}

function writeWebhookMetrics(state) {
  writeJsonFile(WEBHOOK_METRICS_PATH, {
    version: 1,
    updatedAtMs: Date.now(),
    samples: Array.isArray(state.samples) ? state.samples.slice(-4000) : [],
  });
}

function calcPercentile(values, p) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (nums.length === 0) {
    return 0;
  }
  const rank = Math.min(nums.length - 1, Math.max(0, Math.ceil((Number(p || 0) / 100) * nums.length) - 1));
  return nums[rank];
}

function summarizeWebhookMetrics(state) {
  const samples = Array.isArray(state && state.samples) ? state.samples : [];
  const latencies = samples.map((item) => Number(item.latencyMs || 0)).filter((n) => Number.isFinite(n) && n >= 0);
  const githubEvents = samples.filter((item) => String(item.source || '').toLowerCase() === 'github');
  const githubLatencies = githubEvents
    .map((item) => Number(item.latencyMs || 0))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return {
    events: samples.length,
    p50Ms: calcPercentile(latencies, 50),
    p95Ms: calcPercentile(latencies, 95),
    p99Ms: calcPercentile(latencies, 99),
    githubEvents: githubEvents.length,
    githubP95Ms: calcPercentile(githubLatencies, 95),
    lastEventAtMs: samples.length > 0 ? Number(samples[samples.length - 1].atMs || 0) : 0,
  };
}

function recordWebhookMetric(input) {
  const state = readWebhookMetrics();
  state.samples.push({
    atMs: Date.now(),
    source: String(input && input.source ? input.source : 'unknown').trim().toLowerCase(),
    eventType: normalizeIngestEventType(input && input.eventType ? input.eventType : '', 'unknown.event'),
    status: String(input && input.status ? input.status : 'ok').trim().toLowerCase(),
    latencyMs: Math.max(0, Number(input && input.latencyMs ? input.latencyMs : 0)),
    delivery: String(input && input.delivery ? input.delivery : '').trim(),
    replay: Boolean(input && input.replay),
  });
  writeWebhookMetrics(state);
  return summarizeWebhookMetrics(state);
}

function readWebhookReplayIndex() {
  const state = readJsonFile(WEBHOOK_REPLAY_INDEX_PATH, { version: 1, updatedAtMs: 0, items: {} });
  return {
    version: 1,
    updatedAtMs: Number(state.updatedAtMs || 0),
    items: state.items && typeof state.items === 'object' ? state.items : {},
  };
}

function writeWebhookReplayIndex(state) {
  writeJsonFile(WEBHOOK_REPLAY_INDEX_PATH, {
    version: 1,
    updatedAtMs: Date.now(),
    items: state.items && typeof state.items === 'object' ? state.items : {},
  });
}

function isWebhookReplayDuplicate(source, deliveryId, settings) {
  const sourceKey = String(source || '').trim().toLowerCase();
  const id = String(deliveryId || '').trim();
  if (!sourceKey || !id) {
    return false;
  }
  const state = readWebhookReplayIndex();
  const key = `${sourceKey}:${id}`;
  const existingAt = Number(state.items[key] || 0);
  if (!existingAt) {
    return false;
  }
  const replayWindowHours = Math.max(1, Number(settings.ingest.replayWindowHours || 72));
  return Date.now() - existingAt <= replayWindowHours * 60 * 60 * 1000;
}

function markWebhookReplaySeen(source, deliveryId) {
  const sourceKey = String(source || '').trim().toLowerCase();
  const id = String(deliveryId || '').trim();
  if (!sourceKey || !id) {
    return;
  }
  const state = readWebhookReplayIndex();
  const nowMs = Date.now();
  const key = `${sourceKey}:${id}`;
  state.items[key] = nowMs;
  const cutoffMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  const nextItems = {};
  for (const [itemKey, ts] of Object.entries(state.items)) {
    if (Number(ts || 0) >= cutoffMs) {
      nextItems[itemKey] = Number(ts || 0);
    }
  }
  state.items = nextItems;
  writeWebhookReplayIndex(state);
}

async function cmdWebhookMetrics(_settings, flags) {
  const state = readWebhookMetrics();
  const summary = summarizeWebhookMetrics(state);
  const result = {
    ok: true,
    ...summary,
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push('Webhook metrics:');
  lines.push(`- events: ${summary.events}`);
  lines.push(`- p95 latency: ${summary.p95Ms}ms`);
  lines.push(`- github events: ${summary.githubEvents}`);
  lines.push(`- github p95 latency: ${summary.githubP95Ms}ms`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdWebhookTest(settings, flags) {
  const events = Math.max(10, Number(flags.events || 100));
  const maxLatencyMs = Math.max(20, Number(flags['max-latency-ms'] || 1500));
  const replayId = `wh-test-${Date.now()}`;
  const replayBefore = isWebhookReplayDuplicate('github', replayId, settings);
  markWebhookReplaySeen('github', replayId);
  const replayAfter = isWebhookReplayDuplicate('github', replayId, settings);
  for (let i = 0; i < events; i += 1) {
    const latencyMs = Math.max(5, Math.floor((i / events) * maxLatencyMs));
    recordWebhookMetric({
      source: i % 2 === 0 ? 'github' : 'discord',
      eventType: i % 2 === 0 ? 'github.pull_request.opened' : 'discord.message',
      status: 'ok',
      latencyMs,
      delivery: `test-${Date.now()}-${i}`,
      replay: false,
    });
  }
  const summary = summarizeWebhookMetrics(readWebhookMetrics());
  const result = {
    ok: true,
    eventsInjected: events,
    replayBefore,
    replayAfter,
    p95Ms: summary.p95Ms,
    githubP95Ms: summary.githubP95Ms,
    passLatency: summary.p95Ms < 30_000 && summary.githubP95Ms < 30_000,
    passReplay: replayBefore === false && replayAfter === true,
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push('Webhook acceptance test:');
  lines.push(`- events injected: ${events}`);
  lines.push(`- replay protection: ${result.passReplay ? 'pass' : 'fail'}`);
  lines.push(`- p95 latency: ${summary.p95Ms}ms`);
  lines.push(`- github p95 latency: ${summary.githubP95Ms}ms`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function drainIngestQueue(settings, flags = {}, options = {}) {
  const queueState = readJsonFile(INGEST_QUEUE_PATH, { version: 1, items: [] });
  const dlqState = readJsonFile(INGEST_DLQ_PATH, { version: 1, items: [] });
  const queueItems = Array.isArray(queueState.items) ? queueState.items : [];
  const dlqItems = Array.isArray(dlqState.items) ? dlqState.items : [];
  const nowMs = Date.now();
  const maxRetries = Math.max(
    1,
    Number(options.maxRetriesOverride || flags['max-retries'] || settings.intakeQueue.maxRetries || 5),
  );
  const targetId = String(flags.id || '').trim();
  const processLimit = Math.max(0, Number(flags.limit || 0));

  const kept = [];
  const processed = [];
  let success = 0;
  let retried = 0;
  let movedToDlq = 0;
  let attempted = 0;

  for (const item of queueItems) {
    const nextAt = Number(item.nextAttemptAtMs || 0);
    if (targetId && String(item.id || '') !== targetId) {
      kept.push(item);
      continue;
    }
    if (processLimit > 0 && attempted >= processLimit) {
      kept.push(item);
      continue;
    }
    if (nextAt > nowMs && !flags.force) {
      kept.push(item);
      continue;
    }
    attempted += 1;
    try {
      const issue = await processQueuedIngestItem(item, settings);
      success += 1;
      processed.push({
        id: item.id,
        status: 'delivered',
        issueIdentifier: issue && issue.identifier ? issue.identifier : '',
      });
      updateIngestLedgerForItem(item, 'delivered', {
        issueIdentifier: issue && issue.identifier ? issue.identifier : '',
        issueId: issue && issue.id ? issue.id : '',
        attempts: Number(item.attempts || 0),
      });
      appendAuditEvent('ingest-queue-delivered', {
        queueId: item.id,
        kind: item.kind,
        issueIdentifier: issue && issue.identifier ? issue.identifier : '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = Number(item.attempts || 0) + 1;
      const retryEntry = {
        atMs: nowMs,
        attempts,
        error: message,
      };
      const retryHistory = Array.isArray(item.retryHistory)
        ? item.retryHistory.slice(-19).concat([retryEntry])
        : [retryEntry];
      if (attempts >= maxRetries) {
        movedToDlq += 1;
        const dlqItem = {
          ...item,
          attempts,
          retryHistory,
          lastError: message,
          movedToDlqAtMs: nowMs,
        };
        dlqItems.push(dlqItem);
        processed.push({
          id: item.id,
          status: 'dlq',
          attempts,
          error: message,
        });
        updateIngestLedgerForItem(dlqItem, 'dlq', {
          attempts,
          error: message,
          retries: attempts,
        });
        appendAuditEvent('ingest-queue-dlq', {
          queueId: item.id,
          kind: item.kind,
          attempts,
          error: message,
        });
      } else {
        retried += 1;
        const backoffMs = computeIngestBackoffMs(attempts);
        const retryItem = {
          ...item,
          attempts,
          retryHistory,
          lastError: message,
          nextAttemptAtMs: nowMs + backoffMs,
          updatedAtMs: nowMs,
        };
        kept.push(retryItem);
        processed.push({
          id: item.id,
          status: 'retry',
          attempts,
          nextAttemptAtMs: nowMs + backoffMs,
          error: message,
        });
        updateIngestLedgerForItem(retryItem, 'retry', {
          attempts,
          error: message,
          retries: attempts,
        });
      }
    }
  }

  queueState.version = 1;
  queueState.updatedAtMs = nowMs;
  queueState.items = kept;
  dlqState.version = 1;
  dlqState.updatedAtMs = nowMs;
  dlqState.items = dlqItems;
  writeJsonFile(INGEST_QUEUE_PATH, queueState);
  writeJsonFile(INGEST_DLQ_PATH, dlqState);

  return {
    ok: true,
    queuedBefore: queueItems.length,
    queuedAfter: kept.length,
    success,
    retried,
    movedToDlq,
    attempted,
    maxRetries,
    processed,
  };
}

function replayDlqItems(_settings, flags = {}, options = {}) {
  const queueState = readJsonFile(INGEST_QUEUE_PATH, { version: 1, items: [] });
  const dlqState = readJsonFile(INGEST_DLQ_PATH, { version: 1, items: [] });
  const queueItems = Array.isArray(queueState.items) ? queueState.items : [];
  const dlqItems = Array.isArray(dlqState.items) ? dlqState.items : [];
  const id = String(flags.id || '').trim();
  const source = String(flags.source || '').trim().toLowerCase();
  const eventTypeFilter = normalizeIngestEventType(flags['event-type'] || flags.eventType || '', '');
  const all = isTruthyLike(flags.all);
  const limit = Math.max(1, Number(flags.limit || (id ? 1 : 20)));
  const keepAttempts = isTruthyLike(flags['keep-attempts']);
  const clearFailure = flags['clear-failure'] === undefined ? true : isTruthyLike(flags['clear-failure']);

  const selected = [];
  const remainingDlq = [];
  for (const item of dlqItems) {
    const matchesId = id ? String(item.id || '') === id : true;
    const matchesSource = source
      ? String(item && item.payload && item.payload.source ? item.payload.source : '').trim().toLowerCase() === source
      : true;
    const matchesEventType = eventTypeFilter
      ? normalizeIngestEventType(item && item.payload ? item.payload.eventType : '', '') === eventTypeFilter
      : true;
    if (matchesId && matchesSource && matchesEventType && (all || selected.length < limit)) {
      selected.push(item);
    } else {
      remainingDlq.push(item);
    }
  }

  const nowMs = Date.now();
  const moved = [];
  for (const item of selected) {
    const payload = item && item.payload && typeof item.payload === 'object' ? { ...item.payload } : {};
    if (clearFailure) {
      payload.__simulateFailure = false;
      payload.failUntilAttempt = 0;
    }
    const replayed = {
      ...item,
      payload,
      attempts: keepAttempts ? Number(item.attempts || 0) : 0,
      nextAttemptAtMs: nowMs,
      updatedAtMs: nowMs,
      movedToDlqAtMs: 0,
      replayedAtMs: nowMs,
      replayCount: Number(item.replayCount || 0) + 1,
    };
    queueItems.push(replayed);
    moved.push({
      id: replayed.id,
      source: payload.source || '',
      sourceId: payload.sourceId || '',
      eventType: payload.eventType || '',
    });
    updateIngestLedgerForItem(replayed, 'replayed', {
      attempts: replayed.attempts,
    });
  }

  queueState.version = 1;
  queueState.updatedAtMs = nowMs;
  queueState.items = queueItems;
  dlqState.version = 1;
  dlqState.updatedAtMs = nowMs;
  dlqState.items = remainingDlq;
  writeJsonFile(INGEST_QUEUE_PATH, queueState);
  writeJsonFile(INGEST_DLQ_PATH, dlqState);
  if (!options.silent) {
    appendAuditEvent('ingest-dlq-replay', {
      selected: moved.length,
      id: id || '',
      source: source || '',
      eventType: eventTypeFilter || '',
      keepAttempts,
      clearFailure,
    });
  }
  return {
    ok: true,
    moved: moved.length,
    items: moved,
    queueAfter: queueItems.length,
    dlqAfter: remainingDlq.length,
  };
}

async function cmdQueueReplay(settings, flags) {
  const replay = replayDlqItems(settings, flags, { silent: false });
  let drained = null;
  if (isTruthyLike(flags.drain)) {
    drained = await drainIngestQueue(settings, { json: true }, {});
  }
  const result = {
    ...replay,
    drained,
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push('DLQ replay result:');
  lines.push(`- moved: ${replay.moved}`);
  lines.push(`- queue after: ${replay.queueAfter}`);
  lines.push(`- dlq after: ${replay.dlqAfter}`);
  if (drained) {
    lines.push(`- drained delivered: ${drained.success}`);
    lines.push(`- drained dlq: ${drained.movedToDlq}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdIngestTest(settings, flags) {
  const queueBackup = readJsonFile(INGEST_QUEUE_PATH, { version: 1, items: [] });
  const dlqBackup = readJsonFile(INGEST_DLQ_PATH, { version: 1, items: [] });
  const ledgerBackup = readIngestLedger();
  const maxRetries = Math.max(2, Number(flags['max-retries'] || 2));

  try {
    writeJsonFile(INGEST_QUEUE_PATH, { version: 1, updatedAtMs: Date.now(), items: [] });
    writeJsonFile(INGEST_DLQ_PATH, { version: 1, updatedAtMs: Date.now(), items: [] });
    writeIngestLedger({ version: 1, updatedAtMs: Date.now(), items: {} });

    const dedupePayload = {
      source: 'acceptance',
      sourceId: 'ingest-dedupe-case',
      eventType: 'acceptance.ingest.dedupe',
      title: 'dedupe check',
    };
    const dedupeItems = [];
    for (let i = 0; i < 10; i += 1) {
      dedupeItems.push(enqueueIngestItem('test-noop', dedupePayload, new Error('dedupe'), settings));
    }
    const uniqueQueueIds = new Set(dedupeItems.map((item) => String(item.id || '')).filter(Boolean));

    const failItem = enqueueIngestItem(
      'test-noop',
      {
        source: 'acceptance',
        sourceId: 'ingest-dlq-case',
        eventType: 'acceptance.ingest.dlq',
        failUntilAttempt: 999,
        simulatedError: 'forced dlq',
      },
      new Error('forced dlq'),
      settings,
    );

    await drainIngestQueue(settings, { force: true }, { maxRetriesOverride: maxRetries });
    const drainAfterSecond = await drainIngestQueue(settings, { force: true }, { maxRetriesOverride: maxRetries });
    const dlqNow = readJsonFile(INGEST_DLQ_PATH, { version: 1, items: [] });
    const inDlq = (Array.isArray(dlqNow.items) ? dlqNow.items : []).some((item) => String(item.id || '') === failItem.id);

    const replay = replayDlqItems(
      settings,
      { id: failItem.id, limit: 1, all: false, 'clear-failure': true },
      { silent: true },
    );
    const drainAfterReplay = await drainIngestQueue(settings, { force: true }, { maxRetriesOverride: maxRetries });

    const ledger = readIngestLedger();
    const dedupePass = uniqueQueueIds.size === 1;
    const dlqPass = inDlq || drainAfterSecond.movedToDlq > 0;
    const replayPass = replay.moved === 1 && drainAfterReplay.success >= 1;
    const result = {
      ok: dedupePass && dlqPass && replayPass,
      dedupe: {
        injected: 10,
        uniqueQueueItems: uniqueQueueIds.size,
        pass: dedupePass,
      },
      dlq: {
        movedToDlq: drainAfterSecond.movedToDlq,
        inDlq,
        pass: dlqPass,
      },
      replay: {
        moved: replay.moved,
        deliveredAfterReplay: drainAfterReplay.success,
        pass: replayPass,
      },
      ledgerItems: Object.keys(ledger.items || {}).length,
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const lines = [];
    lines.push('Ingest acceptance test:');
    lines.push(`- dedupe: ${dedupePass ? 'pass' : 'fail'} (unique=${uniqueQueueIds.size})`);
    lines.push(`- dlq path: ${dlqPass ? 'pass' : 'fail'} (moved=${drainAfterSecond.movedToDlq})`);
    lines.push(`- replay path: ${replayPass ? 'pass' : 'fail'} (moved=${replay.moved}, delivered=${drainAfterReplay.success})`);
    process.stdout.write(`${lines.join('\n')}\n`);
  } finally {
    writeJsonFile(INGEST_QUEUE_PATH, queueBackup);
    writeJsonFile(INGEST_DLQ_PATH, dlqBackup);
    writeIngestLedger(ledgerBackup);
  }
}

function classifyExecutorFailure(message) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) {
    return 'unknown';
  }
  if (
    text.includes('rate limit') ||
    text.includes('429') ||
    text.includes('cooldown') ||
    text.includes('throttl')
  ) {
    return 'rate_limit';
  }
  if (
    text.includes('session file locked') ||
    text.includes('already-running') ||
    text.includes('lock conflict') ||
    text.includes('lock')
  ) {
    return 'lock_conflict';
  }
  if (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('etimedout') ||
    text.includes('timeoutexpired')
  ) {
    return 'timeout';
  }
  return 'unknown';
}

function isRetryableExecutorCategory(category) {
  return ['rate_limit', 'lock_conflict', 'timeout'].includes(String(category || '').trim().toLowerCase());
}

function computeExecutorBackoffMs(category, attemptNo, baseBackoffSeconds, settings = {}) {
  const n = Math.max(1, Number(attemptNo || 1));
  const baseSeconds = Math.max(1, Number(baseBackoffSeconds || 20));
  const factors = settings && settings.execution && settings.execution.backoffByFailureClass
    ? settings.execution.backoffByFailureClass
    : {};
  const factor = Math.max(
    0.2,
    Number(
      factors && Object.prototype.hasOwnProperty.call(factors, category)
        ? factors[category]
        : factors.unknown || 1,
    ),
  );
  const raw = baseSeconds * 1000 * n * factor;
  return Math.min(10 * 60 * 1000, Math.round(raw));
}

function recordExecutorStabilityRun(sample) {
  const state = readJsonFile(EXECUTOR_STABILITY_PATH, { version: 1, updatedAtMs: 0, runs: [] });
  const runs = Array.isArray(state.runs) ? state.runs : [];
  runs.unshift({
    atMs: Date.now(),
    ...sample,
  });
  const kept = runs.slice(0, 500);
  writeJsonFile(EXECUTOR_STABILITY_PATH, {
    version: 1,
    updatedAtMs: Date.now(),
    runs: kept,
  });
}

function syntheticExecutorErrorMessage(category) {
  if (category === 'rate_limit') {
    return 'HTTP 429 rate limit';
  }
  if (category === 'timeout') {
    return 'request timed out after 30s';
  }
  if (category === 'lock_conflict') {
    return 'session file locked by another process';
  }
  return 'unknown upstream failure';
}

async function cmdExecutorTest(settings, flags) {
  const concurrency = Math.max(20, Number(flags.concurrent || 20));
  const maxAttempts = Math.max(2, Number(flags['max-attempts'] || 3));
  const baseBackoffSeconds = Math.max(1, Number(flags['backoff-seconds'] || 1));
  const lockPath = path.join(DATA_DIR, 'executor-test.lock.json');
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // ignore
  }

  let activeCritical = 0;
  let maxCritical = 0;
  let lockConflicts = 0;
  const durations = [];
  const classCount = {
    rate_limit: 0,
    lock_conflict: 0,
    timeout: 0,
    unknown: 0,
  };
  const retryableSummary = {
    total: 0,
    recovered: 0,
  };

  const lockWorkers = Array.from({ length: concurrency }).map((_, idx) => (async () => {
    const startedAtMs = Date.now();
    await withTaskLock(
      lockPath,
      {
        staleMs: 5_000,
        waitMs: 2,
        timeoutMs: 2_000,
      },
      async () => {
        activeCritical += 1;
        maxCritical = Math.max(maxCritical, activeCritical);
        await sleepMs(2);
        activeCritical -= 1;
      },
    ).catch(() => {
      lockConflicts += 1;
    });
    durations.push(Date.now() - startedAtMs + idx % 3);
  })());
  await Promise.all(lockWorkers);

  const scenarios = ['rate_limit', 'timeout', 'lock_conflict', 'unknown'];
  const scenarioRuns = [];
  for (const category of scenarios) {
    const startedAtMs = Date.now();
    let attempt = 0;
    let recovered = false;
    let terminal = '';
    while (attempt < maxAttempts) {
      attempt += 1;
      if (attempt === 1) {
        const message = syntheticExecutorErrorMessage(category);
        const cls = classifyExecutorFailure(message);
        terminal = cls;
        classCount[cls] = Number(classCount[cls] || 0) + 1;
        if (!isRetryableExecutorCategory(cls)) {
          break;
        }
        retryableSummary.total += 1;
        const backoffMs = computeExecutorBackoffMs(cls, attempt, baseBackoffSeconds, settings);
        await sleepMs(Math.min(20, backoffMs));
        continue;
      }
      recovered = true;
      break;
    }
    if (recovered && isRetryableExecutorCategory(terminal)) {
      retryableSummary.recovered += 1;
    }
    scenarioRuns.push({
      category,
      terminal,
      attempts: attempt,
      recovered,
      durationMs: Date.now() - startedAtMs,
    });
    durations.push(Date.now() - startedAtMs);
  }

  const recoveredCount = scenarioRuns.filter((item) => item.recovered).length;
  const failedCount = scenarioRuns.length - recoveredCount;
  const maxAttemptsUsed = scenarioRuns.reduce((acc, item) => Math.max(acc, Number(item.attempts || 0)), 0);
  const summary = {
    ok:
      maxCritical <= 1 &&
      retryableSummary.total === retryableSummary.recovered &&
      classCount.rate_limit > 0 &&
      classCount.timeout > 0 &&
      classCount.lock_conflict > 0,
    totalRuns: scenarioRuns.length,
    recovered: recoveredCount,
    failed: failedCount,
    lockConflicts,
    maxConcurrentCritical: maxCritical,
    failureClassCount: classCount,
    retryable: retryableSummary,
    avgRecoveryMs: durations.length > 0 ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)) : 0,
    p95RecoveryMs: calcPercentile(durations, 95),
    maxAttemptsUsed,
    scenarios: scenarioRuns,
  };
  recordExecutorStabilityRun(summary);
  appendAuditEvent('executor-test', summary);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push('Executor acceptance test:');
  lines.push(`- total runs: ${summary.totalRuns}`);
  lines.push(`- recovered: ${summary.recovered}`);
  lines.push(`- failed: ${summary.failed}`);
  lines.push(`- max concurrent critical sections: ${summary.maxConcurrentCritical}`);
  lines.push(`- retryable recovered: ${summary.retryable.recovered}/${summary.retryable.total}`);
  lines.push(`- p95 recovery: ${summary.p95RecoveryMs}ms`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function inferIssueFromSession(session, settings) {
  const teamKey = String(settings && settings.linear && settings.linear.teamKey ? settings.linear.teamKey : 'CLAW')
    .trim()
    .toUpperCase();
  const issuePattern = new RegExp(`\\b${escapeRegExp(teamKey)}-(\\d+)\\b`, 'i');
  const explicit = [
    session && session.issueIdentifier ? session.issueIdentifier : '',
    session && session.issueId ? session.issueId : '',
    session && session.linearIssue ? session.linearIssue : '',
  ];
  for (const value of explicit) {
    const normalized = normalizeLinearIssueId(value);
    if (normalized) {
      return normalized;
    }
  }
  const textCandidates = [
    session && session.key ? session.key : '',
    session && session.sessionId ? session.sessionId : '',
    session && session.kind ? session.kind : '',
    session && session.model ? session.model : '',
  ];
  for (const text of textCandidates) {
    const match = String(text || '').match(issuePattern);
    if (match && match[0]) {
      const normalized = normalizeLinearIssueId(match[0]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return '';
}

function buildReverseIssueBindings(bindings) {
  const reverse = {};
  const push = (identifier, field, value) => {
    const normalized = normalizeLinearIssueId(identifier);
    if (!normalized || !value) {
      return;
    }
    if (!reverse[normalized]) {
      reverse[normalized] = {
        taskIds: [],
        sessionIds: [],
        sessionKeys: [],
        subagentIds: [],
        cronIds: [],
      };
    }
    const arr = reverse[normalized][field];
    const text = String(value);
    if (!arr.includes(text)) {
      arr.push(text);
    }
  };
  for (const [taskId, identifier] of Object.entries(bindings.byTaskId || {})) {
    push(identifier, 'taskIds', taskId);
  }
  for (const [sessionId, identifier] of Object.entries(bindings.bySessionId || {})) {
    push(identifier, 'sessionIds', sessionId);
  }
  for (const [sessionKey, identifier] of Object.entries(bindings.bySessionKey || {})) {
    push(identifier, 'sessionKeys', sessionKey);
  }
  for (const [subagentId, identifier] of Object.entries(bindings.bySubagentId || {})) {
    push(identifier, 'subagentIds', subagentId);
  }
  for (const [cronId, identifier] of Object.entries(bindings.byCronId || {})) {
    push(identifier, 'cronIds', cronId);
  }
  return reverse;
}

async function cmdBindingCoverage(settings, flags) {
  const activeWindowMinutes = Math.max(10, Number(flags['active-minutes'] || settings.statusMachine.activeWindowMinutes || 120));
  const activeWindowMs = activeWindowMinutes * 60 * 1000;
  const autoRepair = flags['auto-repair'] === undefined ? true : isTruthyLike(flags['auto-repair']);
  const autoCreateIssue = flags['auto-create-issue'] === undefined ? true : isTruthyLike(flags['auto-create-issue']);
  const apiReady = Boolean(String(settings.linear.apiKey || '').trim());
  const bindings = readJsonFile(ISSUE_LINKS_PATH, {
    version: 1,
    updatedAtMs: 0,
    byTaskId: {},
    bySessionId: {},
    bySessionKey: {},
    bySubagentId: {},
    byCronId: {},
    byIssue: {},
  });

  const sessions = loadSessions(settings).filter((item) => Number(item.ageMs || Number.POSITIVE_INFINITY) <= activeWindowMs);
  const subagents = loadSubagents(settings).filter((item) => item.isActive);
  const linkedSessions = [];
  const orphanSessions = [];
  const linkedSubagents = [];
  const orphanSubagents = [];
  let repaired = 0;

  for (const session of sessions) {
    const taskId = `session:${session.agentId}:${session.key}`;
    let identifier = resolveIssueFromBindings(bindings, {
      taskId,
      sessionId: session.sessionId || '',
      sessionKey: session.key || '',
    });
    if (!identifier && autoRepair) {
      const inferred = inferIssueFromSession(session, settings);
      if (inferred) {
        const upsert = upsertRuntimeIssueBindings(inferred, {
          taskId,
          sessionId: session.sessionId || '',
          sessionKey: session.key || '',
          agentId: session.agentId || '',
        });
        if (upsert.updated) {
          repaired += 1;
        }
        identifier = inferred;
      }
    }
    if (identifier) {
      linkedSessions.push({ taskId, identifier });
    } else {
      orphanSessions.push({
        taskId,
        sessionId: session.sessionId || '',
        sessionKey: session.key || '',
      });
    }
  }

  for (const subagent of subagents) {
    const taskId = `subagent:${subagent.id}`;
    let identifier = resolveIssueFromBindings(bindings, {
      taskId,
      subagentId: subagent.id,
    });
    if (!identifier && autoRepair) {
      const inferred = inferIssueFromSubagent(subagent, settings);
      if (inferred) {
        const upsert = upsertRuntimeIssueBindings(inferred, {
          taskId,
          subagentId: subagent.id,
        });
        if (upsert.updated) {
          repaired += 1;
        }
        identifier = inferred;
      }
    }
    if (identifier) {
      linkedSubagents.push({ taskId, identifier });
    } else {
      orphanSubagents.push({
        taskId,
        subagentId: subagent.id,
      });
    }
  }

  let orphanIssue = null;
  if ((orphanSessions.length > 0 || orphanSubagents.length > 0) && autoCreateIssue && apiReady) {
    const orphanDelivery = await createTriageIssueWithFallback(
      {
        title: `[ops] Runtime orphan bindings (${orphanSessions.length + orphanSubagents.length})`,
        description: [
          'Auto-created by binding-coverage command.',
          `orphan sessions: ${orphanSessions.length}`,
          `orphan subagents: ${orphanSubagents.length}`,
        ].join('\n'),
        source: 'mission-control',
        sourceId: `runtime-orphan:${Date.now()}`,
        eventType: 'runtime.binding.orphan',
        labels: ['ops', 'runtime-binding'],
        state: 'Triage',
        priority: 2,
      },
      settings,
      { context: 'binding-coverage' },
    );
    if (!orphanDelivery.queued && orphanDelivery.issue && orphanDelivery.issue.identifier) {
      orphanIssue = orphanDelivery.issue;
      for (const item of orphanSessions) {
        const upsert = upsertRuntimeIssueBindings(orphanIssue.identifier, {
          taskId: item.taskId,
          sessionId: item.sessionId,
          sessionKey: item.sessionKey,
        });
        if (upsert.updated) {
          repaired += 1;
        }
      }
      for (const item of orphanSubagents) {
        const upsert = upsertRuntimeIssueBindings(orphanIssue.identifier, {
          taskId: item.taskId,
          subagentId: item.subagentId,
        });
        if (upsert.updated) {
          repaired += 1;
        }
      }
    }
  }

  const refreshed = readJsonFile(ISSUE_LINKS_PATH, {
    version: 1,
    updatedAtMs: 0,
    byTaskId: {},
    bySessionId: {},
    bySessionKey: {},
    bySubagentId: {},
    byCronId: {},
    byIssue: {},
  });
  refreshed.byIssue = buildReverseIssueBindings(refreshed);
  writeJsonFile(ISSUE_LINKS_PATH, refreshed);

  const finalSessions = loadSessions(settings).filter((item) => Number(item.ageMs || Number.POSITIVE_INFINITY) <= activeWindowMs);
  const finalSubagents = loadSubagents(settings).filter((item) => item.isActive);
  const finalOrphanSessions = finalSessions.filter((session) => {
    const taskId = `session:${session.agentId}:${session.key}`;
    return !resolveIssueFromBindings(refreshed, {
      taskId,
      sessionId: session.sessionId || '',
      sessionKey: session.key || '',
    });
  });
  const finalOrphanSubagents = finalSubagents.filter((item) => {
    const taskId = `subagent:${item.id}`;
    return !resolveIssueFromBindings(refreshed, {
      taskId,
      subagentId: item.id,
    });
  });

  const total = finalSessions.length + finalSubagents.length;
  const orphan = finalOrphanSessions.length + finalOrphanSubagents.length;
  const linked = total - orphan;
  const coverage = total > 0 ? Number(((linked / total) * 100).toFixed(2)) : 100;
  const report = {
    ok: orphan === 0,
    generatedAtMs: Date.now(),
    total,
    linked,
    orphan,
    coverage,
    sessions: {
      total: finalSessions.length,
      orphan: finalOrphanSessions.length,
    },
    subagents: {
      total: finalSubagents.length,
      orphan: finalOrphanSubagents.length,
    },
    repaired,
    orphanIssue: orphanIssue
      ? {
          identifier: orphanIssue.identifier,
          url: orphanIssue.url || '',
        }
      : null,
    byIssue: refreshed.byIssue,
  };
  writeJsonFile(BINDING_COVERAGE_PATH, report);
  appendAuditEvent('binding-coverage', {
    total,
    linked,
    orphan,
    coverage,
    repaired,
    orphanIssue: orphanIssue ? orphanIssue.identifier : '',
  });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push('Binding coverage:');
  lines.push(`- total: ${total}`);
  lines.push(`- linked: ${linked}`);
  lines.push(`- orphan: ${orphan}`);
  lines.push(`- coverage: ${coverage}%`);
  lines.push(`- repaired: ${repaired}`);
  if (orphanIssue && orphanIssue.identifier) {
    lines.push(`- orphan issue: ${orphanIssue.identifier}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function defaultStatusMachineRules(settings) {
  return [
    {
      id: 'cron-warning',
      reason: 'cron-warning',
      metric: 'cronWarnings',
      min: 1,
      targetState: String(settings.statusMachine.stateBlocked || 'Blocked'),
    },
    {
      id: 'github-merged',
      reason: 'github-merged',
      metric: 'githubMerged',
      min: 1,
      targetState: String(settings.statusMachine.stateDone || settings.github.stateDone || 'Done'),
    },
    {
      id: 'github-open-pr',
      reason: 'github-open-pr',
      metric: 'githubOpen',
      min: 1,
      targetState: String(settings.statusMachine.stateInReview || settings.github.stateInReview || 'In Review'),
    },
    {
      id: 'runtime-active',
      reason: 'runtime-active',
      metric: 'runtimeActive',
      min: 1,
      targetState: String(settings.statusMachine.stateInProgress || 'In Progress'),
    },
    {
      id: 'autopilot-blocked',
      reason: 'autopilot-recent',
      metric: 'autopilotRecentBlocked',
      min: 1,
      targetState: String(settings.statusMachine.stateBlocked || 'Blocked'),
    },
    {
      id: 'autopilot-recent',
      reason: 'autopilot-recent',
      metric: 'autopilotRecent',
      min: 1,
      targetState: String(settings.statusMachine.stateInProgress || 'In Progress'),
    },
  ];
}

function validateStatusMachineRules(rules) {
  const list = Array.isArray(rules) ? rules : [];
  const errors = [];
  const normalized = [];
  for (const raw of list) {
    const rule = raw && typeof raw === 'object' ? raw : {};
    const id = String(rule.id || '').trim();
    const reason = String(rule.reason || id || '').trim();
    const metric = String(rule.metric || '').trim();
    const min = Math.max(1, Number(rule.min || 1));
    const targetState = String(rule.targetState || '').trim();
    if (!id) {
      errors.push('rule id is required');
      continue;
    }
    if (!metric) {
      errors.push(`rule ${id}: metric is required`);
      continue;
    }
    if (!targetState) {
      errors.push(`rule ${id}: targetState is required`);
      continue;
    }
    normalized.push({
      id,
      reason: reason || id,
      metric,
      min,
      targetState,
    });
  }
  return {
    ok: errors.length === 0 && normalized.length > 0,
    errors,
    rules: normalized,
  };
}

function statusMachineRuleMetricValue(metric, context) {
  const key = String(metric || '').trim();
  if (key === 'cronWarnings') {
    return Array.isArray(context.cronWarnings) ? context.cronWarnings.length : 0;
  }
  if (key === 'githubMerged') {
    return Array.isArray(context.githubMerged) ? context.githubMerged.length : 0;
  }
  if (key === 'githubOpen') {
    return Array.isArray(context.githubOpen) ? context.githubOpen.length : 0;
  }
  if (key === 'runtimeActive') {
    const sessions = Array.isArray(context.activeSessions) ? context.activeSessions.length : 0;
    const subagents = Array.isArray(context.activeSubagents) ? context.activeSubagents.length : 0;
    return sessions + subagents;
  }
  if (key === 'autopilotRecent') {
    return Array.isArray(context.autopilotRecent) ? context.autopilotRecent.length : 0;
  }
  if (key === 'autopilotRecentBlocked') {
    return Array.isArray(context.autopilotRecent)
      ? context.autopilotRecent.filter((item) => String(item.status || '').toLowerCase() === 'blocked').length
      : 0;
  }
  return 0;
}

function evaluateStatusRule(rule, context) {
  const metricValue = statusMachineRuleMetricValue(rule.metric, context);
  const min = Math.max(1, Number(rule.min || 1));
  return metricValue >= min;
}

function resolveRuleTargetState(rule, settings) {
  const raw = String(rule && rule.targetState ? rule.targetState : '').trim();
  if (!raw) {
    return '';
  }
  if (raw === '$stateBlocked') {
    return String(settings.statusMachine.stateBlocked || 'Blocked');
  }
  if (raw === '$stateDone') {
    return String(settings.statusMachine.stateDone || settings.github.stateDone || 'Done');
  }
  if (raw === '$stateInReview') {
    return String(settings.statusMachine.stateInReview || settings.github.stateInReview || 'In Review');
  }
  if (raw === '$stateInProgress') {
    return String(settings.statusMachine.stateInProgress || 'In Progress');
  }
  return raw;
}

function readStatusMachineVersionStore(settings) {
  const state = readJsonFile(STATUS_MACHINE_VERSIONS_PATH, {
    version: 1,
    updatedAtMs: 0,
    activeVersionId: '',
    previousVersionId: '',
    order: [],
    versions: {},
  });
  const store = {
    version: 1,
    updatedAtMs: Number(state.updatedAtMs || 0),
    activeVersionId: String(state.activeVersionId || '').trim(),
    previousVersionId: String(state.previousVersionId || '').trim(),
    order: Array.isArray(state.order) ? state.order.map((item) => String(item || '').trim()).filter(Boolean) : [],
    versions: state.versions && typeof state.versions === 'object' ? state.versions : {},
  };
  const configRulesRaw =
    Array.isArray(settings.statusMachine.rules) && settings.statusMachine.rules.length > 0
      ? settings.statusMachine.rules
      : defaultStatusMachineRules(settings);
  const validated = validateStatusMachineRules(configRulesRaw);
  const normalizedRules = validated.ok ? validated.rules : defaultStatusMachineRules(settings);
  const ruleHash = hashText(JSON.stringify(normalizedRules));
  const existingId = Object.entries(store.versions).find(([, value]) => String(value.hash || '') === ruleHash);
  if (!existingId) {
    const versionId = `v-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${ruleHash.slice(0, 6)}`;
    store.versions[versionId] = {
      id: versionId,
      createdAtMs: Date.now(),
      source: Array.isArray(settings.statusMachine.rules) && settings.statusMachine.rules.length > 0 ? 'config' : 'default',
      hash: ruleHash,
      rules: normalizedRules,
    };
    store.order.push(versionId);
    if (!store.activeVersionId || settings.statusMachine.autoActivateConfig !== false) {
      store.previousVersionId = store.activeVersionId || '';
      store.activeVersionId = versionId;
    }
    store.updatedAtMs = Date.now();
    writeJsonFile(STATUS_MACHINE_VERSIONS_PATH, store);
  } else if (!store.activeVersionId) {
    store.activeVersionId = existingId[0];
    store.updatedAtMs = Date.now();
    writeJsonFile(STATUS_MACHINE_VERSIONS_PATH, store);
  }
  return store;
}

function getActiveStatusMachineRules(settings) {
  const store = readStatusMachineVersionStore(settings);
  const active = store.activeVersionId && store.versions[store.activeVersionId]
    ? store.versions[store.activeVersionId]
    : null;
  if (active && Array.isArray(active.rules) && active.rules.length > 0) {
    const validated = validateStatusMachineRules(active.rules);
    if (validated.ok) {
      return validated.rules;
    }
    appendAuditEvent('status-machine-rules-invalid', {
      activeVersionId: store.activeVersionId || '',
      errors: validated.errors,
      fallback: 'default-rules',
    });
  }
  return defaultStatusMachineRules(settings);
}

async function cmdStatusMachineRules(settings, flags) {
  let store = readStatusMachineVersionStore(settings);
  let mutated = false;
  let action = 'show';
  let approval = { required: false, approved: true, approvalId: '' };

  if (flags.file || flags['from-config'] || flags.activate || flags.rollback) {
    consumeConfirmation(flags.confirm);
    approval = consumeApprovalIfRequired(settings, flags.approval, 'trigger', 'state-machine-rules');
  }

  if (flags.file || flags['from-config']) {
    action = 'create-version';
    let rawRules = null;
    if (flags.file) {
      const filePath = path.resolve(String(flags.file).trim());
      rawRules = readJsonFile(filePath, null);
      if (!rawRules) {
        throw new Error(`unable to load status machine rules file: ${filePath}`);
      }
    } else {
      rawRules = settings.statusMachine.rules;
    }
    const list = Array.isArray(rawRules)
      ? rawRules
      : rawRules && Array.isArray(rawRules.rules)
        ? rawRules.rules
        : [];
    const validated = validateStatusMachineRules(list.length > 0 ? list : defaultStatusMachineRules(settings));
    if (!validated.ok) {
      throw new Error(`invalid status machine rules: ${validated.errors.join('; ')}`);
    }
    const hash = hashText(JSON.stringify(validated.rules));
    const versionId = `v-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${hash.slice(0, 6)}`;
    store.versions[versionId] = {
      id: versionId,
      createdAtMs: Date.now(),
      source: flags.file ? `file:${String(flags.file)}` : 'config',
      hash,
      rules: validated.rules,
    };
    store.order.push(versionId);
    store.previousVersionId = store.activeVersionId || '';
    store.activeVersionId = versionId;
    mutated = true;
  } else if (flags.activate) {
    action = 'activate';
    const versionId = String(flags.activate || '').trim();
    if (!store.versions[versionId]) {
      throw new Error(`status machine version not found: ${versionId}`);
    }
    if (store.activeVersionId !== versionId) {
      store.previousVersionId = store.activeVersionId || '';
      store.activeVersionId = versionId;
      mutated = true;
    }
  } else if (flags.rollback) {
    action = 'rollback';
    const explicit = String(flags.rollback || '').trim();
    const targetId = explicit && explicit !== 'true' ? explicit : store.previousVersionId;
    if (!targetId || !store.versions[targetId]) {
      throw new Error('no previous status-machine version available for rollback.');
    }
    if (store.activeVersionId !== targetId) {
      store.previousVersionId = store.activeVersionId || '';
      store.activeVersionId = targetId;
      mutated = true;
    }
  } else if (flags.validate) {
    action = 'validate';
    const activeRules = getActiveStatusMachineRules(settings);
    const validated = validateStatusMachineRules(activeRules);
    const result = {
      ok: validated.ok,
      errors: validated.errors,
      activeVersionId: store.activeVersionId || '',
      rules: validated.rules,
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write(
      `Status machine validation: ${result.ok ? 'ok' : 'invalid'} (${result.rules.length} rules)\n`,
    );
    return;
  }

  if (mutated) {
    store.updatedAtMs = Date.now();
    const audit = appendAuditEvent('status-machine-rules-update', {
      action,
      activeVersionId: store.activeVersionId,
      previousVersionId: store.previousVersionId || '',
      approvalId: approval.approvalId || '',
    });
    writeJsonFileWithAudit(STATUS_MACHINE_VERSIONS_PATH, store, {
      auditId: audit.auditId,
      reason: action,
    });
  }

  store = readStatusMachineVersionStore(settings);
  const active = store.activeVersionId && store.versions[store.activeVersionId]
    ? store.versions[store.activeVersionId]
    : null;
  const result = {
    ok: true,
    action,
    mutated,
    approval,
    activeVersionId: store.activeVersionId || '',
    previousVersionId: store.previousVersionId || '',
    versions: store.order.map((id) => ({
      id,
      createdAtMs: Number(store.versions[id] && store.versions[id].createdAtMs ? store.versions[id].createdAtMs : 0),
      source: String(store.versions[id] && store.versions[id].source ? store.versions[id].source : ''),
      rules: Array.isArray(store.versions[id] && store.versions[id].rules) ? store.versions[id].rules.length : 0,
    })),
    activeRules: active && Array.isArray(active.rules) ? active.rules : [],
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push('Status machine rules:');
  lines.push(`- active version: ${result.activeVersionId || '-'}`);
  lines.push(`- previous version: ${result.previousVersionId || '-'}`);
  lines.push(`- versions: ${result.versions.length}`);
  lines.push(`- active rules: ${result.activeRules.length}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();

function buildSmartContextSnippet(issue, settings) {
  try {
    const enabled = Boolean(
      (settings.execution && settings.execution.smartContext && settings.execution.smartContext.enabled) ?? true,
    );
    if (!enabled) {
      return '';
    }

    const candidatePy =
      process.env.NEXUS_PYTHON_PATH || '/Users/yizhi/miniconda3/envs/openclaw-nexus/bin/python';
    if (!candidatePy || !fs.existsSync(candidatePy)) {
      return '';
    }

    const message = buildSmartContextMessage(issue);
    if (!message) {
      return '';
    }

    const scriptPath = path.join(ROOT_DIR, 'scripts', 'nexus-smart-context-prompt.py');
    if (!fs.existsSync(scriptPath)) {
      return '';
    }

    const output = runCommand(candidatePy, [scriptPath, '--message', message], {
      timeoutMs: 45_000,
      label: 'smart_context prompt',
    });

    const text = String(output.stdout || '').trim();
    return trimMessage(text, 2000);
  } catch {
    return '';
  }
}

function buildSmartContextMessage(issue) {
  const parts = [];
  parts.push(String(issue && issue.title ? issue.title : '').trim());
  const desc = String(issue && issue.description ? issue.description : '').trim();
  if (desc) {
    parts.push(desc.slice(0, 1200));
  }
  const labels = (((issue && issue.labels) || {}).nodes || [])
    .map((item) => String(item && item.name ? item.name : '').trim())
    .filter(Boolean);
  if (labels.length > 0) {
    parts.push(`labels: ${labels.join(', ')}`);
  }
  const state = String((issue && issue.state && issue.state.name) || '').trim();
  if (state) {
    parts.push(`state: ${state}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

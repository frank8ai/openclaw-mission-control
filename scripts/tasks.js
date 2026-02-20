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
  control: {
    confirmTtlMinutes: 10,
    killWhitelist: [],
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
    githubPath: process.env.CONTROL_CENTER_GITHUB_PATH || '/github/pr',
    token: process.env.CONTROL_CENTER_INGEST_TOKEN || '',
    maxBodyBytes: 1024 * 1024,
  },
  reminders: {
    enabled: true,
    dueSoonDays: 7,
    dueSoonCron: '0 10 * * *',
    cycleCron: '30 9 * * 1',
    channel: process.env.CONTROL_CENTER_REMINDER_CHANNEL || '',
    target: process.env.CONTROL_CENTER_REMINDER_TARGET || '',
    maxSendLength: 3000,
  },
  github: {
    stateInReview: 'In Review',
    stateDone: 'Done',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    token: process.env.GITHUB_TOKEN || '',
    repos: [],
    pollIntervalMinutes: 15,
    lookbackHours: 72,
  },
  todoist: {
    enabled: true,
    apiToken: process.env.TODOIST_API_TOKEN || '',
    syncToLinear: true,
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
};

const HELP_TEXT = `OpenClaw Control Center CLI\n\nUsage:\n  npm run tasks -- <command> [options]\n  node scripts/tasks.js <command> [options]\n\nRead commands:\n  now                          Quick 30-second answer: what is happening + what next\n  jobs                         List cron jobs and status\n  agents                       List subagents (label/status/start/elapsed)\n  sessions                     List active sessions summary\n  report [--json] [--send]     Build health report (Top 5 anomalies + manual actions)\n  watchdog [--auto-linear]     Detect incidents and optionally auto-create Linear issues\n  remind [due|cycle|all]       Send reminders from Linear (due soon/current cycle)\n\nIntegrations:\n  triage --title ...           Create a Triage issue quickly (supports --source/--labels)\n  ingest-server                Start webhook server for external intake + GitHub PR sync\n  github-hooks [--repo PATH]   Install git hooks to enforce/add Linear ID in branch/commit\n  github-sync                  Poll GitHub PRs and sync Linear states (In Review/Done)\n  todoist-sync                 Sync Todoist tasks into Linear Triage\n  calendar-sync                Sync Google Calendar events snapshot (browser logged-in tab)\n\nWrite commands (require one-time confirmation):\n  confirm                      Generate one-time confirmation code\n  run <jobId> --confirm CODE   Run cron job now\n  enable <jobId> --confirm CODE\n  disable <jobId> --confirm CODE\n  kill <subagentId> --confirm CODE\n\nScheduling:\n  schedule [--apply] [--channel CH] [--target TGT]\n    Prepare (or install) crontab block:\n    - 09:00 + 18:00 report\n    - every 5 minutes watchdog\n    - reminders (due soon + cycle planning)\n\nExamples:\n  npm run tasks -- triage --title \"Fix Discord manual model switch\" --source discord\n  npm run tasks -- github-sync\n  npm run tasks -- todoist-sync\n  npm run tasks -- calendar-sync\n`;

async function main() {
  const { command, flags } = parseArgv(process.argv.slice(2));
  const settings = loadSettings();

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
      case 'watchdog':
        await cmdWatchdog(settings, flags);
        return;
      case 'triage':
        await cmdTriage(settings, flags);
        return;
      case 'remind':
      case 'reminder':
        await cmdRemind(settings, flags);
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
      case 'calendar-sync':
      case 'gcal-sync':
      case 'calendar':
        await cmdCalendarSync(settings, flags);
        return;
      case 'confirm':
        await cmdConfirm(settings, flags);
        return;
      case 'run':
        await cmdCronControl('run', flags);
        return;
      case 'enable':
        await cmdCronControl('enable', flags);
        return;
      case 'disable':
        await cmdCronControl('disable', flags);
        return;
      case 'kill':
        await cmdKill(settings, flags);
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
    path.join(path.resolve(ROOT_DIR, '..'), '.env'),
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
      lines.push(`- ${item.jobId} (${item.reason}) -> ${issueText}`);
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

async function cmdCronControl(action, flags) {
  const id = String(flags._[0] || '').trim();
  if (!id) {
    throw new Error(`tasks ${action} requires a cron job id.`);
  }

  consumeConfirmation(flags.confirm);

  const args = ['cron', action, id];
  const output = runCommand('openclaw', args);

  process.stdout.write(`${output.stdout || output.stderr || 'ok'}\n`);
}

async function cmdKill(settings, flags) {
  const subagentId = String(flags._[0] || '').trim();
  if (!subagentId) {
    throw new Error('tasks kill requires a subagent id.');
  }

  consumeConfirmation(flags.confirm);

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

  process.stdout.write(`Sent SIGTERM to subagent ${subagentId} (pid ${target.pid}).\n`);
}

async function cmdSchedule(settings, flags) {
  const timezone = String(flags.tz || settings.timezone || 'Asia/Shanghai').trim();
  const apply = Boolean(flags.apply);

  const channel = String(flags.channel || settings.report.channel || '').trim();
  const target = String(flags.target || settings.report.target || '').trim();
  const reminderChannel = String(
    flags['reminder-channel'] || settings.reminders.channel || channel || '',
  ).trim();
  const reminderTarget = String(
    flags['reminder-target'] || settings.reminders.target || target || '',
  ).trim();
  const withReminders =
    !Boolean(flags['without-reminders']) && Boolean(settings.reminders.enabled !== false);
  const nodeBin = process.execPath;
  const scriptPath = path.join(ROOT_DIR, 'scripts', 'tasks.js');
  const reportLog = path.join(DATA_DIR, 'report-cron.log');
  const watchdogLog = path.join(DATA_DIR, 'watchdog-cron.log');
  const reminderDueLog = path.join(DATA_DIR, 'reminder-due-cron.log');
  const reminderCycleLog = path.join(DATA_DIR, 'reminder-cycle-cron.log');
  const githubSyncLog = path.join(DATA_DIR, 'github-sync-cron.log');
  const todoistSyncLog = path.join(DATA_DIR, 'todoist-sync-cron.log');
  const calendarSyncLog = path.join(DATA_DIR, 'calendar-sync-cron.log');
  const watchdogInterval = Number(flags['watchdog-interval'] || 5);
  const githubPollMinutes = Number(flags['github-poll-minutes'] || settings.github.pollIntervalMinutes || 15);
  const todoistPollMinutes = Number(flags['todoist-poll-minutes'] || 30);
  const calendarPollMinutes = Number(flags['calendar-poll-minutes'] || 60);
  const githubExpr = cronEveryMinutesExpr(githubPollMinutes);
  const todoistExpr = cronEveryMinutesExpr(todoistPollMinutes);
  const calendarExpr = cronEveryMinutesExpr(calendarPollMinutes);

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
  const remindDueParts = [nodeBin, scriptPath, 'remind', 'due'];
  const remindCycleParts = [nodeBin, scriptPath, 'remind', 'cycle'];
  const dueSoonDays = Number(flags.days || settings.reminders.dueSoonDays || 7);
  if (dueSoonDays > 0) {
    remindDueParts.push('--days', String(dueSoonDays));
  }
  if (reminderChannel && reminderTarget) {
    remindDueParts.push('--send', '--channel', reminderChannel, '--target', reminderTarget);
    remindCycleParts.push('--send', '--channel', reminderChannel, '--target', reminderTarget);
  }

  const blockLines = [
    '# OPENCLAW_CONTROL_CENTER_BEGIN',
    `CRON_TZ=${timezone}`,
    `0 9,18 * * * cd ${shellQuote(ROOT_DIR)} && ${joinShell(reportParts)} >> ${shellQuote(reportLog)} 2>&1`,
    `*/${watchdogInterval} * * * * cd ${shellQuote(ROOT_DIR)} && ${joinShell(watchdogParts)} >> ${shellQuote(watchdogLog)} 2>&1`,
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
    ...(withReminders
      ? [
          `${settings.reminders.dueSoonCron || '0 10 * * *'} cd ${shellQuote(ROOT_DIR)} && ${joinShell(remindDueParts)} >> ${shellQuote(reminderDueLog)} 2>&1`,
          `${settings.reminders.cycleCron || '30 9 * * 1'} cd ${shellQuote(ROOT_DIR)} && ${joinShell(remindCycleParts)} >> ${shellQuote(reminderCycleLog)} 2>&1`,
        ]
      : []),
    '# OPENCLAW_CONTROL_CENTER_END',
  ];

  const block = blockLines.join('\n');

  if (!apply) {
    process.stdout.write('Proposed crontab block:\n');
    process.stdout.write(`${block}\n`);
    process.stdout.write('\nRun with --apply to install this block into your user crontab.\n');
    return;
  }

  const current = readCrontab();
  const next = replaceCrontabBlock(current, block);
  writeCrontab(next);

  process.stdout.write('Crontab updated with OpenClaw Control Center schedule.\n');
}

async function cmdTriage(settings, flags) {
  const rawText = String(flags.text || flags._.join(' ') || '').trim();
  const title = String(flags.title || '').trim();
  const description = String(flags.description || flags.desc || '').trim();
  const source = String(flags.source || 'manual').trim();
  const author = String(flags.author || '').trim();
  const sourceUrl = String(flags.url || '').trim();
  const state = String(flags.state || 'Triage').trim();
  const labels = normalizeLabelNames(flags.labels || flags.label || '');
  const dueDate = String(flags['due-date'] || '').trim();
  const priority = Number(flags.priority || 3);

  const issue = await createTriageIssueFromInput(
    {
      title,
      rawText,
      description,
      source,
      author,
      sourceUrl,
      state,
      labels,
      dueDate,
      priority: Number.isFinite(priority) ? priority : 3,
    },
    settings,
  );

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(issue, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Triage issue created:');
  lines.push(`- ${issue.identifier}: ${issue.title}`);
  lines.push(`- state: ${issue.stateName || '-'}`);
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

  const apiKey = String(settings.linear.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is required for remind.');
  }

  const teamId = settings.linear.teamId || (await resolveLinearTeamId(apiKey, settings.linear.teamKey));
  if (!teamId) {
    throw new Error('Unable to resolve Linear team id for reminder.');
  }

  const dueDays = Number(flags.days || settings.reminders.dueSoonDays || 7);
  const data = {
    generatedAtMs: Date.now(),
    mode,
    dueDays,
    due: [],
    cycle: [],
  };

  if (mode === 'all' || mode === 'due') {
    data.due = await fetchDueSoonIssues(apiKey, teamId, dueDays);
  }
  if (mode === 'all' || mode === 'cycle') {
    data.cycle = await fetchCurrentCycleIssues(apiKey, teamId);
  }

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

async function cmdIngestServer(settings, flags) {
  const host = String(flags.host || settings.ingest.host || '127.0.0.1').trim();
  const port = Number(flags.port || settings.ingest.port || 8788);
  const triagePath = String(flags.path || settings.ingest.triagePath || '/triage').trim();
  const githubPath = String(flags['github-path'] || settings.ingest.githubPath || '/github/pr').trim();
  const token = String(flags.token || settings.ingest.token || '').trim();
  const maxBodyBytes = Number(flags['max-body-bytes'] || settings.ingest.maxBodyBytes || 1024 * 1024);

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`invalid ingest port: ${String(port)}`);
  }

  const server = http.createServer(async (req, res) => {
    const requestPath = new URL(String(req.url || '/'), `http://${host}`).pathname;

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
        const issue = await createTriageIssueFromInput(
          {
            title: String(body.title || '').trim(),
            rawText: String(body.text || body.message || '').trim(),
            description: String(body.description || '').trim(),
            source: String(body.source || 'webhook').trim(),
            author: String(body.author || '').trim(),
            sourceUrl: String(body.url || '').trim(),
            state: String(body.state || 'Triage').trim(),
            labels: normalizeLabelNames(body.labels || ''),
            dueDate: String(body.dueDate || '').trim(),
            priority: Number(body.priority || 3),
          },
          settings,
        );

        sendJson(res, 200, { ok: true, issue });
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
        const result = await handleGithubPullRequestEvent(event, body, settings);
        sendJson(res, 200, { ok: true, event, result });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      process.stdout.write(
        `Ingest server listening on http://${host}:${port}\n` +
          `- triage path: ${triagePath}\n` +
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
  const token = String(flags.token || settings.github.token || '').trim();
  if (!token) {
    throw new Error('GitHub token missing. Set GITHUB_TOKEN or ~/.openclaw/credentials/github-token.txt');
  }

  const lookbackHours = Number(flags['lookback-hours'] || settings.github.lookbackHours || 72);
  const repos = resolveGithubRepos(settings, flags);
  if (repos.length === 0) {
    throw new Error('No GitHub repositories configured for sync.');
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

    const issue = await createTriageIssueFromInput(
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
        state: String(settings.todoist.defaultState || 'Triage'),
        labels: [String(settings.todoist.label || 'todoist')],
        dueDate: task.due && task.due.date ? String(task.due.date) : '',
        priority: mapTodoistPriorityToLinear(task.priority),
      },
      settings,
    );

    items[key] = {
      todoistId: key,
      content: task.content || '',
      updatedAt: task.updated_at || '',
      syncedAtMs: Date.now(),
      linearIssueId: issue.id,
      linearIdentifier: issue.identifier,
      linearUrl: issue.url || '',
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
      `${JSON.stringify({ ok: true, totalTasks: Array.isArray(tasks) ? tasks.length : 0, processed: selectedTasks.length, created, skipped }, null, 2)}\n`,
    );
    return;
  }

  const lines = [];
  lines.push('Todoist sync result:');
  lines.push(`- fetched: ${Array.isArray(tasks) ? tasks.length : 0}`);
  lines.push(`- processed: ${selectedTasks.length}`);
  lines.push(`- created Linear issues: ${created.length}`);
  lines.push(`- skipped: ${skipped.length}`);
  for (const item of created.slice(0, 10)) {
    lines.push(`- ${item.todoistId} -> ${item.linearIdentifier}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdCalendarSync(settings, flags) {
  if (settings.calendar.enabled === false) {
    throw new Error('calendar integration disabled in config.');
  }

  const profile = String(flags.profile || settings.calendar.browserProfile || 'openclaw').trim();
  const tabHint = String(flags.hint || settings.calendar.tabHint || 'calendar.google.com').trim();
  const tabs = listBrowserTabs(profile);
  const tab = tabs.find((item) => String(item.url || '').includes(tabHint));
  if (!tab) {
    throw new Error(`Google Calendar tab not found in profile=${profile}.`);
  }

  const result = openclawBrowserEvaluate(
    profile,
    tab.targetId,
    "() => Array.from(document.querySelectorAll('[data-eventid]')).map((el) => ({id: el.getAttribute('data-eventid') || '', text: (el.textContent||'').replace(/\\s+/g,' ').trim(), className: el.className || ''})).filter((x) => x.id && x.text).slice(0, 500)",
  );
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
  if (toLinear) {
    const mapping = readJsonFile(CALENDAR_SYNC_PATH.replace('.json', '-linear.json'), { items: {} });
    const items = mapping.items || {};
    for (const event of events.slice(0, 100)) {
      const key = event.id;
      if (items[key] && items[key].linearIssueId) {
        continue;
      }
      const issue = await createTriageIssueFromInput(
        {
          title: `[Calendar] ${trimMessage(event.text, 120)}`,
          description: `Google Calendar event snapshot\nid: ${event.id}\nsource: ${tab.url}`,
          source: 'google-calendar',
          labels: [String(settings.calendar.label || 'calendar')],
          state: String(settings.calendar.defaultState || 'Triage'),
          priority: 3,
        },
        settings,
      );
      items[key] = {
        id: key,
        text: event.text,
        linearIssueId: issue.id,
        linearIdentifier: issue.identifier,
        syncedAtMs: Date.now(),
      };
      created.push({ id: key, linearIdentifier: issue.identifier });
    }
    writeJsonFile(CALENDAR_SYNC_PATH.replace('.json', '-linear.json'), { updatedAtMs: Date.now(), items });
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, snapshot, created }, null, 2)}\n`);
    return;
  }

  const lines = [];
  lines.push('Calendar sync result:');
  lines.push(`- profile: ${profile}`);
  lines.push(`- tab: ${tab.url}`);
  lines.push(`- events captured: ${events.length}`);
  lines.push(`- toLinear created: ${created.length}`);
  for (const event of events.slice(0, 8)) {
    lines.push(`- ${trimMessage(event.text, 120)}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
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

  const teamId = settings.linear.teamId || (await resolveLinearTeamId(apiKey, settings.linear.teamKey));
  if (!teamId) {
    throw new Error('Unable to resolve Linear team id for triage.');
  }

  const stateName = String(input.state || 'Triage').trim();
  const stateId = await resolveLinearStateId(apiKey, teamId, stateName);
  if (!stateId) {
    throw new Error(`Linear state not found: ${stateName}`);
  }

  const title = buildTriageTitle(input);
  if (!title) {
    throw new Error('triage requires --title or --text.');
  }

  const description = buildTriageDescription(input);
  const labelIds = await resolveLinearLabelIds(
    apiKey,
    teamId,
    Array.isArray(input.labels) ? input.labels : [],
    true,
  );

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
        priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 3,
        labelIds: labelIds.length > 0 ? labelIds : undefined,
        projectId: settings.linear.projectId || undefined,
        dueDate: input.dueDate || undefined,
      },
    },
  );

  const issue = payload && payload.issueCreate ? payload.issueCreate.issue : null;
  if (!issue) {
    throw new Error('Linear issueCreate returned no issue.');
  }

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    stateName: issue.state ? issue.state.name : '',
    labels: (((issue.labels || {}).nodes || []).map((item) => item.name)).filter(Boolean),
  };
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

  lines.push('## Next Actions');
  lines.push('1. Pull one Blocked item into owner discussion and unblock within 24h.');
  lines.push('2. Close or re-scope stale In Progress items before adding new scope.');

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
    throw new Error('LINEAR_API_KEY is required for GitHub->Linear transitions.');
  }

  const issue = await resolveLinearIssueByIdentifier(apiKey, identifier, settings.linear.teamKey);
  if (!issue) {
    return { identifier, status: 'not_found' };
  }

  const currentState = issue.state ? String(issue.state.name || '') : '';
  if (currentState.trim().toLowerCase() === String(targetStateName || '').trim().toLowerCase()) {
    return { identifier: issue.identifier, status: 'unchanged', state: currentState, url: issue.url };
  }

  const stateId = await resolveLinearStateId(apiKey, issue.team.id, targetStateName);
  if (!stateId) {
    return { identifier: issue.identifier, status: 'state_not_found', targetStateName };
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
    identifier: moved ? moved.identifier : issue.identifier,
    status: moved ? 'updated' : 'unknown',
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

async function handleGithubPullRequestEvent(eventName, payload, settings) {
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
  for (const identifier of identifiers) {
    const result = await transitionIssueByIdentifier(identifier, targetStateName, settings);
    updates.push(result);
  }

  return {
    handled: true,
    action,
    targetStateName,
    identifiers,
    updates,
  };
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
MSG_FILE="$1"
if [ -z "\${MSG_FILE:-}" ] || [ ! -f "$MSG_FILE" ]; then
  exit 0
fi
BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ -z "$BRANCH" ]; then
  exit 0
fi
ISSUE="$(printf '%s' "$BRANCH" | grep -Eo '[A-Z][A-Z0-9]+-[0-9]+' | head -n1 || true)"
if [ -z "$ISSUE" ]; then
  exit 0
fi
if grep -Eq "\\b$ISSUE\\b" "$MSG_FILE"; then
  exit 0
fi
TMP_FILE="$(mktemp)"
{
  IFS= read -r FIRST_LINE || true
  if [ -n "$FIRST_LINE" ]; then
    printf '%s %s\\n' "$ISSUE" "$FIRST_LINE"
  else
    printf '%s\\n' "$ISSUE"
  fi
  cat
} < "$MSG_FILE" > "$TMP_FILE"
mv "$TMP_FILE" "$MSG_FILE"
`;

  const commitScript = `#!/bin/sh
set -eu
MSG_FILE="$1"
if [ -z "\${MSG_FILE:-}" ] || [ ! -f "$MSG_FILE" ]; then
  exit 0
fi
BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
case "$BRANCH" in
  ""|main|master)
    exit 0
    ;;
esac
BRANCH_ISSUE="$(printf '%s' "$BRANCH" | grep -Eo '\\b${teamKey}-[0-9]+\\b' | head -n1 || true)"
if [ -z "$BRANCH_ISSUE" ]; then
  BRANCH_ISSUE="$(printf '%s' "$BRANCH" | grep -Eo '\\b[A-Z][A-Z0-9]+-[0-9]+\\b' | head -n1 || true)"
fi
if [ -z "$BRANCH_ISSUE" ]; then
  echo 'ERROR: branch name must include Linear ID (e.g. feature/${teamKey}-123-short-title).' >&2
  exit 1
fi
if ! grep -Eq "\\b[A-Z][A-Z0-9]+-[0-9]+\\b" "$MSG_FILE"; then
  echo "ERROR: commit message must include Linear ID (expected $BRANCH_ISSUE)." >&2
  exit 1
fi
if ! grep -Eq "\\b$BRANCH_ISSUE\\b" "$MSG_FILE"; then
  echo "ERROR: commit message should contain branch Linear ID: $BRANCH_ISSUE" >&2
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
    const key = `${jobId}:${anomaly.reason}`;
    const summary = anomaly.title;

    candidates.push({
      key,
      reason: anomaly.reason,
      summary,
      anomaly,
      job,
      runs,
      description: renderIncidentDescription(job, anomaly, runs, settings),
    });
  }

  return candidates;
}

function renderIncidentDescription(job, anomaly, runs, settings) {
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
  lines.push('## Suggested fix steps');
  lines.push(`1. Reproduce quickly: openclaw cron run ${job.id}`);
  lines.push('2. Check script/task timeout behavior and external dependencies.');
  lines.push('3. Apply fix and watch next 2 scheduled runs.');

  return lines.join('\n');
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

  const title = `[ops][cron] ${candidate.job.name || candidate.job.id} - ${candidate.reason}`;
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
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

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

async function todoistApiRequest(apiToken, pathSuffix) {
  const suffix = String(pathSuffix || '').startsWith('/') ? String(pathSuffix) : `/${String(pathSuffix || '')}`;
  const url = `https://api.todoist.com/api/v1${suffix}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
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
    const detail = body && body.error ? body.error : trimMessage(raw || `HTTP ${response.status}`, 240);
    throw new Error(`Todoist API ${response.status}: ${detail}`);
  }
  return body;
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

function runOpenclawJson(args) {
  const { stdout, stderr } = runCommand('openclaw', args);
  const payload = `${stdout || ''}\n${stderr || ''}`.trim();
  return extractJson(payload);
}

function runCommand(bin, args) {
  const result = spawnSync(bin, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${bin} ${args.join(' ')} failed with code ${result.status}${detail ? `: ${detail}` : ''}`);
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
    const candidate = trimmed.slice(i);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new Error(`Failed to parse JSON from output:\n${trimmed.slice(0, 400)}`);
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

main();

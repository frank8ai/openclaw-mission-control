#!/usr/bin/env node

'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
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
    teamKey: process.env.LINEAR_TEAM_KEY || 'OPS',
    teamId: process.env.LINEAR_TEAM_ID || '',
    projectId: process.env.LINEAR_PROJECT_ID || '',
    apiKey: process.env.LINEAR_API_KEY || '',
  },
};

const HELP_TEXT = `OpenClaw Control Center CLI\n\nUsage:\n  npm run tasks -- <command> [options]\n  node scripts/tasks.js <command> [options]\n\nRead commands:\n  now                          Quick 30-second answer: what is happening + what next\n  jobs                         List cron jobs and status\n  agents                       List subagents (label/status/start/elapsed)\n  sessions                     List active sessions summary\n  report [--json] [--send]     Build health report (Top 5 anomalies + manual actions)\n  watchdog [--auto-linear]     Detect incidents and optionally auto-create Linear issues\n\nWrite commands (require one-time confirmation):\n  confirm                      Generate one-time confirmation code\n  run <jobId> --confirm CODE   Run cron job now\n  enable <jobId> --confirm CODE\n  disable <jobId> --confirm CODE\n  kill <subagentId> --confirm CODE\n\nScheduling:\n  schedule [--apply] [--channel CH] [--target TGT]\n    Prepare (or install) crontab block:\n    - 09:00 + 18:00 report\n    - every 5 minutes watchdog\n\nExamples:\n  npm run tasks -- report\n  npm run tasks -- report --send --channel discord --target channel:123\n  npm run tasks -- watchdog --auto-linear\n  npm run tasks -- confirm\n  npm run tasks -- disable 10a67acd-... --confirm "CONFIRM X3H4QK"\n`;

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

  if (process.env.CONTROL_CENTER_KILL_WHITELIST) {
    merged.control.killWhitelist = process.env.CONTROL_CENTER_KILL_WHITELIST
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return merged;
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
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ subagents }, null, 2)}\n`);
    return;
  }

  if (subagents.length === 0) {
    process.stdout.write('No subagents found in ~/.openclaw/subagents/runs.json\n');
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
  const nodeBin = process.execPath;
  const scriptPath = path.join(ROOT_DIR, 'scripts', 'tasks.js');
  const reportLog = path.join(DATA_DIR, 'report-cron.log');
  const watchdogLog = path.join(DATA_DIR, 'watchdog-cron.log');
  const watchdogInterval = Number(flags['watchdog-interval'] || 5);

  ensureDir(DATA_DIR);

  const reportParts = [nodeBin, scriptPath, 'report'];
  if (channel && target) {
    reportParts.push('--send', '--channel', channel, '--target', target);
  }

  const watchdogParts = [nodeBin, scriptPath, 'watchdog', '--auto-linear'];

  const blockLines = [
    '# OPENCLAW_CONTROL_CENTER_BEGIN',
    `CRON_TZ=${timezone}`,
    `0 9,18 * * * cd ${shellQuote(ROOT_DIR)} && ${joinShell(reportParts)} >> ${shellQuote(reportLog)} 2>&1`,
    `*/${watchdogInterval} * * * * cd ${shellQuote(ROOT_DIR)} && ${joinShell(watchdogParts)} >> ${shellQuote(watchdogLog)} 2>&1`,
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

  if (!response.ok) {
    throw new Error(`Linear API HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body.errors && body.errors.length > 0) {
    throw new Error(`Linear API error: ${body.errors.map((item) => item.message).join('; ')}`);
  }

  return body.data;
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

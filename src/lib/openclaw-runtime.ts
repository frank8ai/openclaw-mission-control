import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RuntimeTaskItem, RuntimeTaskSummary } from '@/lib/mission-control-types';

type RuntimeSnapshot = {
  generatedAt: string;
  tasks: RuntimeTaskItem[];
  summary: RuntimeTaskSummary;
  source: string;
};

type CronJob = {
  id: string;
  name?: string;
  enabled?: boolean;
  state?: {
    lastStatus?: string;
    lastError?: string;
    lastRunAtMs?: number;
    consecutiveErrors?: number;
  };
};

type SessionItem = {
  agentId: string;
  key: string;
  kind: string;
  updatedAt: number;
  ageMs: number;
  sessionId: string;
  abortedLastRun: boolean;
  model: string;
  preview: string;
};

type SubagentRun = {
  id: string;
  label: string;
  status: string;
  isActive: boolean;
  startedAtMs: number;
  durationMs: number;
};

type JsonlMessageRecord = {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

const OPENCLAW_HOME =
  process.env.OPENCLAW_STATE_DIR ?? path.join(os.homedir(), '.openclaw');

const ACTIVE_SESSION_WINDOW_MS = 6 * 60 * 60 * 1000;
const SESSION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_TASKS = 12;
const MAX_SUBAGENT_TASKS = 8;
const MAX_CRON_ISSUE_TASKS = 8;
const MAX_SESSION_INTENT_READS = 18;
const JSONL_TAIL_BYTES = 256 * 1024;
const RUNTIME_CACHE_TTL_MS = 4000;
const OPENCLAW_CLI_TIMEOUT_MS = 2500;

let runtimeCache: { expiresAtMs: number; snapshot: RuntimeSnapshot } | null = null;

export async function getOpenClawRuntimeSnapshot(): Promise<RuntimeSnapshot> {
  const nowMs = Date.now();
  if (runtimeCache && runtimeCache.expiresAtMs > nowMs) {
    return runtimeCache.snapshot;
  }

  const cronJobs = loadCronJobs();
  const sessions = loadSessions(nowMs);
  const subagents = loadSubagents(nowMs);

  const sessionTasks = sessions
    .filter((session) => session.ageMs <= ACTIVE_SESSION_WINDOW_MS)
    .sort((left, right) => left.ageMs - right.ageMs)
    .slice(0, MAX_SESSION_TASKS)
    .map<RuntimeTaskItem>((session) => {
      const type: RuntimeTaskItem['type'] = session.agentId === 'main' ? 'session' : 'subagent';
      const title = `[${session.agentId}] ${session.preview || session.key}`;
      const detail = `${session.model || '-'} · ${session.kind} · ${session.key}`;
      return {
        id: `session:${session.agentId}:${session.key}`,
        type,
        status: session.abortedLastRun ? 'warning' : 'running',
        title,
        detail,
        ageMs: session.ageMs,
        updatedAt: toIso(session.updatedAt),
      };
    });

  const subagentTasks = subagents
    .filter((item) => item.isActive)
    .slice(0, MAX_SUBAGENT_TASKS)
    .map<RuntimeTaskItem>((item) => ({
      id: `subagent:${item.id}`,
      type: 'subagent',
      status: 'running',
      title: item.label,
      detail: `status=${item.status}`,
      ageMs: item.durationMs,
      updatedAt: toIso(item.startedAtMs),
    }));

  const cronIssueTasks = cronJobs
    .filter((job) => {
      const state = job.state ?? {};
      const lastStatus = String(state.lastStatus ?? '').toLowerCase();
      const consecutiveErrors = Number(state.consecutiveErrors ?? 0);
      const lastError = String(state.lastError ?? '');
      return (
        lastStatus === 'error' ||
        lastStatus === 'failed' ||
        consecutiveErrors > 0 ||
        /timed out|timeout/i.test(lastError)
      );
    })
    .slice(0, MAX_CRON_ISSUE_TASKS)
    .map<RuntimeTaskItem>((job) => {
      const state = job.state ?? {};
      const lastError = String(state.lastError ?? '').trim();
      const lastStatus = String(state.lastStatus ?? '-');
      const consecutiveErrors = Number(state.consecutiveErrors ?? 0);

      return {
        id: `cron:${job.id}`,
        type: 'cron',
        status: 'warning',
        title: `${job.name ?? job.id}`,
        detail: `${lastStatus} · consecutiveErrors=${consecutiveErrors}${
          lastError ? ` · ${singleLine(lastError).slice(0, 120)}` : ''
        }`,
        ageMs:
          Number(state.lastRunAtMs) > 0
            ? Math.max(0, nowMs - Number(state.lastRunAtMs))
            : undefined,
        updatedAt: toIso(state.lastRunAtMs),
      };
    });

  const tasks = [...sessionTasks, ...subagentTasks, ...cronIssueTasks].sort((left, right) => {
    const statusRank = (value: RuntimeTaskItem['status']) =>
      value === 'running' ? 0 : value === 'warning' ? 1 : 2;
    if (statusRank(left.status) !== statusRank(right.status)) {
      return statusRank(left.status) - statusRank(right.status);
    }
    return Number(left.ageMs ?? Number.MAX_SAFE_INTEGER) - Number(right.ageMs ?? Number.MAX_SAFE_INTEGER);
  });

  const runningSessionTasks = sessionTasks.filter((item) => item.status === 'running');
  const workerSessions = sessionTasks.filter((item) => item.type === 'subagent');
  const summary: RuntimeTaskSummary = {
    active:
      runningSessionTasks.length +
      subagentTasks.filter((item) => item.status === 'running').length,
    warnings: tasks.filter((item) => item.status === 'warning').length,
    sessions: sessionTasks.length - workerSessions.length,
    subagents: workerSessions.length + subagentTasks.length,
    cronIssues: cronIssueTasks.length,
  };

  const snapshot: RuntimeSnapshot = {
    generatedAt: new Date(nowMs).toISOString(),
    tasks,
    summary,
    source: 'openclaw-all-agents+state-files',
  };

  runtimeCache = {
    expiresAtMs: nowMs + RUNTIME_CACHE_TTL_MS,
    snapshot,
  };

  return snapshot;
}

function loadCronJobs(): CronJob[] {
  const file = path.join(OPENCLAW_HOME, 'cron', 'jobs.json');
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as { jobs?: unknown };
    if (Array.isArray(payload.jobs)) {
      return payload.jobs as CronJob[];
    }
  } catch {
    // continue
  }

  try {
    const payload = runOpenClawJson(['cron', 'list', '--all', '--json']) as {
      jobs?: unknown;
    };
    if (Array.isArray(payload.jobs)) {
      return payload.jobs as CronJob[];
    }
  } catch {
    // ignore
  }
  return [];
}

function loadSessions(nowMs: number): SessionItem[] {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  if (!fs.existsSync(agentsDir)) {
    return [];
  }

  const sessions: SessionItem[] = [];

  for (const agentId of safeReadDir(agentsDir)) {
    const sessionsPath = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    if (!fs.existsSync(sessionsPath)) {
      continue;
    }

    let payload: Record<string, Record<string, unknown>>;
    try {
      payload = JSON.parse(fs.readFileSync(sessionsPath, 'utf8')) as Record<
        string,
        Record<string, unknown>
      >;
    } catch {
      continue;
    }

    for (const [key, value] of Object.entries(payload)) {
      if (!value || typeof value !== 'object') {
        continue;
      }

      // `:run:` usually duplicates parent cron session view.
      if (key.includes(':run:')) {
        continue;
      }

      const updatedAt = toNumber(value.updatedAt, 0);
      if (updatedAt <= 0) {
        continue;
      }
      const sessionId = toString(value.sessionId, '');
      const ageMs = Math.max(0, nowMs - updatedAt);
      if (ageMs > SESSION_LOOKBACK_MS) {
        continue;
      }

      sessions.push({
        agentId,
        key,
        kind: toString(value.kind, toString(value.chatType, 'session')),
        updatedAt,
        ageMs,
        sessionId,
        abortedLastRun: Boolean(value.abortedLastRun),
        model: toString(value.model, toString(value.modelOverride, '')),
        preview: key,
      });
    }
  }

  const deduped = new Map<string, SessionItem>();
  for (const item of sessions) {
    const id = item.sessionId || item.key;
    const dedupeKey = `${item.agentId}:${id}`;
    const prev = deduped.get(dedupeKey);
    if (!prev || item.updatedAt > prev.updatedAt) {
      deduped.set(dedupeKey, item);
    }
  }

  const ordered = [...deduped.values()].sort(
    (left, right) => left.ageMs - right.ageMs || right.updatedAt - left.updatedAt,
  );

  for (const item of ordered
    .filter((entry) => entry.sessionId && entry.ageMs <= ACTIVE_SESSION_WINDOW_MS)
    .slice(0, MAX_SESSION_INTENT_READS)) {
    item.preview = extractSessionIntent(item.agentId, item.sessionId, item.key);
  }

  return ordered;
}

function loadSubagents(nowMs: number): SubagentRun[] {
  const file = path.join(OPENCLAW_HOME, 'subagents', 'runs.json');
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as { runs?: unknown };
    if (Array.isArray(payload.runs)) {
      return payload.runs
        .map((item, index) => normalizeSubagent(item, `subagent-${index + 1}`, nowMs))
        .filter((item): item is SubagentRun => item !== null);
    }
    if (payload.runs && typeof payload.runs === 'object') {
      return Object.entries(payload.runs as Record<string, unknown>)
        .map(([id, item]) => normalizeSubagent(item, id, nowMs))
        .filter((item): item is SubagentRun => item !== null);
    }
  } catch {
    // ignore
  }
  return [];
}

function normalizeSubagent(value: unknown, id: string, nowMs: number): SubagentRun | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const startedAtMs = firstNumber(
    record.startedAtMs,
    record.startAtMs,
    record.createdAtMs,
    record.startedAt,
    record.startAt,
    record.createdAt,
  );
  const endedAtMs = firstNumber(record.endedAtMs, record.finishedAtMs, record.stoppedAtMs);
  const rawStatus = toString(record.status, toString(record.state, '')).toLowerCase();
  const activeByStatus = ['running', 'active', 'queued', 'pending'].includes(rawStatus);
  const isActive = activeByStatus || (!endedAtMs && startedAtMs > 0);
  const durationMs = firstNumber(
    record.durationMs,
    record.elapsedMs,
    isActive && startedAtMs > 0 ? nowMs - startedAtMs : 0,
  );

  return {
    id,
    label: toString(record.label, toString(record.name, id)),
    status: rawStatus || (isActive ? 'running' : 'finished'),
    isActive,
    startedAtMs,
    durationMs,
  };
}

function extractSessionIntent(agentId: string, sessionId: string, fallback: string): string {
  if (!sessionId) {
    return fallback;
  }

  const file = path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) {
    return fallback;
  }

  const lines = readTailLines(file, 700);
  const records = lines
    .map(parseJsonLine)
    .filter((record): record is JsonlMessageRecord => record !== null);

  let firstNonNoise = '';
  let fallbackLine = '';

  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (record.type !== 'message' || !record.message) {
      continue;
    }

    if (record.message.role !== 'user') {
      continue;
    }

    const rawText = extractMessageText(record.message.content);
    const intent = pickIntentLine(rawText);
    if (!intent) {
      continue;
    }

    if (!fallbackLine) {
      fallbackLine = intent;
    }

    if (hasTaskSignal(intent)) {
      return shorten(intent, 160);
    }

    if (!isProgressPing(intent) && !firstNonNoise) {
      firstNonNoise = intent;
    }
  }

  const resolved = firstNonNoise || fallbackLine || fallback;
  return shorten(resolved, 160);
}

function readTailLines(filePath: string, maxLines: number): string[] {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= 0) {
      return [];
    }

    const readBytes = Math.min(stat.size, JSONL_TAIL_BYTES);
    const start = Math.max(0, stat.size - readBytes);
    const buffer = Buffer.alloc(readBytes);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, readBytes, start);
    } finally {
      fs.closeSync(fd);
    }

    const lines = buffer
      .toString('utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(Math.max(0, lines.length - maxLines));
  } catch {
    return [];
  }
}

function parseJsonLine(line: string): JsonlMessageRecord | null {
  try {
    return JSON.parse(line) as JsonlMessageRecord;
  } catch {
    return null;
  }
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const block = item as Record<string, unknown>;
      if (block.type !== 'text' || typeof block.text !== 'string') {
        return '';
      }
      return block.text;
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function pickIntentLine(raw: string): string {
  if (!raw) {
    return '';
  }

  const lines = raw.split('\n');
  const candidates: string[] = [];
  let inCode = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      continue;
    }

    if (
      trimmed.startsWith('Conversation info (untrusted metadata):') ||
      trimmed.startsWith('Sender (untrusted metadata):') ||
      trimmed.startsWith('[Queued messages while agent was busy]') ||
      trimmed.startsWith('Queued #') ||
      trimmed === '---'
    ) {
      continue;
    }

    if (/^[\[\]{}:,]+$/.test(trimmed)) {
      continue;
    }

    candidates.push(trimmed);
  }

  if (candidates.length === 0) {
    return '';
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const line = stripReplyMarker(candidates[i]);
    if (!line) {
      continue;
    }
    return line;
  }

  return stripReplyMarker(candidates[candidates.length - 1]);
}

function stripReplyMarker(line: string): string {
  return line.replace(/^\[\[reply_to_current\]\]\s*/i, '').trim();
}

function hasTaskSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('/model_failover') ||
    lower.includes('model_failover') ||
    lower.includes('model failover') ||
    lower.includes('手动切换') ||
    lower.includes('切换模型') ||
    lower.includes('修复') ||
    lower.includes('fix') ||
    lower.includes('bug') ||
    lower.includes('project') ||
    lower.includes('控制中心') ||
    lower.includes('dashboard') ||
    lower.includes('工单') ||
    lower.includes('linear')
  );
}

function isProgressPing(text: string): boolean {
  const normalized = text.toLowerCase();
  if (normalized.length <= 6) {
    return true;
  }

  return (
    /^(好|好的|行|ok|okay|yes|嗯|收到)$/.test(normalized) ||
    normalized.includes('完成了吗') ||
    normalized.includes('修好了吗') ||
    normalized.includes('在执行吗') ||
    normalized.includes('进度') ||
    normalized.includes('怎么样') ||
    normalized.includes('停下来了') ||
    normalized.includes('停止') ||
    normalized.includes('多久') ||
    normalized.includes('token') ||
    normalized.includes('模型')
  );
}

function shorten(text: string, maxChars: number): string {
  const clean = singleLine(text);
  if (clean.length <= maxChars) {
    return clean;
  }
  return `${clean.slice(0, maxChars - 1)}…`;
}

function safeReadDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function runOpenClawJson(args: string[]): unknown {
  const result = spawnSync('openclaw', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: OPENCLAW_CLI_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`openclaw ${args.join(' ')} failed: ${detail}`);
  }

  const content = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return extractJson(content);
}

function extractJson(text: string): unknown {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  for (let i = 0; i < text.length; i += 1) {
    const token = text[i];
    if (token !== '{' && token !== '[') {
      continue;
    }
    const candidate = text.slice(i);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new Error('Unable to parse JSON from openclaw output');
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }
  return 0;
}

function toNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toIso(ms: unknown): string | undefined {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

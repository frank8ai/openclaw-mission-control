import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  RuntimeIssueItem,
  RuntimeIssueSource,
  RuntimeTaskItem,
  RuntimeTaskSummary,
} from '@/lib/mission-control-types';

type RuntimeSnapshot = {
  generatedAt: string;
  tasks: RuntimeTaskItem[];
  issues: RuntimeIssueItem[];
  summary: RuntimeTaskSummary;
  source: string;
};

type RuntimeTaskInternal = RuntimeTaskItem & {
  bindingRefs: {
    taskId: string;
    sessionKey?: string;
    sessionId?: string;
    subagentId?: string;
    cronId?: string;
  };
  detectedIssueIds: string[];
  issueSource?: RuntimeIssueSource;
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

type RuntimeIssueBindings = {
  byTaskId?: Record<string, string>;
  bySessionId?: Record<string, string>;
  bySessionKey?: Record<string, string>;
  bySubagentId?: Record<string, string>;
  byCronId?: Record<string, string>;
};

type LinearIssueDetail = {
  identifier: string;
  title: string;
  url: string;
  state: string;
  assignee: string;
};

const OPENCLAW_HOME =
  process.env.OPENCLAW_STATE_DIR ?? path.join(os.homedir(), '.openclaw');

const ISSUE_BINDINGS_PATH = path.join(process.cwd(), 'data', 'control-center', 'runtime-issue-links.json');
const ISSUE_ID_PATTERN = /\b[A-Z][A-Z0-9]{1,11}-\d+\b/g;
const ISSUE_ID_VALID_PATTERN = /^[A-Z][A-Z0-9]{1,11}-\d+$/;
const LINEAR_API_URL = 'https://api.linear.app/graphql';
const ACTIVE_SESSION_WINDOW_MS = 6 * 60 * 60 * 1000;
const SESSION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_TASKS = 12;
const MAX_SUBAGENT_TASKS = 8;
const MAX_CRON_ISSUE_TASKS = 8;
const MAX_SESSION_INTENT_READS = 18;
const JSONL_TAIL_BYTES = 256 * 1024;
const RUNTIME_CACHE_TTL_MS = 4000;
const LINEAR_CACHE_TTL_MS = 60 * 1000;
const OPENCLAW_CLI_TIMEOUT_MS = 2500;
const ALLOWED_ISSUE_TEAM_KEYS = getAllowedIssueTeamKeys();

let runtimeCache: { expiresAtMs: number; snapshot: RuntimeSnapshot } | null = null;
const linearIssueCache = new Map<string, { expiresAtMs: number; issue: LinearIssueDetail | null }>();

export async function getOpenClawRuntimeSnapshot(): Promise<RuntimeSnapshot> {
  const nowMs = Date.now();
  if (runtimeCache && runtimeCache.expiresAtMs > nowMs) {
    return runtimeCache.snapshot;
  }

  const cronJobs = loadCronJobs();
  const sessions = loadSessions(nowMs);
  const subagents = loadSubagents(nowMs);
  const bindings = loadRuntimeIssueBindings();

  const sessionTasks = sessions
    .filter((session) => session.ageMs <= ACTIVE_SESSION_WINDOW_MS)
    .sort((left, right) => left.ageMs - right.ageMs)
    .slice(0, MAX_SESSION_TASKS)
    .map<RuntimeTaskInternal>((session) => {
      const type: RuntimeTaskItem['type'] = session.agentId === 'main' ? 'session' : 'subagent';
      const title = `[${session.agentId}] ${session.preview || session.key}`;
      const detail = `${session.model || '-'} · ${session.kind} · ${session.key}`;
      const taskId = `session:${session.agentId}:${session.key}`;
      const detectedIssueIds = extractIssueIdentifiers(session.preview, session.key, detail);
      return {
        id: taskId,
        type,
        status: session.abortedLastRun ? 'warning' : 'running',
        title,
        detail,
        ageMs: session.ageMs,
        updatedAt: toIso(session.updatedAt),
        bindingRefs: {
          taskId,
          sessionKey: session.key,
          sessionId: session.sessionId || undefined,
        },
        detectedIssueIds,
      };
    });

  const subagentTasks = subagents
    .filter((item) => item.isActive)
    .slice(0, MAX_SUBAGENT_TASKS)
    .map<RuntimeTaskInternal>((item) => {
      const taskId = `subagent:${item.id}`;
      const detail = `status=${item.status}`;
      return {
        id: taskId,
        type: 'subagent',
        status: 'running',
        title: item.label,
        detail,
        ageMs: item.durationMs,
        updatedAt: toIso(item.startedAtMs),
        bindingRefs: {
          taskId,
          subagentId: item.id,
        },
        detectedIssueIds: extractIssueIdentifiers(item.label, detail),
      };
    });

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
    .map<RuntimeTaskInternal>((job) => {
      const state = job.state ?? {};
      const lastError = String(state.lastError ?? '').trim();
      const lastStatus = String(state.lastStatus ?? '-');
      const consecutiveErrors = Number(state.consecutiveErrors ?? 0);
      const taskId = `cron:${job.id}`;
      const detail = `${lastStatus} · consecutiveErrors=${consecutiveErrors}${
        lastError ? ` · ${singleLine(lastError).slice(0, 120)}` : ''
      }`;

      return {
        id: taskId,
        type: 'cron',
        status: 'warning',
        title: `${job.name ?? job.id}`,
        detail,
        ageMs:
          Number(state.lastRunAtMs) > 0
            ? Math.max(0, nowMs - Number(state.lastRunAtMs))
            : undefined,
        updatedAt: toIso(state.lastRunAtMs),
        bindingRefs: {
          taskId,
          cronId: job.id,
        },
        detectedIssueIds: extractIssueIdentifiers(job.name ?? '', detail, lastError),
      };
    });

  const taskCandidates = [...sessionTasks, ...subagentTasks, ...cronIssueTasks];
  for (const task of taskCandidates) {
    const bindingIssue = resolveBoundIssue(task, bindings);
    if (bindingIssue) {
      task.issueIdentifier = bindingIssue;
      task.issueSource = 'binding';
    } else if (task.detectedIssueIds.length > 0) {
      task.issueIdentifier = task.detectedIssueIds[0];
      task.issueSource = 'detected';
    }
  }

  const issueIds = dedupeStrings(
    taskCandidates
      .map((task) => normalizeIssueIdentifier(task.issueIdentifier))
      .filter((value): value is string => Boolean(value)),
  );
  const issueDetailMap = await loadLinearIssueDetails(issueIds, nowMs);

  for (const task of taskCandidates) {
    const issueId = normalizeIssueIdentifier(task.issueIdentifier);
    if (!issueId) {
      continue;
    }
    const issue = issueDetailMap.get(issueId);
    if (!issue) {
      task.issueIdentifier = issueId;
      continue;
    }
    task.issueIdentifier = issue.identifier;
    task.issueTitle = issue.title;
    task.issueState = issue.state;
    task.issueUrl = issue.url || undefined;
    task.issueAssignee = issue.assignee || undefined;
  }

  const tasks = taskCandidates
    .map(stripInternalRuntimeTask)
    .sort((left, right) => {
    const statusRank = (value: RuntimeTaskItem['status']) =>
      value === 'running' ? 0 : value === 'warning' ? 1 : 2;
    if (statusRank(left.status) !== statusRank(right.status)) {
      return statusRank(left.status) - statusRank(right.status);
    }
    return Number(left.ageMs ?? Number.MAX_SAFE_INTEGER) - Number(right.ageMs ?? Number.MAX_SAFE_INTEGER);
  });

  const issues = buildRuntimeIssues(taskCandidates);
  const runningSessionTasks = sessionTasks.filter((item) => item.status === 'running');
  const workerSessions = sessionTasks.filter((item) => item.type === 'subagent');
  const linkedTasks = tasks.filter((item) => Boolean(item.issueIdentifier)).length;
  const unlinkedActive = tasks.filter(
    (item) => item.status === 'running' && !item.issueIdentifier,
  ).length;
  const summary: RuntimeTaskSummary = {
    active:
      runningSessionTasks.length +
      subagentTasks.filter((item) => item.status === 'running').length,
    warnings: tasks.filter((item) => item.status === 'warning').length,
    sessions: sessionTasks.length - workerSessions.length,
    subagents: workerSessions.length + subagentTasks.length,
    cronIssues: cronIssueTasks.length,
    linkedIssues: issues.length,
    linkedTasks,
    unlinkedActive,
  };

  const linearEnabled = Boolean(
    String(process.env.LINEAR_API_KEY || '').trim() ||
      String(process.env.NEXT_PUBLIC_LINEAR_API_KEY || '').trim(),
  );
  const snapshot: RuntimeSnapshot = {
    generatedAt: new Date(nowMs).toISOString(),
    tasks,
    issues,
    summary,
    source: linearEnabled
      ? 'openclaw-all-agents+state-files+linear'
      : 'openclaw-all-agents+state-files',
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

function stripInternalRuntimeTask(task: RuntimeTaskInternal): RuntimeTaskItem {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    title: task.title,
    detail: task.detail,
    ageMs: task.ageMs,
    updatedAt: task.updatedAt,
    issueIdentifier: task.issueIdentifier,
    issueTitle: task.issueTitle,
    issueState: task.issueState,
    issueUrl: task.issueUrl,
    issueAssignee: task.issueAssignee,
    issueSource: task.issueSource,
  };
}

function buildRuntimeIssues(tasks: RuntimeTaskInternal[]): RuntimeIssueItem[] {
  const grouped = new Map<
    string,
    {
      identifier: string;
      title: string;
      state: string;
      url?: string;
      assignee?: string;
      hasBinding: boolean;
      hasDetected: boolean;
      taskCount: number;
      runningCount: number;
      warningCount: number;
      latestUpdateAt?: string;
      tasks: Array<Pick<RuntimeTaskItem, 'id' | 'type' | 'status' | 'title' | 'updatedAt'>>;
    }
  >();

  for (const task of tasks) {
    const identifier = normalizeIssueIdentifier(task.issueIdentifier);
    if (!identifier) {
      continue;
    }

    const existing = grouped.get(identifier) ?? {
      identifier,
      title: task.issueTitle || identifier,
      state: task.issueState || '-',
      url: task.issueUrl,
      assignee: task.issueAssignee,
      hasBinding: false,
      hasDetected: false,
      taskCount: 0,
      runningCount: 0,
      warningCount: 0,
      latestUpdateAt: task.updatedAt,
      tasks: [],
    };

    existing.title = task.issueTitle || existing.title;
    existing.state = task.issueState || existing.state;
    existing.url = task.issueUrl || existing.url;
    existing.assignee = task.issueAssignee || existing.assignee;
    existing.taskCount += 1;
    if (task.status === 'running') {
      existing.runningCount += 1;
    }
    if (task.status === 'warning') {
      existing.warningCount += 1;
    }
    if (!existing.latestUpdateAt && task.updatedAt) {
      existing.latestUpdateAt = task.updatedAt;
    }
    if (
      existing.latestUpdateAt &&
      task.updatedAt &&
      Date.parse(task.updatedAt) > Date.parse(existing.latestUpdateAt)
    ) {
      existing.latestUpdateAt = task.updatedAt;
    }
    if (task.issueSource === 'binding') {
      existing.hasBinding = true;
    }
    if (task.issueSource === 'detected') {
      existing.hasDetected = true;
    }
    existing.tasks.push({
      id: task.id,
      type: task.type,
      status: task.status,
      title: task.title,
      updatedAt: task.updatedAt,
    });

    grouped.set(identifier, existing);
  }

  return [...grouped.values()]
    .map((item) => {
      const source: RuntimeIssueItem['source'] =
        item.hasBinding && item.hasDetected ? 'mixed' : item.hasBinding ? 'binding' : 'detected';
      return {
        identifier: item.identifier,
        title: item.title,
        state: item.state,
        url: item.url,
        assignee: item.assignee,
        source,
        taskCount: item.taskCount,
        runningCount: item.runningCount,
        warningCount: item.warningCount,
        latestUpdateAt: item.latestUpdateAt,
        tasks: item.tasks.slice(0, 8),
      };
    })
    .sort((left, right) => {
      if (left.warningCount !== right.warningCount) {
        return right.warningCount - left.warningCount;
      }
      if (left.runningCount !== right.runningCount) {
        return right.runningCount - left.runningCount;
      }
      return left.identifier.localeCompare(right.identifier);
    });
}

function loadRuntimeIssueBindings(): RuntimeIssueBindings {
  try {
    const payload = JSON.parse(fs.readFileSync(ISSUE_BINDINGS_PATH, 'utf8')) as RuntimeIssueBindings;
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
}

function resolveBoundIssue(task: RuntimeTaskInternal, bindings: RuntimeIssueBindings): string | undefined {
  const refs = task.bindingRefs;

  const candidates = [
    lookupBinding(bindings.byTaskId, refs.taskId),
    lookupBinding(bindings.bySessionId, refs.sessionId),
    lookupBinding(bindings.bySessionKey, refs.sessionKey),
    lookupBinding(bindings.bySubagentId, refs.subagentId),
    lookupBinding(bindings.byCronId, refs.cronId),
  ];

  for (const value of candidates) {
    const normalized = normalizeIssueIdentifier(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function lookupBinding(map: Record<string, string> | undefined, key: string | undefined): string | undefined {
  if (!map || !key) {
    return undefined;
  }
  const direct = map[key];
  if (typeof direct === 'string' && direct.trim()) {
    return direct;
  }

  const loweredKey = key.toLowerCase();
  for (const [candidateKey, value] of Object.entries(map)) {
    if (candidateKey.toLowerCase() === loweredKey) {
      return value;
    }
  }
  return undefined;
}

function extractIssueIdentifiers(...values: Array<string | undefined>): string[] {
  const found: string[] = [];
  for (const value of values) {
    const text = String(value || '').toUpperCase();
    if (!text) {
      continue;
    }
    const matches = text.match(ISSUE_ID_PATTERN) || [];
    for (const match of matches) {
      const normalized = normalizeIssueIdentifier(match);
      if (!normalized) {
        continue;
      }
      if (!isAllowedDetectedIssueIdentifier(normalized)) {
        continue;
      }
      found.push(normalized);
    }
  }
  return dedupeStrings(found);
}

function normalizeIssueIdentifier(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }
  if (!ISSUE_ID_VALID_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

async function loadLinearIssueDetails(
  issueIds: string[],
  nowMs: number,
): Promise<Map<string, LinearIssueDetail>> {
  const apiKey = String(process.env.LINEAR_API_KEY || process.env.NEXT_PUBLIC_LINEAR_API_KEY || '').trim();
  if (!apiKey || issueIds.length === 0) {
    return new Map();
  }

  const out = new Map<string, LinearIssueDetail>();
  for (const issueId of issueIds) {
    const cached = linearIssueCache.get(issueId);
    if (cached && cached.expiresAtMs > nowMs) {
      if (cached.issue) {
        out.set(issueId, cached.issue);
      }
      continue;
    }

    const issue = await fetchLinearIssueByIdentifier(apiKey, issueId).catch(() => null);
    linearIssueCache.set(issueId, {
      expiresAtMs: nowMs + LINEAR_CACHE_TTL_MS,
      issue,
    });
    if (issue) {
      out.set(issueId, issue);
    }
  }
  return out;
}

async function fetchLinearIssueByIdentifier(
  apiKey: string,
  identifier: string,
): Promise<LinearIssueDetail | null> {
  const parsed = parseIssueIdentifier(identifier);
  if (!parsed) {
    return null;
  }

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
          identifier
          title
          url
          state { name }
          assignee { name displayName }
        }
      }
    }`,
    {
      teamKey: parsed.teamKey,
      number: parsed.number,
    },
  );

  const issuesPayload = payload.issues as
    | {
        nodes?: Array<{
          identifier?: string;
          title?: string;
          url?: string;
          state?: { name?: string };
          assignee?: { name?: string; displayName?: string };
        }>;
      }
    | undefined;
  const node = (issuesPayload?.nodes || [])[0] as
    | {
        identifier?: string;
        title?: string;
        url?: string;
        state?: { name?: string };
        assignee?: { name?: string; displayName?: string };
      }
    | undefined;
  if (!node || !node.identifier) {
    return null;
  }

  return {
    identifier: String(node.identifier),
    title: String(node.title || node.identifier),
    url: String(node.url || ''),
    state: String(node.state?.name || '-'),
    assignee: String(node.assignee?.displayName || node.assignee?.name || ''),
  };
}

function parseIssueIdentifier(identifier: string): { teamKey: string; number: number } | null {
  const match = String(identifier || '').toUpperCase().match(/^([A-Z][A-Z0-9]+)-(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    teamKey: match[1],
    number: Number(match[2]),
  };
}

function isAllowedDetectedIssueIdentifier(identifier: string): boolean {
  const parsed = parseIssueIdentifier(identifier);
  if (!parsed) {
    return false;
  }
  if (ALLOWED_ISSUE_TEAM_KEYS.size === 0) {
    return true;
  }
  return ALLOWED_ISSUE_TEAM_KEYS.has(parsed.teamKey);
}

function getAllowedIssueTeamKeys(): Set<string> {
  const raw = [
    String(process.env.LINEAR_TEAM_KEY || ''),
    String(process.env.CONTROL_CENTER_ISSUE_TEAM_KEYS || ''),
    'CLAW',
  ]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return new Set(raw);
}

async function linearRequest(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`linear request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    data?: Record<string, unknown>;
    errors?: Array<{ message?: string }>;
  };

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const message = payload.errors[0]?.message || 'linear graphql error';
    throw new Error(message);
  }

  return payload.data || {};
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

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ApprovalItem,
  ApprovalStatus,
  CronEvent,
  SubagentItem,
  TodoItem,
  ToolAction,
  ToolCard,
  ToolId,
} from '@/lib/mission-control-types';

export type {
  ApprovalItem,
  ApprovalStatus,
  CronEvent,
  SubagentItem,
  TodoItem,
  ToolAction,
  ToolCard,
  ToolId,
} from '@/lib/mission-control-types';

const DATA_DIR = path.join(process.cwd(), 'data', 'mission-control');
const STUBS_DIR = path.join(DATA_DIR, 'stubs');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');
const APPROVALS_FILE = path.join(DATA_DIR, 'approvals.json');
const SUBAGENTS_FILE = path.join(DATA_DIR, 'subagents.json');
const TOOL_ACTIONS_FILE = path.join(DATA_DIR, 'tool-actions.json');
const CRON_EVENTS_FILE = path.join(DATA_DIR, 'cron-events.json');

const TOOL_CARDS: ToolCard[] = [
  {
    id: 'briefing-stub',
    label: 'Generate Briefing Stub',
    description: 'Creates a markdown shell for the next daily briefing handoff.',
    actionLabel: 'Generate',
  },
  {
    id: 'research-pack-stub',
    label: 'Create Research Pack Stub',
    description: 'Drafts a research pack template with placeholders for findings.',
    actionLabel: 'Create',
  },
  {
    id: 'cron-stub',
    label: 'Trigger Cron Stub',
    description: 'Writes a local event entry that simulates a scheduled job trigger.',
    actionLabel: 'Trigger',
  },
];

const DEFAULT_TODOS: TodoItem[] = [
  {
    id: 'todo-1',
    title: 'Review overnight signals before standup',
    done: false,
    createdAt: '2026-02-18T14:10:00.000Z',
  },
  {
    id: 'todo-2',
    title: 'Prepare mission brief for content lane',
    done: false,
    createdAt: '2026-02-18T15:20:00.000Z',
  },
];

const DEFAULT_APPROVALS: ApprovalItem[] = [
  {
    id: 'approval-1',
    kind: 'tweet',
    title: 'Launch thread for today’s security insight',
    creator: 'content-bot',
    createdAt: '2026-02-18T23:10:00.000Z',
    status: 'pending',
  },
  {
    id: 'approval-2',
    kind: 'thumbnail',
    title: 'YouTube thumbnail v2 for exploit recap',
    creator: 'design-agent',
    createdAt: '2026-02-18T23:35:00.000Z',
    status: 'pending',
  },
  {
    id: 'approval-3',
    kind: 'script',
    title: 'Three-minute ops update script draft',
    creator: 'script-assistant',
    createdAt: '2026-02-19T00:05:00.000Z',
    status: 'pending',
  },
];

const DEFAULT_SUBAGENTS: SubagentItem[] = [
  {
    id: 'subagent-1',
    name: 'intel-scout',
    status: 'running',
    lastHeartbeat: '2026-02-19T11:41:00.000Z',
    output: 'Scanning five watchlists for fresh exploit chatter.',
  },
  {
    id: 'subagent-2',
    name: 'content-drafter',
    status: 'idle',
    lastHeartbeat: '2026-02-19T11:20:00.000Z',
    output: 'No active assignment. Waiting for queue input.',
  },
  {
    id: 'subagent-3',
    name: 'thumbnail-critic',
    status: 'error',
    lastHeartbeat: '2026-02-19T10:55:00.000Z',
    output: 'Render timeout on latest batch. Manual review suggested.',
  },
];

export type SubagentProvider = {
  listSubagents: () => Promise<SubagentItem[]>;
};

class LocalFileSubagentProvider implements SubagentProvider {
  async listSubagents(): Promise<SubagentItem[]> {
    return readJsonFile(SUBAGENTS_FILE, DEFAULT_SUBAGENTS);
  }
}

let subagentProvider: SubagentProvider = new LocalFileSubagentProvider();

export function registerSubagentProvider(provider: SubagentProvider): void {
  subagentProvider = provider;
}

export function getToolCards(): ToolCard[] {
  return TOOL_CARDS;
}

export function isToolId(value: string): value is ToolId {
  return TOOL_CARDS.some((tool) => tool.id === value);
}

export async function listTodos(): Promise<TodoItem[]> {
  return readJsonFile(TODOS_FILE, DEFAULT_TODOS);
}

export async function createTodo(title: string): Promise<TodoItem> {
  const todos = await listTodos();
  const todo: TodoItem = {
    id: randomUUID(),
    title,
    done: false,
    createdAt: new Date().toISOString(),
  };
  const nextTodos = [todo, ...todos];
  await writeJsonFile(TODOS_FILE, nextTodos);
  return todo;
}

export async function updateTodo(
  id: string,
  updates: Partial<Pick<TodoItem, 'title' | 'done'>>,
): Promise<TodoItem | null> {
  const todos = await listTodos();
  const index = todos.findIndex((todo) => todo.id === id);
  if (index < 0) {
    return null;
  }

  const current = todos[index];
  const next: TodoItem = {
    ...current,
    title: updates.title ?? current.title,
    done: updates.done ?? current.done,
  };
  const nextTodos = [...todos];
  nextTodos[index] = next;
  await writeJsonFile(TODOS_FILE, nextTodos);
  return next;
}

export async function removeTodo(id: string): Promise<boolean> {
  const todos = await listTodos();
  const nextTodos = todos.filter((todo) => todo.id !== id);
  if (nextTodos.length === todos.length) {
    return false;
  }
  await writeJsonFile(TODOS_FILE, nextTodos);
  return true;
}

export async function listApprovals(): Promise<ApprovalItem[]> {
  return readJsonFile(APPROVALS_FILE, DEFAULT_APPROVALS);
}

export async function decideApproval(
  id: string,
  decision: Extract<ApprovalStatus, 'approved' | 'rejected'>,
): Promise<ApprovalItem | null> {
  const approvals = await listApprovals();
  const index = approvals.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }

  const nextItem: ApprovalItem = {
    ...approvals[index],
    status: decision,
    decidedAt: new Date().toISOString(),
  };
  const nextApprovals = [...approvals];
  nextApprovals[index] = nextItem;
  await writeJsonFile(APPROVALS_FILE, nextApprovals);
  return nextItem;
}

export async function listSubagents(): Promise<SubagentItem[]> {
  return subagentProvider.listSubagents();
}

export async function listToolActions(): Promise<ToolAction[]> {
  return readJsonFile(TOOL_ACTIONS_FILE, []);
}

export async function triggerToolAction(toolId: ToolId): Promise<ToolAction> {
  const createdAt = new Date().toISOString();
  let artifactPath: string | undefined;
  let summary: string;

  if (toolId === 'briefing-stub') {
    artifactPath = await createBriefingStub(createdAt);
    summary = 'Generated briefing stub file.';
  } else if (toolId === 'research-pack-stub') {
    artifactPath = await createResearchPackStub(createdAt);
    summary = 'Generated research pack stub file.';
  } else {
    await appendCronEvent({
      id: randomUUID(),
      source: 'cron-stub',
      createdAt,
      note: 'Manual cron trigger requested from dashboard tool card.',
    });
    summary = 'Recorded cron trigger event.';
  }

  const action: ToolAction = {
    id: randomUUID(),
    toolId,
    createdAt,
    summary,
    artifactPath,
  };

  const history = await listToolActions();
  const nextHistory = [action, ...history].slice(0, 25);
  await writeJsonFile(TOOL_ACTIONS_FILE, nextHistory);
  return action;
}

async function appendCronEvent(event: CronEvent): Promise<void> {
  const events = await readJsonFile<CronEvent[]>(CRON_EVENTS_FILE, []);
  const nextEvents = [event, ...events].slice(0, 50);
  await writeJsonFile(CRON_EVENTS_FILE, nextEvents);
}

async function createBriefingStub(timestamp: string): Promise<string> {
  await fs.mkdir(STUBS_DIR, { recursive: true });
  const fileName = `briefing-${toFileStamp(timestamp)}.md`;
  const filePath = path.join(STUBS_DIR, fileName);
  const content = [
    '# Daily Briefing Stub',
    '',
    `Generated at: ${timestamp}`,
    '',
    '## Headline Signals',
    '- [ ] Add top three updates',
    '',
    '## Priority Tasks',
    '- [ ] Add mission-critical task list',
    '',
    '## Risks / Follow Ups',
    '- [ ] Add blockers and proposed mitigations',
    '',
  ].join('\n');
  await fs.writeFile(filePath, content, 'utf8');
  return path.relative(process.cwd(), filePath);
}

async function createResearchPackStub(timestamp: string): Promise<string> {
  await fs.mkdir(STUBS_DIR, { recursive: true });
  const fileName = `research-pack-${toFileStamp(timestamp)}.md`;
  const filePath = path.join(STUBS_DIR, fileName);
  const content = [
    '# Research Pack Stub',
    '',
    `Generated at: ${timestamp}`,
    '',
    '## Objective',
    '- [ ] Define core question',
    '',
    '## Evidence',
    '- [ ] Add links and notes',
    '',
    '## Suggested Narrative',
    '- [ ] Add talking points for thread / script',
    '',
  ].join('\n');
  await fs.writeFile(filePath, content, 'utf8');
  return path.relative(process.cwd(), filePath);
}

function toFileStamp(isoTime: string): string {
  return isoTime.replace(/[:.]/g, '-');
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    await writeJsonFile(filePath, fallback);
    return clone(fallback);
  }
}

async function writeJsonFile<T>(filePath: string, value: T): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, payload, 'utf8');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

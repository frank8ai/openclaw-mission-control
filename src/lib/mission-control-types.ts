export type TodoItem = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
};

export type SubagentStatus = 'idle' | 'running' | 'error' | 'offline';

export type SubagentItem = {
  id: string;
  name: string;
  status: SubagentStatus;
  lastHeartbeat: string;
  output: string;
};

export type ContentType = 'tweet' | 'thumbnail' | 'script';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type ApprovalItem = {
  id: string;
  kind: ContentType;
  title: string;
  creator: string;
  createdAt: string;
  status: ApprovalStatus;
  decidedAt?: string;
};

export type ToolId = 'briefing-stub' | 'research-pack-stub' | 'cron-stub';

export type ToolCard = {
  id: ToolId;
  label: string;
  description: string;
  actionLabel: string;
};

export type ToolAction = {
  id: string;
  toolId: ToolId;
  createdAt: string;
  summary: string;
  artifactPath?: string;
};

export type CronEvent = {
  id: string;
  source: ToolId;
  createdAt: string;
  note: string;
};

export type RuntimeTaskType = 'session' | 'subagent' | 'cron';
export type RuntimeTaskStatus = 'running' | 'warning' | 'idle';
export type RuntimeIssueSource = 'detected' | 'binding';

export type RuntimeTaskItem = {
  id: string;
  type: RuntimeTaskType;
  status: RuntimeTaskStatus;
  title: string;
  detail: string;
  ageMs?: number;
  updatedAt?: string;
  issueIdentifier?: string;
  issueTitle?: string;
  issueState?: string;
  issueUrl?: string;
  issueAssignee?: string;
  issueSource?: RuntimeIssueSource;
};

export type RuntimeIssueItem = {
  identifier: string;
  title: string;
  state: string;
  url?: string;
  assignee?: string;
  source: RuntimeIssueSource | 'mixed';
  taskCount: number;
  runningCount: number;
  warningCount: number;
  latestUpdateAt?: string;
  tasks: Array<
    Pick<RuntimeTaskItem, 'id' | 'type' | 'status' | 'title' | 'updatedAt'>
  >;
};

export type RuntimeTaskSummary = {
  active: number;
  warnings: number;
  sessions: number;
  subagents: number;
  cronIssues: number;
  linkedIssues: number;
  linkedTasks: number;
  unlinkedActive: number;
};

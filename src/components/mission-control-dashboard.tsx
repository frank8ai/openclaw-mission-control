'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ApprovalItem,
  ApprovalStatus,
  RuntimeIssueItem,
  RuntimeTaskItem,
  RuntimeTaskStatus,
  RuntimeTaskSummary,
  SubagentItem,
  SubagentStatus,
  TodoItem,
  ToolAction,
  ToolCard,
  ToolId,
} from '@/lib/mission-control-types';

const subagentStatusStyles: Record<SubagentStatus, string> = {
  idle: 'bg-slate-100 text-slate-700',
  running: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700',
  offline: 'bg-amber-100 text-amber-700',
};

const approvalStatusStyles: Record<ApprovalStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
};

const contentTypeStyles: Record<ApprovalItem['kind'], string> = {
  tweet: 'bg-sky-100 text-sky-700',
  thumbnail: 'bg-violet-100 text-violet-700',
  script: 'bg-orange-100 text-orange-700',
};

const runtimeStatusStyles: Record<RuntimeTaskStatus, string> = {
  running: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  idle: 'bg-slate-100 text-slate-700',
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

type SourcePayload = {
  ok: boolean;
  source?: string;
  error?: string;
};

type TodosPayload = SourcePayload & { todos: TodoItem[] };
type ApprovalsPayload = SourcePayload & { approvals: ApprovalItem[] };
type ToolsPayload = SourcePayload & { tools: ToolCard[]; actions: ToolAction[] };
type TodoMutationPayload = SourcePayload & { todo?: TodoItem };
type ApprovalMutationPayload = SourcePayload & { approval?: ApprovalItem };
type ToolMutationPayload = SourcePayload & { action?: ToolAction };
type ControlJobsPayload = SourcePayload & { jobs: string[] };
type ControlRunPayload = SourcePayload & {
  jobId?: string;
  payload?: unknown;
};

type ControlJobCard = {
  id: string;
  label: string;
  description: string;
  payload?: Record<string, unknown>;
};

export default function MissionControlDashboard() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTaskItem[]>([]);
  const [runtimeIssues, setRuntimeIssues] = useState<RuntimeIssueItem[]>([]);
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeTaskSummary>({
    active: 0,
    warnings: 0,
    sessions: 0,
    subagents: 0,
    cronIssues: 0,
    linkedIssues: 0,
    linkedTasks: 0,
    unlinkedActive: 0,
  });
  const [runtimeSource, setRuntimeSource] = useState<string>('unknown');
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [subagents, setSubagents] = useState<SubagentItem[]>([]);
  const [subagentSource, setSubagentSource] = useState<string>('unknown');
  const [subagentError, setSubagentError] = useState<string | null>(null);
  const [todoSource, setTodoSource] = useState<string>('unknown');
  const [todoError, setTodoError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [approvalsSource, setApprovalsSource] = useState<string>('unknown');
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolCard[]>([]);
  const [toolActions, setToolActions] = useState<ToolAction[]>([]);
  const [toolsSource, setToolsSource] = useState<string>('unknown');
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [todoDraft, setTodoDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyTodoIds, setBusyTodoIds] = useState<string[]>([]);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const [busyToolId, setBusyToolId] = useState<ToolId | null>(null);
  const [controlJobs, setControlJobs] = useState<string[]>([]);
  const [controlSource, setControlSource] = useState<string>('unknown');
  const [controlConfirmCode, setControlConfirmCode] = useState('');
  const [busyControlJobId, setBusyControlJobId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<number>(15000);

  const completedTodos = useMemo(
    () => todos.filter((todo) => todo.done).length,
    [todos],
  );
  const pendingApprovals = useMemo(
    () => approvals.filter((item) => item.status === 'pending').length,
    [approvals],
  );

  const toolLabelMap = useMemo(
    () => new Map(tools.map((tool) => [tool.id, tool.label])),
    [tools],
  );

  const controlJobCards = useMemo<ControlJobCard[]>(
    () => [
      {
        id: 'github-sync',
        label: 'Run GitHub Sync',
        description: 'Sync PR signals to Linear state.',
      },
      {
        id: 'todoist-sync',
        label: 'Run Todoist Sync',
        description: 'Pull Todoist tasks into Linear triage.',
      },
      {
        id: 'calendar-sync',
        label: 'Run Calendar Sync',
        description: 'Capture calendar events into mission flow.',
      },
      {
        id: 'watchdog',
        label: 'Run Watchdog',
        description: 'Detect failures/timeouts and open incidents.',
        payload: {
          autoLinear: true,
        },
      },
      {
        id: 'report',
        label: 'Run Health Report',
        description: 'Generate current runtime health summary.',
      },
      {
        id: 'briefing',
        label: 'Run Daily Briefing',
        description: 'Generate/send daily mission briefing template.',
        payload: {
          mode: 'daily',
          send: true,
        },
      },
      {
        id: 'remind',
        label: 'Run Reminder',
        description: 'Send due/cycle reminder snapshot.',
        payload: {
          mode: 'all',
        },
      },
    ],
    [],
  );

  const refreshData = useCallback(async (initialLoad = false): Promise<void> => {
    if (initialLoad) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const [todosPayload, runtimePayload, subagentsPayload, approvalsPayload, toolsPayload, controlPayload] =
        await Promise.all([
          fetchJson<TodosPayload>('/api/todos'),
          fetchJson<{
            ok: boolean;
            tasks: RuntimeTaskItem[];
            issues: RuntimeIssueItem[];
            summary: RuntimeTaskSummary;
            source: string;
            error?: string;
          }>('/api/runtime/tasks'),
          fetchJson<{
            subagents: SubagentItem[];
            source?: string;
            ok?: boolean;
            error?: string;
          }>('/api/subagents'),
          fetchJson<ApprovalsPayload>('/api/approvals'),
          fetchJson<ToolsPayload>('/api/tools'),
          fetchJson<ControlJobsPayload>('/api/control/jobs'),
        ]);

      setTodos(todosPayload.todos ?? []);
      setTodoSource(todosPayload.source ?? 'unknown');
      setTodoError(todosPayload.ok ? null : todosPayload.error ?? null);
      setRuntimeTasks(runtimePayload.tasks ?? []);
      setRuntimeIssues(runtimePayload.issues ?? []);
      setRuntimeSummary(
        runtimePayload.summary ?? {
          active: 0,
          warnings: 0,
          sessions: 0,
          subagents: 0,
          cronIssues: 0,
          linkedIssues: 0,
          linkedTasks: 0,
          unlinkedActive: 0,
        },
      );
      setRuntimeSource(runtimePayload.source ?? 'unknown');
      setRuntimeError(runtimePayload.ok ? null : runtimePayload.error ?? null);
      setSubagents(subagentsPayload.subagents);
      setSubagentSource(subagentsPayload.source ?? 'unknown');
      setSubagentError(subagentsPayload.ok === false ? subagentsPayload.error ?? null : null);
      setApprovals(sortApprovals(approvalsPayload.approvals ?? []));
      setApprovalsSource(approvalsPayload.source ?? 'unknown');
      setApprovalsError(approvalsPayload.ok ? null : approvalsPayload.error ?? null);
      setTools(toolsPayload.tools ?? []);
      setToolActions(toolsPayload.actions ?? []);
      setToolsSource(toolsPayload.source ?? 'unknown');
      setToolsError(toolsPayload.ok ? null : toolsPayload.error ?? null);
      setControlJobs(controlPayload.jobs ?? []);
      setControlSource(controlPayload.source ?? 'unknown');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshData(true);
  }, [refreshData]);

  useEffect(() => {
    if (refreshInterval <= 0) {
      return;
    }

    const handle = window.setInterval(() => {
      void refreshData(false);
    }, refreshInterval);

    return () => {
      window.clearInterval(handle);
    };
  }, [refreshData, refreshInterval]);

  async function handleCreateTodo(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const title = todoDraft.trim();
    if (!title) {
      return;
    }

    setTodoDraft('');
    try {
      const payload = await fetchJson<TodoMutationPayload>('/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      const createdTodo = payload.todo;
      if (!createdTodo) {
        throw new Error(payload.error ?? 'failed to create todo');
      }
      setTodos((current) => [createdTodo, ...current]);
      setTodoSource(payload.source ?? todoSource);
      setTodoError(payload.ok ? null : payload.error ?? null);
      setNotice('Todo created.');
      setErrorMessage(null);
    } catch (error) {
      setTodoDraft(title);
      setErrorMessage(normalizeError(error));
    }
  }

  async function handleToggleTodo(todo: TodoItem): Promise<void> {
    setBusyTodoIds((current) => [...current, todo.id]);
    try {
      const payload = await fetchJson<TodoMutationPayload>(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: !todo.done }),
      });
      const updatedTodo = payload.todo;
      if (!updatedTodo) {
        throw new Error(payload.error ?? 'failed to update todo');
      }
      setTodos((current) =>
        current.map((item) => (item.id === todo.id ? updatedTodo : item)),
      );
      setTodoSource(payload.source ?? todoSource);
      setTodoError(payload.ok ? null : payload.error ?? null);
      setNotice(updatedTodo.done ? 'Todo marked done.' : 'Todo reopened.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      setBusyTodoIds((current) => current.filter((id) => id !== todo.id));
    }
  }

  async function handleDeleteTodo(todoId: string): Promise<void> {
    setBusyTodoIds((current) => [...current, todoId]);
    try {
      const payload = await fetchJson<SourcePayload>(`/api/todos/${todoId}`, {
        method: 'DELETE',
      });
      if (!payload.ok) {
        throw new Error(payload.error ?? 'failed to delete todo');
      }
      setTodos((current) => current.filter((todo) => todo.id !== todoId));
      setTodoSource(payload.source ?? todoSource);
      setTodoError(payload.error ?? null);
      setNotice('Todo removed.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      setBusyTodoIds((current) => current.filter((id) => id !== todoId));
    }
  }

  async function handleApproval(
    itemId: string,
    decision: Extract<ApprovalStatus, 'approved' | 'rejected'>,
  ): Promise<void> {
    setBusyApprovalId(itemId);
    try {
      const payload = await fetchJson<ApprovalMutationPayload>(
        `/api/approvals/${itemId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ decision }),
        },
      );
      const updatedApproval = payload.approval;
      if (!updatedApproval) {
        throw new Error(payload.error ?? 'failed to update approval');
      }
      setApprovals((current) =>
        sortApprovals(
          current.map((item) => (item.id === itemId ? updatedApproval : item)),
        ),
      );
      setApprovalsSource(payload.source ?? approvalsSource);
      setApprovalsError(payload.ok ? null : payload.error ?? null);
      setNotice(decision === 'approved' ? 'Content approved.' : 'Content rejected.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      setBusyApprovalId(null);
    }
  }

  async function handleToolTrigger(toolId: ToolId): Promise<void> {
    setBusyToolId(toolId);
    try {
      const payload = await fetchJson<ToolMutationPayload>(`/api/tools/${toolId}`, {
        method: 'POST',
      });
      const action = payload.action;
      if (!action) {
        throw new Error(payload.error ?? 'failed to trigger tool');
      }
      setToolActions((current) => [action, ...current].slice(0, 25));
      setToolsSource(payload.source ?? toolsSource);
      setToolsError(payload.ok ? null : payload.error ?? null);
      setNotice(action.summary);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      setBusyToolId(null);
    }
  }

  async function handleRunControlJob(job: ControlJobCard): Promise<void> {
    const code = controlConfirmCode.trim();
    if (!code) {
      setErrorMessage('Enter a CONFIRM code before running control jobs.');
      return;
    }

    setBusyControlJobId(job.id);
    try {
      const payload = await fetchJson<ControlRunPayload>('/api/control/jobs', {
        method: 'POST',
        body: JSON.stringify({
          jobId: job.id,
          confirm: code,
          ...(job.payload ?? {}),
        }),
      });
      if (!payload.ok) {
        throw new Error(payload.error ?? 'failed to run control job');
      }
      setNotice(`Control job executed: ${job.id}`);
      setErrorMessage(null);
      setControlConfirmCode('');
      void refreshData(false);
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      setBusyControlJobId(null);
    }
  }

  async function handleCopyArtifactPath(artifactPath: string): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(artifactPath);
      } else {
        copyTextFallback(artifactPath);
      }
      setNotice('Artifact path copied.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(normalizeError(error));
    }
  }

  if (isLoading) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-sm">
        <p className="text-sm text-slate-600">Loading mission dashboard...</p>
      </section>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <section className="rounded-3xl border border-cyan-200 bg-[linear-gradient(145deg,#f7feff_0%,#ecf5ff_50%,#fdf7f0_100%)] p-7 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">
              Mission Control MVP
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">
              Command Dashboard
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Local-first control surface for task execution, subagent awareness, and
              outbound content approvals.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              Auto refresh
              <select
                value={refreshInterval}
                onChange={(event) => setRefreshInterval(Number(event.target.value))}
                className="rounded-md border border-cyan-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none ring-cyan-300 focus:border-cyan-300 focus:ring-2"
              >
                <option value={0}>Off</option>
                <option value={5000}>5s</option>
                <option value={15000}>15s</option>
                <option value={30000}>30s</option>
                <option value={60000}>60s</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void refreshData(false)}
              className="rounded-lg border border-cyan-300 bg-white px-3 py-2 text-sm font-medium text-cyan-800 transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh data'}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full bg-white px-3 py-1 text-slate-700">
            Todos: {completedTodos}/{todos.length} done
          </span>
          <span className="rounded-full bg-white px-3 py-1 text-slate-700">
            Runtime: {runtimeSummary.active} active / {runtimeSummary.warnings} warnings
          </span>
          <span className="rounded-full bg-white px-3 py-1 text-slate-700">
            Linked issues: {runtimeSummary.linkedIssues} ({runtimeSummary.linkedTasks} tasks)
          </span>
          <span className="rounded-full bg-white px-3 py-1 text-slate-700">
            Subagents: {subagents.length} tracked ({subagentSource})
          </span>
          <span className="rounded-full bg-white px-3 py-1 text-slate-700">
            Pending approvals: {pendingApprovals}
          </span>
        </div>
      </section>

      {errorMessage ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">OpenClaw Runtime Tasks</h2>
            <span className="text-xs font-medium text-slate-500">Source: {runtimeSource}</span>
          </div>
          <div className="mb-4 flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              Active: {runtimeSummary.active}
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
              Warnings: {runtimeSummary.warnings}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              Sessions: {runtimeSummary.sessions}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              Subagents: {runtimeSummary.subagents}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              Cron issues: {runtimeSummary.cronIssues}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              Unlinked active: {runtimeSummary.unlinkedActive}
            </span>
          </div>
          {runtimeError ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Runtime task fallback: {runtimeError}
            </p>
          ) : null}
          {runtimeIssues.length > 0 ? (
            <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Linked Issues
              </p>
              <ul className="mt-2 space-y-2">
                {runtimeIssues.map((issue) => (
                  <li
                    key={issue.identifier}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {issue.url ? (
                          <a
                            href={issue.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-semibold text-cyan-700 underline-offset-2 hover:underline"
                          >
                            {issue.identifier}
                          </a>
                        ) : (
                          <span className="text-sm font-semibold text-slate-900">
                            {issue.identifier}
                          </span>
                        )}
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
                          {issue.state}
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
                          {issue.source}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {issue.runningCount} running / {issue.warningCount} warning
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{issue.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {issue.assignee ? `Owner ${issue.assignee} · ` : ''}
                      {issue.taskCount} runtime tasks linked
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mb-3 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
              No runtime tasks linked to Linear issues yet.
            </p>
          )}
          {runtimeTasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              No active OpenClaw tasks right now.
            </p>
          ) : (
            <ul className="space-y-3">
              {runtimeTasks.map((task) => (
                <li
                  key={task.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                        {task.type}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${runtimeStatusStyles[task.status]}`}
                      >
                        {task.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {task.ageMs ? `Age ${formatAge(task.ageMs)}` : '-'}
                    </p>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-800">{task.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{task.detail}</p>
                  {task.issueIdentifier ? (
                    <p className="mt-1 text-xs text-cyan-700">
                      Issue{' '}
                      {task.issueUrl ? (
                        <a
                          href={task.issueUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline-offset-2 hover:underline"
                        >
                          {task.issueIdentifier}
                        </a>
                      ) : (
                        task.issueIdentifier
                      )}
                      {task.issueTitle ? ` · ${task.issueTitle}` : ''}
                      {task.issueState ? ` · ${task.issueState}` : ''}
                      {task.issueAssignee ? ` · owner ${task.issueAssignee}` : ''}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-amber-700">Issue: unlinked</p>
                  )}
                  {task.updatedAt ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Updated {formatTimestamp(task.updatedAt)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Todo List</h2>
            <span className="text-xs font-medium text-slate-500">
              {todos.length} items · {todoSource}
            </span>
          </div>
          {todoError ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Todos fallback active: {todoError}
            </p>
          ) : null}

          <form className="mb-4 flex gap-2" onSubmit={handleCreateTodo}>
            <input
              value={todoDraft}
              onChange={(event) => setTodoDraft(event.target.value)}
              placeholder="Add a task..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:border-cyan-300 focus:ring-2"
            />
            <button
              type="submit"
              className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-800"
            >
              Add
            </button>
          </form>

          <ul className="space-y-2">
            {todos.map((todo) => {
              const isBusy = busyTodoIds.includes(todo.id);
              return (
                <li
                  key={todo.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                >
                  <button
                    type="button"
                    onClick={() => void handleToggleTodo(todo)}
                    disabled={isBusy}
                    className={`mt-0.5 h-5 w-5 rounded-full border text-xs transition ${
                      todo.done
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-slate-300 bg-white text-slate-400'
                    }`}
                    aria-label={todo.done ? 'Mark todo as not done' : 'Mark todo as done'}
                  >
                    {todo.done ? '✓' : ''}
                  </button>
                  <div className="flex-1">
                    <p
                      className={`text-sm ${
                        todo.done ? 'text-slate-500 line-through' : 'text-slate-800'
                      }`}
                    >
                      {todo.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Added {formatTimestamp(todo.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteTodo(todo.id)}
                    disabled={isBusy}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
          {todos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              No todos yet. Add your first mission task.
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Subagent Tracker</h2>
            <span className="text-xs font-medium text-slate-500">
              Source: {subagentSource}
            </span>
          </div>
          {subagentError ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Subagents fallback active: {subagentError}
            </p>
          ) : null}
          {subagents.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              No subagents detected.
            </p>
          ) : (
            <ul className="space-y-3">
              {subagents.map((subagent) => (
                <li
                  key={subagent.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{subagent.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Last heartbeat {formatTimestamp(subagent.lastHeartbeat)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${subagentStatusStyles[subagent.status]}`}
                    >
                      {subagent.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{subagent.output}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Content Approval Queue</h2>
            <div className="text-right">
              <p className="text-xs font-medium text-slate-500">{pendingApprovals} pending</p>
              <p className="text-xs text-slate-500">Source: {approvalsSource}</p>
            </div>
          </div>
          {approvalsError ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Approvals fallback active: {approvalsError}
            </p>
          ) : null}
          <ul className="space-y-3">
            {approvals.map((item) => {
              const isBusy = busyApprovalId === item.id;
              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${contentTypeStyles[item.kind]}`}
                      >
                        {item.kind}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${approvalStatusStyles[item.status]}`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Created {formatTimestamp(item.createdAt)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-800">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500">By {item.creator}</p>
                  {item.status === 'pending' ? (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleApproval(item.id, 'approved')}
                        disabled={isBusy}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleApproval(item.id, 'rejected')}
                        disabled={isBusy}
                        className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500">
                      Decision logged {item.decidedAt ? formatTimestamp(item.decidedAt) : 'just now'}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {approvals.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              Approval queue is empty.
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Automation Control Jobs</h2>
            <span className="text-xs font-medium text-slate-500">Source: {controlSource}</span>
          </div>
          <p className="text-sm text-slate-600">
            One-click trigger for sync/report/watchdog workflows. All actions require one-time
            confirmation code.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={controlConfirmCode}
              onChange={(event) => setControlConfirmCode(event.target.value)}
              placeholder='CONFIRM <CODE>'
              className="w-full max-w-sm rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:border-cyan-300 focus:ring-2"
            />
            <span className="text-xs text-slate-500">
              Generate via <code className="font-mono">npm run tasks -- confirm</code>
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {controlJobCards
              .filter((job) => controlJobs.includes(job.id))
              .map((job) => (
                <article
                  key={job.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <h3 className="text-sm font-semibold text-slate-800">{job.label}</h3>
                  <p className="mt-2 text-sm text-slate-600">{job.description}</p>
                  <button
                    type="button"
                    onClick={() => void handleRunControlJob(job)}
                    disabled={busyControlJobId === job.id}
                    className="mt-4 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyControlJobId === job.id ? 'Running...' : 'Run now'}
                  </button>
                </article>
              ))}
          </div>
          {controlJobs.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              No control jobs available.
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Custom Tools</h2>
            <span className="text-xs text-slate-500">Source: {toolsSource}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Local actions that can later be wired into real backend jobs.
          </p>
          {toolsError ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Tools fallback active: {toolsError}
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {tools.map((tool) => (
              <article
                key={tool.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <h3 className="text-sm font-semibold text-slate-800">{tool.label}</h3>
                <p className="mt-2 text-sm text-slate-600">{tool.description}</p>
                <button
                  type="button"
                  onClick={() => void handleToolTrigger(tool.id)}
                  disabled={busyToolId === tool.id}
                  className="mt-4 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyToolId === tool.id ? 'Running...' : tool.actionLabel}
                </button>
              </article>
            ))}
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Recent Tool Activity</h3>
            <ul className="mt-3 space-y-2">
              {toolActions.map((action) => {
                const artifactPath = action.artifactPath;
                return (
                  <li
                    key={action.id}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
                  >
                    <p className="font-medium text-slate-700">
                      {toolLabelMap.get(action.toolId) ?? action.toolId}
                    </p>
                    <p className="mt-1">{action.summary}</p>
                    <p className="mt-1 text-slate-500">{formatTimestamp(action.createdAt)}</p>
                    {artifactPath ? (
                      <div className="mt-2 space-y-2">
                        <p className="break-all font-mono text-[11px] text-slate-500">
                          {artifactPath}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleCopyArtifactPath(artifactPath)}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-100"
                          >
                            Copy path
                          </button>
                          <a
                            href={buildArtifactUrl(artifactPath, false)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-100"
                          >
                            Open
                          </a>
                          <a
                            href={buildArtifactUrl(artifactPath, true)}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-100"
                          >
                            Download
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {toolActions.length === 0 ? (
              <p className="text-sm text-slate-500">No tool actions yet.</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function sortApprovals(items: ApprovalItem[]): ApprovalItem[] {
  return [...items].sort((left, right) => {
    if (left.status === right.status) {
      return right.createdAt.localeCompare(left.createdAt);
    }
    if (left.status === 'pending') {
      return -1;
    }
    if (right.status === 'pending') {
      return 1;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return dateFormatter.format(timestamp);
}

function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs <= 0) {
    return '-';
  }

  const totalMinutes = Math.floor(ageMs / 60000);
  if (totalMinutes < 1) {
    return '<1m';
  }
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function buildArtifactUrl(artifactPath: string, download: boolean): string {
  const query = new URLSearchParams({ path: artifactPath });
  if (download) {
    query.set('download', '1');
  }
  return `/api/tools/artifact?${query.toString()}`;
}

function copyTextFallback(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('clipboard copy failed');
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function normalizeError(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return 'Request failed';
}

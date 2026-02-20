import { listApprovals, listTodos, listToolActions } from '@/lib/mission-control-store';
import type { RuntimeIssueItem, RuntimeTaskSummary } from '@/lib/mission-control-types';
import { getOpenClawRuntimeSnapshot } from '@/lib/openclaw-runtime';
import { listSubagentsWithFallback } from '@/lib/subagents-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HealthTone = 'ok' | 'warn' | 'neutral';

type HealthCard = {
  label: string;
  value: string;
  detail: string;
  tone: HealthTone;
};

const EMPTY_RUNTIME_SUMMARY: RuntimeTaskSummary = {
  active: 0,
  warnings: 0,
  sessions: 0,
  subagents: 0,
  cronIssues: 0,
  linkedIssues: 0,
  linkedTasks: 0,
  unlinkedActive: 0,
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default async function OpsPage() {
  const [runtimeResult, subagentsResult, todosResult, approvalsResult, toolActionsResult] =
    await Promise.allSettled([
      getOpenClawRuntimeSnapshot(),
      listSubagentsWithFallback(),
      listTodos(),
      listApprovals(),
      listToolActions(),
    ]);

  const runtimeSnapshot =
    runtimeResult.status === 'fulfilled' ? runtimeResult.value : null;
  const runtimeError =
    runtimeResult.status === 'rejected'
      ? normalizeError(runtimeResult.reason)
      : null;
  const runtimeSummary = runtimeSnapshot?.summary ?? EMPTY_RUNTIME_SUMMARY;
  const runtimeTasks = (runtimeSnapshot?.tasks ?? []).slice(0, 15);
  const runtimeIssues: RuntimeIssueItem[] = (runtimeSnapshot?.issues ?? []).slice(0, 10);

  const subagentsPayload =
    subagentsResult.status === 'fulfilled' ? subagentsResult.value : null;
  const subagentsCount = subagentsPayload?.subagents.length ?? 0;
  const subagentsSource = subagentsPayload?.source ?? 'error';
  const subagentsError =
    subagentsResult.status === 'rejected'
      ? normalizeError(subagentsResult.reason)
      : subagentsPayload && !subagentsPayload.ok
        ? subagentsPayload.error
        : null;

  const todos =
    todosResult.status === 'fulfilled' ? todosResult.value : [];
  const todosError =
    todosResult.status === 'rejected'
      ? normalizeError(todosResult.reason)
      : null;

  const approvals =
    approvalsResult.status === 'fulfilled' ? approvalsResult.value : [];
  const approvalsError =
    approvalsResult.status === 'rejected'
      ? normalizeError(approvalsResult.reason)
      : null;

  const toolActions =
    toolActionsResult.status === 'fulfilled' ? toolActionsResult.value : [];
  const toolsError =
    toolActionsResult.status === 'rejected'
      ? normalizeError(toolActionsResult.reason)
      : null;

  const cards: HealthCard[] = [
    {
      label: 'Runtime Active',
      value: String(runtimeSummary.active),
      detail: `${runtimeSummary.sessions} sessions + ${runtimeSummary.subagents} workers`,
      tone: runtimeSummary.active > 0 ? 'ok' : 'neutral',
    },
    {
      label: 'Runtime Warnings',
      value: String(runtimeSummary.warnings),
      detail: `${runtimeSummary.cronIssues} cron issues`,
      tone: runtimeSummary.warnings > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Linked Issues',
      value: String(runtimeSummary.linkedIssues),
      detail: `${runtimeSummary.linkedTasks} tasks linked`,
      tone: runtimeSummary.linkedIssues > 0 ? 'ok' : 'neutral',
    },
    {
      label: 'Subagents API',
      value: String(subagentsCount),
      detail: `source=${subagentsSource}`,
      tone: subagentsError ? 'warn' : 'ok',
    },
    {
      label: 'Todos',
      value: String(todos.filter((item) => !item.done).length),
      detail: `${todos.length} total`,
      tone: todosError ? 'warn' : 'neutral',
    },
    {
      label: 'Approvals Pending',
      value: String(approvals.filter((item) => item.status === 'pending').length),
      detail: `${approvals.length} total`,
      tone: approvalsError ? 'warn' : 'neutral',
    },
    {
      label: 'Tool Actions',
      value: String(toolActions.length),
      detail: 'latest 25 kept in local storage',
      tone: toolsError ? 'warn' : 'neutral',
    },
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl p-6 lg:p-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Operations Health</h1>
        <p className="mt-2 text-sm text-slate-600">
          Runtime snapshot for mission-control and OpenClaw state.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Generated{' '}
          {runtimeSnapshot?.generatedAt
            ? formatTimestamp(runtimeSnapshot.generatedAt)
            : formatTimestamp(new Date().toISOString())}
          {' '}· Runtime source: {runtimeSnapshot?.source ?? 'error'}
        </p>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <article
            key={card.label}
            className={`rounded-xl border p-4 ${
              card.tone === 'ok'
                ? 'border-emerald-200 bg-emerald-50/50'
                : card.tone === 'warn'
                  ? 'border-amber-200 bg-amber-50/60'
                  : 'border-slate-200 bg-white'
            }`}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {card.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
            <p className="mt-1 text-xs text-slate-600">{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Fallback / Errors</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li>
            Runtime: {runtimeError ?? 'ok'}
          </li>
          <li>
            Subagents: {subagentsError ?? 'ok'}
          </li>
          <li>
            Todos: {todosError ?? 'ok'}
          </li>
          <li>
            Approvals: {approvalsError ?? 'ok'}
          </li>
          <li>
            Tools: {toolsError ?? 'ok'}
          </li>
        </ul>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Linked Issues</h2>
        {runtimeIssues.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No linked runtime issues.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {runtimeIssues.map((issue) => (
              <li
                key={issue.identifier}
                className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">
                    {issue.url ? (
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-700 underline-offset-2 hover:underline"
                      >
                        {issue.identifier}
                      </a>
                    ) : (
                      issue.identifier
                    )}
                    {' '}· {issue.state}
                  </p>
                  <p className="text-xs text-slate-500">
                    {issue.runningCount} running / {issue.warningCount} warning
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-600">{issue.title}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Runtime Tasks</h2>
        {runtimeTasks.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No runtime tasks available.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {runtimeTasks.map((task) => (
              <li
                key={task.id}
                className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">{task.title}</p>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      task.status === 'running'
                        ? 'bg-emerald-100 text-emerald-700'
                        : task.status === 'warning'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {task.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{task.detail}</p>
                <p className="mt-1 text-xs text-slate-600">
                  Issue: {task.issueIdentifier ?? 'unlinked'}
                  {task.issueState ? ` · ${task.issueState}` : ''}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {task.updatedAt ? `Updated ${formatTimestamp(task.updatedAt)}` : 'Updated -'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return dateFormatter.format(date);
}

function normalizeError(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return 'request failed';
}

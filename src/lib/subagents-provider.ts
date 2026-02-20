import type { SubagentItem, SubagentStatus } from '@/lib/mission-control-types';

export type SubagentsListResult =
  | { ok: true; subagents: SubagentItem[]; source: 'openclaw' | 'stub' }
  | { ok: false; subagents: SubagentItem[]; source: 'stub'; error: string };

export async function listSubagentsWithFallback(): Promise<SubagentsListResult> {
  const openclawResult = await tryListSubagentsViaOpenClaw();
  if (openclawResult.ok) {
    return openclawResult;
  }

  const stub = await listStubSubagents();
  return {
    ok: false,
    subagents: stub,
    source: 'stub',
    error: openclawResult.error,
  };
}

async function tryListSubagentsViaOpenClaw(): Promise<SubagentsListResult> {
  try {
    const response = await fetch('http://127.0.0.1:31888/api/subagents', {
      cache: 'no-store',
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      const message = payload?.error ?? `openclaw request failed (${response.status})`;
      throw new Error(message);
    }

    const payload = (await response.json()) as { subagents?: unknown };
    const rawSubagents = Array.isArray(payload.subagents)
      ? (payload.subagents as unknown[]).map(coerceSubagent)
      : [];
    const subagents: SubagentItem[] = rawSubagents.filter(
      (item): item is SubagentItem => item !== null,
    );
    return { ok: true, subagents, source: 'openclaw' };
  } catch (error) {
    return {
      ok: false,
      subagents: [],
      source: 'stub',
      error: error instanceof Error ? error.message : 'openclaw request failed',
    };
  }
}

async function listStubSubagents(): Promise<SubagentItem[]> {
  return [
    {
      id: 'stub-intel-scout',
      name: 'intel-scout',
      status: 'running',
      lastHeartbeat: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      output: 'Stub data (openclaw unavailable).',
    },
    {
      id: 'stub-content-drafter',
      name: 'content-drafter',
      status: 'idle',
      lastHeartbeat: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      output: 'Stub data (openclaw unavailable).',
    },
  ];
}

function coerceSubagent(value: unknown): SubagentItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const name = typeof record.name === 'string' ? record.name : null;
  const status = typeof record.status === 'string' ? record.status : null;
  const lastHeartbeat = typeof record.lastHeartbeat === 'string' ? record.lastHeartbeat : null;
  const output = typeof record.output === 'string' ? record.output : '';

  if (!id || !name || !status || !lastHeartbeat) {
    return null;
  }

  if (!isSubagentStatus(status)) {
    return null;
  }

  return {
    id,
    name,
    status,
    lastHeartbeat,
    output,
  };
}

function isSubagentStatus(value: string): value is SubagentStatus {
  return value === 'idle' || value === 'running' || value === 'error' || value === 'offline';
}

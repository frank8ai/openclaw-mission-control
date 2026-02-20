import { NextResponse } from 'next/server';

import { getOpenClawRuntimeSnapshot } from '@/lib/openclaw-runtime';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const snapshot = await getOpenClawRuntimeSnapshot();
    return NextResponse.json({
      ok: true,
      ...snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to load openclaw tasks';
    return NextResponse.json(
      {
        ok: false,
        error: message,
        generatedAt: new Date().toISOString(),
        tasks: [],
        summary: {
          active: 0,
          warnings: 0,
          sessions: 0,
          subagents: 0,
          cronIssues: 0,
        },
        source: 'error',
      },
      { status: 200 },
    );
  }
}

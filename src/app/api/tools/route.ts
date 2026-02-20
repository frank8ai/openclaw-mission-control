import { NextResponse } from 'next/server';

import { getToolCards, listToolActions } from '@/lib/mission-control-store';

export const runtime = 'nodejs';
const SOURCE = 'mission-control-store';

export async function GET() {
  try {
    const tools = getToolCards();
    const actions = await listToolActions();
    return NextResponse.json({
      ok: true,
      source: SOURCE,
      tools,
      actions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to load tools';
    return NextResponse.json({
      ok: false,
      source: SOURCE,
      error: message,
      tools: [],
      actions: [],
    });
  }
}

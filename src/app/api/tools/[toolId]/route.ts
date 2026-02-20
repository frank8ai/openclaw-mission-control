import { NextResponse } from 'next/server';

import { isToolId, triggerToolAction } from '@/lib/mission-control-store';

export const runtime = 'nodejs';
const SOURCE = 'mission-control-store';

export async function POST(
  _request: Request,
  context: { params: Promise<{ toolId: string }> },
) {
  const { toolId } = await context.params;
  if (!isToolId(toolId)) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'tool not found',
      },
      { status: 404 },
    );
  }

  try {
    const action = await triggerToolAction(toolId);
    return NextResponse.json(
      {
        ok: true,
        source: SOURCE,
        action,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to trigger tool';
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: message,
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from 'next/server';

import { decideApproval } from '@/lib/mission-control-store';

export const runtime = 'nodejs';
const SOURCE = 'mission-control-store';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = (await request.json().catch(() => null)) as {
    decision?: unknown;
  } | null;

  const decision = payload?.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: "decision must be 'approved' or 'rejected'",
      },
      { status: 400 },
    );
  }

  const approval = await decideApproval(id, decision);
  if (!approval) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'approval item not found',
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    source: SOURCE,
    approval,
  });
}

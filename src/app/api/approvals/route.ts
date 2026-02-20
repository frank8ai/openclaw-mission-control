import { NextResponse } from 'next/server';

import { listApprovals } from '@/lib/mission-control-store';

export const runtime = 'nodejs';
const SOURCE = 'mission-control-store';

export async function GET() {
  try {
    const approvals = await listApprovals();
    return NextResponse.json({
      ok: true,
      source: SOURCE,
      approvals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to load approvals';
    return NextResponse.json({
      ok: false,
      source: SOURCE,
      error: message,
      approvals: [],
    });
  }
}

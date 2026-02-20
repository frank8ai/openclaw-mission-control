import { NextResponse } from 'next/server';

import { listSubagentsWithFallback } from '@/lib/subagents-provider';

export const runtime = 'nodejs';

export async function GET() {
  const result = await listSubagentsWithFallback();
  return NextResponse.json({
    subagents: result.subagents,
    source: result.source,
    ok: result.ok,
    ...(result.ok ? {} : { error: result.error }),
  });
}

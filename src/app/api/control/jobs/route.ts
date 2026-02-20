import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOURCE = 'control-center-cli';
const ALLOWED_JOBS = [
  'github-sync',
  'todoist-sync',
  'calendar-sync',
  'watchdog',
  'report',
  'briefing',
  'remind',
] as const;

type AllowedJob = (typeof ALLOWED_JOBS)[number];

type TriggerBody = {
  jobId?: string;
  confirm?: string;
  send?: boolean;
  mode?: string;
  autoLinear?: boolean;
  toLinear?: boolean;
};

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: SOURCE,
    jobs: ALLOWED_JOBS,
  });
}

export async function POST(request: Request) {
  let body: TriggerBody = {};
  try {
    body = (await request.json()) as TriggerBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'invalid json body',
      },
      { status: 400 },
    );
  }

  const jobId = String(body.jobId || '').trim() as AllowedJob;
  if (!ALLOWED_JOBS.includes(jobId)) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'job not allowed',
      },
      { status: 400 },
    );
  }

  const confirm = String(body.confirm || '').trim();
  if (!confirm) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'confirm code required',
      },
      { status: 400 },
    );
  }

  const rootDir = process.cwd();
  const scriptPath = path.join(rootDir, 'scripts', 'tasks.js');
  const args = ['trigger', jobId, '--confirm', confirm, '--json'];

  if (body.send) {
    args.push('--send');
  }
  if (body.mode) {
    args.push('--mode', String(body.mode));
  }
  if (body.autoLinear) {
    args.push('--auto-linear');
  }
  if (body.toLinear) {
    args.push('--to-linear');
  }

  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: result.error.message,
      },
      { status: 500 },
    );
  }

  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: stderr || stdout || `trigger failed (${result.status})`,
      },
      { status: 500 },
    );
  }

  const stdout = String(result.stdout || '').trim();
  let payload: unknown = null;
  try {
    payload = stdout ? JSON.parse(stdout) : null;
  } catch {
    payload = stdout;
  }

  return NextResponse.json({
    ok: true,
    source: SOURCE,
    jobId,
    payload,
  });
}

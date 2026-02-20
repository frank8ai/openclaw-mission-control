import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

const ROOT_DIR = process.cwd();
const STUBS_ROOT = path.resolve(ROOT_DIR, 'data', 'mission-control', 'stubs');
const SOURCE = 'mission-control-store';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedPath = url.searchParams.get('path')?.trim() ?? '';
  const download = url.searchParams.get('download') === '1';

  if (!requestedPath) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'path is required',
      },
      { status: 400 },
    );
  }

  const resolvedPath = resolveArtifactPath(requestedPath);
  if (!resolvedPath) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'artifact path is outside allowed stubs directory',
      },
      { status: 400 },
    );
  }

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      return NextResponse.json(
        {
          ok: false,
          source: SOURCE,
          error: 'artifact is not a file',
        },
        { status: 404 },
      );
    }

    const content = await fs.readFile(resolvedPath);
    const fileName = path.basename(resolvedPath);
    const headers = new Headers();
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Type', mimeTypeForFile(fileName));
    headers.set('Content-Disposition', contentDisposition(fileName, download));

    return new NextResponse(content, {
      status: 200,
      headers,
    });
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : '';
    if (code === 'ENOENT') {
      return NextResponse.json(
        {
          ok: false,
          source: SOURCE,
          error: 'artifact not found',
        },
        { status: 404 },
      );
    }

    const message = error instanceof Error ? error.message : 'failed to open artifact';
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

function resolveArtifactPath(input: string): string | null {
  if (!input || input.includes('\0')) {
    return null;
  }

  const resolved = path.resolve(ROOT_DIR, input);
  const allowedPrefix = `${STUBS_ROOT}${path.sep}`;
  if (resolved !== STUBS_ROOT && !resolved.startsWith(allowedPrefix)) {
    return null;
  }
  return resolved;
}

function contentDisposition(fileName: string, download: boolean): string {
  const safeName = fileName.replace(/["\\]/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${safeName}"`;
}

function mimeTypeForFile(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.md') {
    return 'text/markdown; charset=utf-8';
  }
  if (ext === '.json') {
    return 'application/json; charset=utf-8';
  }
  if (ext === '.txt') {
    return 'text/plain; charset=utf-8';
  }
  return 'application/octet-stream';
}

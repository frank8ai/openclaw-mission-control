import { NextResponse } from 'next/server';

import { createTodo, listTodos } from '@/lib/mission-control-store';

export const runtime = 'nodejs';
const SOURCE = 'mission-control-store';

export async function GET() {
  try {
    const todos = await listTodos();
    return NextResponse.json({
      ok: true,
      source: SOURCE,
      todos,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to load todos';
    return NextResponse.json({
      ok: false,
      source: SOURCE,
      error: message,
      todos: [],
    });
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as { title?: unknown } | null;
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';

  if (!title) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'title is required',
      },
      { status: 400 },
    );
  }

  try {
    const todo = await createTodo(title);
    return NextResponse.json(
      {
        ok: true,
        source: SOURCE,
        todo,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to create todo';
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

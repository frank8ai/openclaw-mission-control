import { NextResponse } from 'next/server';

import { removeTodo, updateTodo } from '@/lib/mission-control-store';

export const runtime = 'nodejs';
const SOURCE = 'mission-control-store';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = (await request.json().catch(() => null)) as {
    done?: unknown;
    title?: unknown;
  } | null;

  const updates: { done?: boolean; title?: string } = {};
  if (typeof payload?.done === 'boolean') {
    updates.done = payload.done;
  }
  if (typeof payload?.title === 'string') {
    const title = payload.title.trim();
    if (!title) {
      return NextResponse.json(
        {
          ok: false,
          source: SOURCE,
          error: 'title cannot be empty',
        },
        { status: 400 },
      );
    }
    updates.title = title;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'no valid updates supplied',
      },
      { status: 400 },
    );
  }

  const todo = await updateTodo(id, updates);
  if (!todo) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'todo not found',
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    source: SOURCE,
    todo,
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const deleted = await removeTodo(id);
  if (!deleted) {
    return NextResponse.json(
      {
        ok: false,
        source: SOURCE,
        error: 'todo not found',
      },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    source: SOURCE,
  });
}

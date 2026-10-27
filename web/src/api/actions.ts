import type { ActionName, ActionParams, ActionPreview, ActionResult } from '../types';
import { useWorld } from '../store';
import { mockPreview, mockRun } from '../mock/actions';
import { forwardMockFocus } from './focusBridge';

const isMock = () => useWorld.getState().mock;

function toQuery(action: ActionName, params: ActionParams): string {
  const qs = new URLSearchParams({ action });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  return qs.toString();
}

export async function previewAction(action: ActionName, params: ActionParams): Promise<ActionPreview> {
  if (isMock()) {
    await new Promise((r) => setTimeout(r, 150));
    return mockPreview(action, params);
  }
  // nested params (run_command's values) do not fit a query string, so they go as a JSON body
  const nested = Object.values(params).some((v) => v !== null && typeof v === 'object');
  const res = nested
    ? await fetch('/api/actions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, params }) })
    : await fetch(`/api/actions/preview?${toQuery(action, params)}`);
  let body: Partial<ActionPreview> = {};
  try {
    body = (await res.json()) as Partial<ActionPreview>;
  } catch {
    throw new Error(`Preview failed: HTTP ${res.status}`);
  }
  if (!res.ok && !body.error) body.error = `HTTP ${res.status}`;
  return {
    command: body.command ?? null,
    warnings: body.warnings ?? [],
    error: body.error ?? null,
    facts: body.facts ?? {},
    url: body.url ?? null,
    confirm: body.confirm ?? (action === 'merge' ? 'typed' : 'tap'),
  };
}

export async function runAction(action: ActionName, params: ActionParams): Promise<ActionResult> {
  if (isMock()) {
    if (action === 'focus') forwardMockFocus(params); // capture-only bridge; inert unless dev + ?focusbridge=
    await new Promise((r) => setTimeout(r, 450));
    return mockRun(action, params);
  }
  const res = await fetch('/api/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params, ...params }),
  });
  let body: Partial<ActionResult> = {};
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: `HTTP ${res.status}` };
  }
  return {
    ok: !!body.ok && res.ok,
    output: body.output ?? '',
    error: body.error ?? (res.ok ? null : `HTTP ${res.status}`),
    ...(body.landed !== undefined ? { landed: body.landed } : {}),
    ...(body.echo !== undefined ? { echo: body.echo } : {}),
    ...(body.draft !== undefined ? { draft: body.draft } : {}),
  };
}

import { useWorld } from '../store';
import type { DropSpec, Grant, GrantMode, LibraryData, LibraryItem } from '../lib/library';
import * as mock from '../mock/library';

/* Context library endpoints (CONTRACT "Context library"). Mock mode answers from an in-memory library. */

const isMock = () => useWorld.getState().mock;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BrowseEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
}
export interface BrowseResult {
  path: string | null;
  parent: string | null;
  prefix?: string;
  roots: string[];
  entries: BrowseEntry[];
  truncated?: boolean;
}
export interface ResolveResult {
  name: string;
  kind: 'file' | 'dir' | null;
  matches: string[];
  status: 'one' | 'many' | 'none';
}
export interface ItemInput {
  id?: string;
  name: string;
  description?: string;
  paths: string[];
  tags?: string[];
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let out: Record<string, unknown> = {};
  try {
    out = await res.json();
  } catch {
    /* empty or not JSON */
  }
  if (!res.ok || out.ok === false) throw new Error(typeof out.error === 'string' ? out.error : `HTTP ${res.status}`);
  return out as T;
}

export async function fetchLibrary(): Promise<LibraryData> {
  if (isMock()) return delay(80).then(mock.view);
  const d = await call<LibraryData>('GET', '/api/library');
  return { items: d.items ?? [], grants: d.grants ?? [], deliveries: d.deliveries ?? [], owed: d.owed ?? {}, file: d.file ?? null, error: d.error ?? null };
}

export async function saveItem(item: ItemInput): Promise<LibraryItem> {
  if (isMock()) return delay(80).then(() => mock.upsertItem(item));
  return (await call<{ result: LibraryItem }>('POST', '/api/library/items', item)).result;
}

export async function deleteItem(id: string): Promise<void> {
  if (isMock()) return delay(60).then(() => mock.deleteItem(id));
  await call('DELETE', `/api/library/items/${encodeURIComponent(id)}`);
}

export async function addGrant(item_id: string, target: string, mode: GrantMode): Promise<Grant> {
  if (isMock()) return delay(60).then(() => mock.addGrant(item_id, target, mode));
  return (await call<{ result: Grant }>('POST', '/api/library/grants', { item_id, target, mode })).result;
}

export async function deleteGrant(id: string): Promise<void> {
  if (isMock()) return delay(60).then(() => mock.deleteGrant(id));
  await call('DELETE', `/api/library/grants/${encodeURIComponent(id)}`);
}

export async function browse(path: string, hidden = false): Promise<BrowseResult> {
  if (isMock()) return delay(40).then(() => mock.browse(path, hidden));
  const qs = new URLSearchParams({ path, ...(hidden ? { hidden: '1' } : {}) });
  return call<BrowseResult>('GET', `/api/library/browse?${qs}`);
}

export async function resolveDrop(entries: DropSpec[]): Promise<ResolveResult[]> {
  if (isMock()) return delay(250).then(() => mock.resolve(entries));
  return (await call<{ results: ResolveResult[] }>('POST', '/api/library/resolve', { entries })).results;
}

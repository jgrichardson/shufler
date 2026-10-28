import { dispatch, useWorld } from '../store';
import { composeMessage, computeOwed, harnessFor, type Delivery, type DropSpec, type Grant, type GrantMode, type LibraryData, type LibraryItem, type LibraryField, type PathStatus } from '../lib/library';
import type { Snapshot } from '../types';
import { CLI_NAME } from '../lib/brand';

/* In-memory context library for ?mock=1: a fake home with a widgets repo, two items, a few grants. */

export const MOCK_HOME = '/Users/demo';
const W = `${MOCK_HOME}/worktrees/widgets`;
const FILES: [string, number][] = [
  [`${W}/README.md`, 4210],
  [`${W}/CLAUDE.md`, 6120],
  [`${W}/docs/context/auth/README.md`, 3880],
  [`${W}/docs/context/auth/session-rules.md`, 12400],
  [`${W}/docs/context/auth/token-policy.md`, 20950],
  [`${W}/docs/context/auth/sso/providers.md`, 8800],
  [`${W}/docs/context/billing/README.md`, 2900],
  [`${W}/docs/context/billing/proration.md`, 5400],
  [`${W}/docs/glossary/billing.md`, 9100],
  [`${W}/app/models/workspace.rb`, 3300],
  [`${MOCK_HOME}/notes/todo.md`, 1200],
  [`${MOCK_HOME}/Downloads/pricing-page-draft.pdf`, 482000],
];

function status(path: string): PathStatus {
  const f = FILES.find(([p]) => p === path);
  if (f) return { path, exists: true, kind: 'file', size: f[1], files: null, truncated: false };
  const under = FILES.filter(([p]) => p.startsWith(path + '/'));
  if (under.length) return { path, exists: true, kind: 'dir', size: under.reduce((a, [, n]) => a + n, 0), files: under.length, truncated: false };
  return { path, exists: false, kind: null, size: null, files: null, truncated: false };
}

const T0 = Date.now() / 1000;
let seq = 3;
const state: { items: LibraryItem[]; grants: Grant[]; deliveries: Delivery[] } = {
  items: [
    { id: 'lib_0000a001', name: 'Auth context', description: 'Session rules, token policy and the SSO provider notes the auth session works from.', paths: [`${W}/docs/context/auth`], tags: ['auth', 'docs'], created: T0 - 86400 * 3, updated: T0 - 86400 },
    { id: 'lib_0000a002', name: 'Billing glossary', description: '', paths: [`${W}/docs/glossary/billing.md`, `${W}/docs/context/billing/proration.md`, `${MOCK_HOME}/notes/pricing.md`], tags: ['billing'], created: T0 - 86400 * 2, updated: T0 - 3600 },
    { id: 'lib_0000a003', name: 'House rules', description: 'The repo CLAUDE.md, for sessions started outside the repo.', paths: [`${W}/CLAUDE.md`], tags: ['rules'], created: T0 - 86400, updated: T0 - 86400 },
  ],
  grants: [
    { id: 'gr_0000b001', item_id: 'lib_0000a001', target: 'domain:auth', mode: 'pinned', created: T0 - 86400 },
    { id: 'gr_0000b002', item_id: 'lib_0000a002', target: 'station:ws-ac', mode: 'pinned', created: T0 - 7200 },
    { id: 'gr_0000b003', item_id: 'lib_0000a002', target: 'station:ws-cr', mode: 'pinned', created: T0 - 7200 },
  ],
  deliveries: [
    // AUTH already has its pinned context this session; Invoice emails got the glossary too
    { item_id: 'lib_0000a001', station_id: 'ws-pf', session_id: 'sess-ws-pf', compactions: 99, ts: T0 - 60 },
    { item_id: 'lib_0000a002', station_id: 'ws-cr', session_id: 'sess-ws-cr', compactions: 99, ts: T0 - 120 },
  ],
};

const snap = () => useWorld.getState().snapshot;
const stations = (s: Snapshot | null) => [...(s?.stations ?? []), ...(s?.utility_stations ?? []).map((u) => ({ ...u, utility: true }))];

export function mockField(s: Snapshot | null): LibraryField {
  return { items: state.items.length, owed: computeOwed(state, stations(s)) };
}

/** Re-derive owed on the current snapshot after a mock write, as the daemon does. */
function push() {
  const s = snap();
  if (s) dispatch({ type: 'snapshot', snapshot: { ...s, library: mockField(s) }, at: Date.now() });
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function view(): LibraryData {
  return { ...clone(state), items: state.items.map((it) => ({ ...clone(it), status: it.paths.map(status) })), owed: mockField(snap()).owed, file: `${MOCK_HOME}/.config/${CLI_NAME}/library.json (mock)`, error: null };
}

export function upsertItem(input: { id?: string; name: string; description?: string; paths: string[]; tags?: string[] }): LibraryItem {
  if (!input.name.trim()) throw new Error('name is required');
  if (!input.paths.length) throw new Error('paths must be a list of 1 to 50 absolute paths');
  const paths = [...new Set(input.paths.map((p) => p.replace(/^~(?=\/|$)/, MOCK_HOME)))];
  if (paths.some((p) => !p.startsWith('/'))) throw new Error('path must be absolute');
  const now = Date.now() / 1000;
  const cur = input.id ? state.items.find((i) => i.id === input.id) : undefined;
  const fields = { name: input.name.trim(), description: input.description?.trim() ?? '', paths, tags: (input.tags ?? []).map((t) => t.toLowerCase()) };
  let out: LibraryItem;
  if (cur) out = Object.assign(cur, fields, { updated: now });
  else state.items.push((out = { id: `lib_0000a${String(++seq).padStart(3, '0')}`, ...fields, created: now, updated: now }));
  push();
  return clone(out);
}

export function deleteItem(id: string) {
  state.items = state.items.filter((i) => i.id !== id);
  state.grants = state.grants.filter((g) => g.item_id !== id);
  push();
}

export function addGrant(item_id: string, target: string, mode: GrantMode): Grant {
  const now = Date.now() / 1000;
  let g = state.grants.find((x) => x.item_id === item_id && x.target === target);
  if (g) Object.assign(g, { mode, created: now });
  else state.grants.push((g = { id: `gr_0000b${String(++seq).padStart(3, '0')}`, item_id, target, mode, created: now }));
  push();
  return clone(g);
}

export function deleteGrant(id: string) {
  state.grants = state.grants.filter((g) => g.id !== id);
  push();
}

/** Composes what library_send would type, for the mock confirm panel. */
export function composeFor(stationId: string, ids: string[], note?: string): { lines: string[]; harness: string; items: LibraryItem[]; missing: string[] } {
  const st = stations(snap()).find((s) => s.id === stationId);
  const items = ids.map((id) => state.items.find((i) => i.id === id)).filter((x): x is LibraryItem => !!x).map((it) => ({ ...it, status: it.paths.map(status) }));
  const harness = harnessFor({ title: st?.title, harness: st && 'harness' in st ? st.harness : null });
  const cwd = (st && 'cwd' in st ? st.cwd : null)?.replace(/^~(?=\/|$)/, MOCK_HOME) ?? null;
  const missing = items.flatMap((it) => it.status.filter((s) => !s.exists).map((s) => s.path));
  return { lines: composeMessage(harness, items, cwd, note), harness, items, missing };
}

export function recordSend(stationId: string, ids: string[]) {
  const st = snap()?.stations.find((s) => s.id === stationId);
  const now = Date.now() / 1000;
  for (const id of ids) state.deliveries.push({ item_id: id, station_id: stationId, session_id: st?.session_id ?? null, compactions: st?.telemetry?.compactions ?? null, ts: now });
  push();
}

function listing(dir: string): { name: string; path: string; kind: 'file' | 'dir' }[] {
  const names = new Map<string, 'file' | 'dir'>();
  for (const [p] of FILES) {
    if (!p.startsWith(dir + '/')) continue;
    const rest = p.slice(dir.length + 1).split('/');
    names.set(rest[0], rest.length > 1 ? 'dir' : 'file');
  }
  return [...names].map(([name, kind]) => ({ name, path: `${dir}/${name}`, kind })).sort((a, b) => Number(a.kind !== 'dir') - Number(b.kind !== 'dir') || a.name.localeCompare(b.name));
}

export function browse(raw: string, hidden = false) {
  const roots = [MOCK_HOME];
  if (!raw) return { path: null, parent: null, roots, entries: roots.map((r) => ({ name: r, path: r, kind: 'dir' as const })) };
  const p = raw.replace(/^~(?=\/|$)/, MOCK_HOME).replace(/\/+$/, '') || '/';
  if (p.split('/').includes('..')) throw new Error('path may not contain ..');
  if (!(p === MOCK_HOME || p.startsWith(MOCK_HOME + '/'))) throw new Error('outside home and the session working directories');
  const isDir = status(p).kind === 'dir' || p === MOCK_HOME;
  const dir = isDir ? p : p.slice(0, p.lastIndexOf('/')) || '/';
  const prefix = isDir ? '' : p.slice(p.lastIndexOf('/') + 1);
  const entries = listing(dir).filter((e) => (hidden || !e.name.startsWith('.')) && e.name.toLowerCase().startsWith(prefix.toLowerCase()));
  return { path: dir, prefix, parent: dir === MOCK_HOME ? null : dir.slice(0, dir.lastIndexOf('/')), roots, entries };
}

export function resolve(entries: DropSpec[]) {
  const all = new Set<string>();
  for (const [p] of FILES) {
    const parts = p.split('/');
    for (let i = 2; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  return entries.map((e) => {
    const matches = [...all].filter((p) => p.endsWith('/' + e.name) && (!e.kind || status(p).kind === e.kind));
    return { name: e.name, kind: e.kind, matches, status: (matches.length === 1 ? 'one' : matches.length ? 'many' : 'none') as 'one' | 'many' | 'none' };
  });
}

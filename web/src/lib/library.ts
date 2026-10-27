/*
 * Context library (design/LIBRARY.md): pure helpers shared by the drawer, the session panel, the mock and
 * the tests. The daemon is the source of truth; composeMessage and computeOwed mirror daemon/shufler/library.py
 * so mock mode and the confirm panel's preview read the same.
 */

export interface PathStatus {
  path: string;
  exists: boolean;
  kind: 'file' | 'dir' | 'other' | null;
  size: number | null;
  files: number | null;
  truncated: boolean;
}

export interface LibraryItem {
  id: string;
  name: string;
  description: string;
  paths: string[];
  tags: string[];
  created: number;
  updated: number;
  status?: PathStatus[];
}

export type GrantMode = 'pinned' | 'once';

export interface Grant {
  id: string;
  item_id: string;
  /** all | station:<id> | domain:<id> */
  target: string;
  mode: GrantMode;
  created: number;
}

export interface Delivery {
  item_id: string;
  station_id: string;
  session_id: string | null;
  compactions: number | null;
  ts: number;
}

export interface LibraryData {
  items: LibraryItem[];
  grants: Grant[];
  deliveries: Delivery[];
  owed: Record<string, string[]>;
  file?: string | null;
  error?: string | null;
}

/** The snapshot's `library` field: item count and, per station, the granted item ids it has not received. */
export interface LibraryField {
  items: number;
  owed: Record<string, string[]>;
}

export const EMPTY_FIELD: LibraryField = { items: 0, owed: {} };

export function normalizeLibraryField(raw: unknown): LibraryField {
  if (!raw || typeof raw !== 'object') return EMPTY_FIELD;
  const r = raw as Record<string, unknown>;
  const owed: Record<string, string[]> = {};
  if (r.owed && typeof r.owed === 'object') {
    for (const [k, v] of Object.entries(r.owed as Record<string, unknown>)) {
      const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      if (ids.length) owed[k] = ids;
    }
  }
  return { items: typeof r.items === 'number' ? r.items : 0, owed };
}

export function parseTarget(target: string): { kind: 'all' | 'station' | 'domain'; id: string } {
  if (target === 'all') return { kind: 'all', id: '' };
  const i = target.indexOf(':');
  const kind = target.slice(0, i);
  return { kind: kind === 'domain' ? 'domain' : 'station', id: target.slice(i + 1) };
}

/** Station-shaped enough for grant matching and composition. */
export interface StationLike {
  id: string;
  title?: string;
  domain?: string | null;
  cwd?: string | null;
  session_id?: string | null;
  utility?: boolean;
  claude?: { running: boolean } | null;
  telemetry?: { session_started_at?: string | number | null; compactions?: number | null } | null;
}

export function grantMatches(target: string, st: StationLike): boolean {
  if (target === `station:${st.id}`) return true;
  if (st.utility) return false; // SHARED / CODEX style tools only take explicit station grants
  if (target === 'all') return true;
  return !!st.domain && target === `domain:${st.domain}`;
}

const started = (st: StationLike): number | null => {
  const v = st.telemetry?.session_started_at;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t / 1000;
  }
  return null;
};

/** Same rule as the daemon: same session, sent after it started, and no compaction since. */
export function deliveryCurrent(d: Delivery, st: StationLike): boolean {
  if (st.session_id && d.session_id && d.session_id !== st.session_id) return false;
  const s = started(st);
  if (s && d.ts < s) return false;
  const c = st.telemetry?.compactions;
  if (typeof c === 'number' && c > (d.compactions ?? 0)) return false;
  return true;
}

export function computeOwed(data: Pick<LibraryData, 'items' | 'grants' | 'deliveries'>, stations: StationLike[]): Record<string, string[]> {
  const ids = new Set(data.items.map((i) => i.id));
  const grants = data.grants.filter((g) => ids.has(g.item_id));
  const out: Record<string, string[]> = {};
  if (!grants.length) return out;
  for (const st of stations) {
    if (st.claude && !st.claude.running) continue;
    const mine = data.deliveries.filter((d) => d.station_id === st.id);
    const want: string[] = [];
    for (const g of grants) {
      if (want.includes(g.item_id) || !grantMatches(g.target, st)) continue;
      const got = mine.filter((d) => d.item_id === g.item_id);
      const done = g.mode === 'once' ? got.some((d) => d.ts >= g.created) : got.some((d) => deliveryCurrent(d, st));
      if (!done) want.push(g.item_id);
    }
    if (want.length) out[st.id] = want;
  }
  return out;
}

export function harnessFor(st: Pick<StationLike, 'title'>): 'claude-code' | 'codex' {
  return /codex/i.test(st.title ?? '') ? 'codex' : 'claude-code';
}

const norm = (p: string) => p.replace(/\/+$/, '') || '/';
const inside = (p: string, root: string | null | undefined) => !!root && (p === norm(root) || p.startsWith(norm(root) + '/'));

function prompt(parts: string[], note?: string | null): string {
  const n = note?.trim().replace(/\.$/, '');
  return `Context from the library: ${parts.join('; ')}.${n ? ` ${n}.` : ''} Read these before continuing.`;
}

/** One adapter per harness: Claude Code gets `/add-dir` for outside folders then @-mentions; others get plain paths. */
export function composeMessage(harness: string, items: Pick<LibraryItem, 'name' | 'paths' | 'status'>[], cwd: string | null | undefined, note?: string | null): string[] {
  const kind = (it: Pick<LibraryItem, 'status'>, p: string) => it.status?.find((s) => s.path === p)?.kind ?? null;
  if (harness !== 'claude-code') return [prompt(items.map((it) => `${it.name}: ${it.paths.join(' ')}`), note)];
  let dirs = [...new Set(items.flatMap((it) => it.paths.filter((p) => kind(it, p) === 'dir' && !inside(p, cwd))))];
  dirs = dirs.filter((d) => !dirs.some((o) => o !== d && inside(d, o)));
  const mention = (p: string) => {
    const rel = cwd && inside(p, cwd) && p !== norm(cwd) ? p.slice(norm(cwd).length + 1) : p;
    return /\s/.test(rel) ? `@"${rel}"` : `@${rel}`;
  };
  return [...dirs.map((d) => `/add-dir ${d}`), prompt(items.map((it) => `${it.name}: ${it.paths.map(mention).join(' ')}`), note)];
}

export interface ContextRow {
  item: LibraryItem;
  /** Grants that reach this station (own, its domain, or all). */
  grants: Grant[];
  pinned: boolean;
  sentAt: number | null;
  owed: boolean;
}

/** What a session has: every item granted to it or sent to it, owed first. */
export function stationContext(st: StationLike, data: Pick<LibraryData, 'items' | 'grants' | 'deliveries'>, owed: string[] = []): ContextRow[] {
  const rows: ContextRow[] = [];
  for (const item of data.items) {
    const grants = data.grants.filter((g) => g.item_id === item.id && grantMatches(g.target, st));
    const sent = data.deliveries.filter((d) => d.item_id === item.id && d.station_id === st.id);
    if (!grants.length && !sent.length) continue;
    rows.push({ item, grants, pinned: grants.some((g) => g.mode === 'pinned'), sentAt: sent.length ? Math.max(...sent.map((d) => d.ts)) : null, owed: owed.includes(item.id) });
  }
  return rows.sort((a, b) => Number(b.owed) - Number(a.owed) || a.item.name.localeCompare(b.item.name));
}

export function filterItems(items: LibraryItem[], q: string): LibraryItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const hay = [it.name, it.description, ...it.tags, ...it.paths].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Absolute paths in dropped text: file:// URIs (uri-list) or plain lines starting with / or ~. */
export function parseDroppedText(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('file://')) {
      try {
        const u = new URL(line);
        if (!u.host || u.host === 'localhost') out.push(decodeURIComponent(u.pathname));
      } catch {
        /* not a URL */
      }
    } else if (/^(\/|~\/)/.test(line) && !line.includes('\0')) out.push(line.replace(/^'(.*)'$/, '$1'));
  }
  return [...new Set(out)];
}

export interface DropSpec {
  name: string;
  kind: 'file' | 'dir';
  children: string[];
}

/** What the browser can say about a drop (names, not paths) as resolve entries; a few child names help pick the right folder. */
export function dropSpecs(entries: { name: string; isDirectory: boolean; children?: string[] }[]): DropSpec[] {
  const seen = new Set<string>();
  const out: DropSpec[] = [];
  for (const e of entries) {
    const name = e.name.replace(/^\/+|\/+$/g, '');
    if (!name || name.split('/').includes('..') || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, kind: e.isDirectory ? 'dir' : 'file', children: (e.children ?? []).filter((c) => c && !c.startsWith('.')).slice(0, 3) });
  }
  return out;
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function statusText(s: PathStatus | undefined): string {
  if (!s) return '';
  if (!s.exists) return 'missing';
  if (s.kind === 'dir') return `${s.files ?? 0}${s.truncated ? '+' : ''} files · ${formatSize(s.size)}`;
  return formatSize(s.size);
}

/** `~` for the home prefix, so cards stay short. */
export function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

/** Sessions still owed pinned context, from the snapshot's `library.owed`. */
export function owedSessions(owed: Record<string, string[]> | null | undefined): number {
  return Object.values(owed ?? {}).filter((ids) => ids.length > 0).length;
}

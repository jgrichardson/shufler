import { describe, expect, it } from 'vitest';
import { composeMessage, computeOwed, dropSpecs, filterItems, grantMatches, normalizeLibraryField, parseDroppedText, stationContext, statusText, type LibraryData, type LibraryItem } from '../src/lib/library';
import { parsePrefs } from '../src/ui/prefs';

const item = (id: string, name: string, paths: string[], kinds: Record<string, 'file' | 'dir'> = {}): LibraryItem => ({
  id,
  name,
  description: '',
  paths,
  tags: [],
  created: 0,
  updated: 0,
  status: paths.map((p) => ({ path: p, exists: true, kind: kinds[p] ?? 'file', size: 10, files: null, truncated: false })),
});

describe('composeMessage (mirrors daemon library.compose)', () => {
  const items = [item('a', 'Auth', ['/r/docs/ctx', '/shared/specs', '/shared/specs/sub'], { '/r/docs/ctx': 'dir', '/shared/specs': 'dir', '/shared/specs/sub': 'dir' }), item('b', 'Glossary', ['/r/g lossary.md', '/elsewhere/file.md'])];
  it('claude code: /add-dir for outside folders only, outermost, then one @-mention prompt', () => {
    const lines = composeMessage('claude-code', items, '/r', 'Focus on totals');
    expect(lines.slice(0, -1)).toEqual(['/add-dir /shared/specs']);
    expect(lines.at(-1)).toBe('Context from the library: Auth: @docs/ctx @/shared/specs @/shared/specs/sub; Glossary: @"g lossary.md" @/elsewhere/file.md. Focus on totals. Read these before continuing.');
  });
  it('codex and others: plain paths, no /add-dir', () => {
    expect(composeMessage('codex', [items[0]], '/r')).toEqual(['Context from the library: Auth: /r/docs/ctx /shared/specs /shared/specs/sub. Read these before continuing.']);
  });
});

describe('owed mapping', () => {
  const data: Pick<LibraryData, 'items' | 'grants' | 'deliveries'> = {
    items: [item('a', 'A', ['/a']), item('b', 'B', ['/b']), item('c', 'C', ['/c'])],
    grants: [
      { id: 'g1', item_id: 'a', target: 'domain:auth', mode: 'pinned', created: 0 },
      { id: 'g2', item_id: 'b', target: 'all', mode: 'pinned', created: 0 },
      { id: 'g3', item_id: 'c', target: 'station:X', mode: 'once', created: 50 },
      { id: 'g4', item_id: 'gone', target: 'all', mode: 'pinned', created: 0 },
    ],
    deliveries: [{ item_id: 'a', station_id: 'P', session_id: 's1', compactions: 0, ts: 2000 }],
  };
  const P = { id: 'P', domain: 'auth', session_id: 's1', telemetry: { session_started_at: 1000, compactions: 0 }, claude: { running: true } };
  const X = { id: 'X', utility: true, session_id: null };
  it('pinned until a current delivery; utility only by explicit station grant; deleted items ignored', () => {
    expect(computeOwed(data, [P, X])).toEqual({ P: ['b'], X: ['c'] });
  });
  it('a new session or a compaction makes pinned context owed again', () => {
    expect(computeOwed(data, [{ ...P, session_id: 's2' }]).P).toEqual(['a', 'b']);
    expect(computeOwed(data, [{ ...P, telemetry: { session_started_at: 1000, compactions: 1 } }]).P).toEqual(['a', 'b']);
  });
  it('closed workspaces owe nothing; once is done after any later delivery', () => {
    expect(computeOwed(data, [{ ...P, claude: { running: false } }])).toEqual({});
    expect(computeOwed({ ...data, deliveries: [{ item_id: 'c', station_id: 'X', session_id: null, compactions: null, ts: 60 }] }, [X])).toEqual({});
  });
  it('grant matching and the session context rows', () => {
    expect(grantMatches('all', { id: 'X', utility: true })).toBe(false);
    expect(grantMatches('domain:auth', P)).toBe(true);
    const rows = stationContext(P, data, ['b']);
    expect(rows.map((r) => [r.item.id, r.owed, r.pinned, r.sentAt])).toEqual([
      ['b', true, true, null],
      ['a', false, true, 2000],
    ]);
  });
  it('normalizes the snapshot field', () => {
    expect(normalizeLibraryField({ items: 2, owed: { P: ['a', 3], Q: [] } })).toEqual({ items: 2, owed: { P: ['a'] } });
    expect(normalizeLibraryField(null)).toEqual({ items: 0, owed: {} });
  });
});

describe('drop handling', () => {
  it('takes absolute paths from uri-lists and plain text, nothing relative', () => {
    expect(parseDroppedText('# comment\nfile:///Users/demo/My%20Docs/a.md\nfile://otherhost/x\n/abs/b\n~/c\nrelative/d\n/abs/b')).toEqual(['/Users/demo/My Docs/a.md', '/abs/b', '~/c']);
  });
  it('turns dropped entries into resolve specs, dropping dotfile hints, .. and duplicates', () => {
    expect(dropSpecs([{ name: '/auth_service/', isDirectory: true, children: ['.DS_Store', 'README.md', 'a', 'b', 'c'] }, { name: 'x.md', isDirectory: false }, { name: '../up', isDirectory: true }, { name: 'x.md', isDirectory: false }])).toEqual([
      { name: 'auth_service', kind: 'dir', children: ['README.md', 'a', 'b'] },
      { name: 'x.md', kind: 'file', children: [] },
    ]);
  });
});

describe('cards and prefs', () => {
  it('search matches every word across name, tags and paths', () => {
    const items = [{ ...item('a', 'Auth context', ['/r/docs/pm']), tags: ['totals'] }, item('b', 'Glossary', ['/r/g.md'])];
    expect(filterItems(items, 'totals docs').map((i) => i.id)).toEqual(['a']);
    expect(filterItems(items, '').length).toBe(2);
  });
  it('status text', () => {
    expect(statusText({ path: '/x', exists: false, kind: null, size: null, files: null, truncated: false })).toBe('missing');
    expect(statusText({ path: '/x', exists: true, kind: 'dir', size: 2048, files: 5000, truncated: true })).toBe('5000+ files · 2.0 KB');
  });
  it('auto-send is off by default and survives a reload', () => {
    expect(parsePrefs(null).autoSendPinned).toBe(false);
    expect(parsePrefs({ autoSendPinned: true }).autoSendPinned).toBe(true);
    expect(parsePrefs({ autoSendPinned: 'yes' }).autoSendPinned).toBe(false);
  });
});

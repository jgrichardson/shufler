import { describe, expect, it } from 'vitest';
import { isClosed, needsOwnerStations, normalizeSnapshot, sessionCount } from '../src/lib/derive';
import { rowStations } from '../src/scene/layout';
import type { Station } from '../src/types';

const NOW = 1_800_000_000;
const raw = (id: string, over: Record<string, unknown> = {}) => ({ id, title: id.toUpperCase(), pr_numbers: [], ...over });
const norm = (stations: Record<string, unknown>[], your_move: Record<string, unknown>[] = []) => normalizeSnapshot({ stations, workpieces: [], your_move }, { now: NOW });

describe('round 9: stations[].claude', () => {
  it('defaults to one running session when the snapshot has no claude block', () => {
    const [s] = norm([raw('a')]).stations;
    expect(s.claude).toEqual({ running: true, pid: null, since: null, sessions: [], count: 1 });
    expect(isClosed(s)).toBe(false);
  });

  it('keeps the daemon claude block and the closed status', () => {
    const [s] = norm([raw('a', { claude: { running: false, pid: null, since: null, sessions: [] }, activity: { status: 'closed' } })]).stations;
    expect(s.activity.status).toBe('closed');
    expect(isClosed(s)).toBe(true);
    const [m] = norm([raw('b', { claude: { running: true, pid: 42, since: 100, sessions: ['db52364d-aaaa', 'c0ffee12-bbbb'], count: 2 } })]).stations;
    expect(m.claude).toEqual({ running: true, pid: 42, since: 100, sessions: ['db52364d-aaaa', 'c0ffee12-bbbb'], count: 2 });
    // a second process with no known session still counts
    const [n] = norm([raw('c', { claude: { running: true, sessions: ['db52364d-aaaa'], count: 2 } })]).stations;
    expect(sessionCount(n.claude)).toBe(2);
    // the daemon sends null until its process source answers
    expect(norm([raw('d', { claude: null })]).stations[0].claude.running).toBe(true);
  });
});

describe('round 9: closed stations never need you', () => {
  it('drops note-me, question and your_move rows of a closed station', () => {
    const snap = norm(
      [
        raw('open', { note: { state: 'me', text: 'decide', ts: NOW } }),
        raw('shut', { note: { state: 'me', text: 'decide', ts: NOW }, pending_question: { question: 'ok?' }, activity: { status: 'closed' } }),
      ],
      [{ kind: 'note', station_id: 'shut', title: 'decide' }],
    );
    expect([...needsOwnerStations(snap)]).toEqual(['open']);
  });
});

describe('round 9: rows follow running Claude sessions', () => {
  const st = (id: string, over: Partial<Station> = {}) =>
    ({ id, sidebar_index: id.charCodeAt(0), activity: { status: 'idle' }, claude: { running: true, pid: null, since: null, sessions: [], count: 1 }, ...over }) as Station;
  const stations = [
    st('a'),
    st('b', { activity: { status: 'closed' } as Station['activity'], claude: { running: false, pid: null, since: null, sessions: [], count: 0 } }),
    st('c', { empty: true }),
    st('d', { utility: true }),
  ];

  it('hides closed and empty workspaces by default', () => {
    expect(rowStations(stations).map((s) => s.id)).toEqual(['a']);
  });

  it('shows them with the Empty workspaces layer on, but never utility workspaces', () => {
    expect(rowStations(stations, true).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('round 9: utility workspaces', () => {
  it('keeps utility_stations so the terminal picker can still reach SHARED and TOOLS', () => {
    const snap = normalizeSnapshot({ stations: [], workpieces: [], utility_stations: [{ id: 'U1', title: 'SHARED', utility: true }, { id: 'U2' }, { title: 'no id' }] }, { now: NOW });
    expect(snap.utility_stations).toEqual([{ id: 'U1', title: 'SHARED' }, { id: 'U2', title: 'U2' }]);
    expect(snap.stations).toEqual([]);
  });

  it('defaults utility_stations to an empty list for snapshots without it', () => {
    expect(normalizeSnapshot({ stations: [], workpieces: [] }, { now: NOW }).utility_stations).toEqual([]);
  });
});

describe('round 10: ledger_area field', () => {
  it('reads ledger_area and row_order, defaulting to null', () => {
    const [a, b] = norm([raw('a', { ledger_area: 'search', row_order: 2 }), raw('b', { ledger_area: '' })]).stations;
    expect([a.ledger_area, a.row_order]).toEqual(['search', 2]);
    expect([b.ledger_area, b.row_order]).toEqual([null, null]);
  });
});

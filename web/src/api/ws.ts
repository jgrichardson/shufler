import { dispatch, useWorld } from '../store';
import { makeMockSnapshot, tickMockSnapshot } from '../mock/snapshot';
import { normalizeSnapshot, type PhaseMemory } from '../lib/derive';
import { mockField } from '../mock/library';
import { debouncePhases, type PhaseDebounce } from '../lib/hysteresis';

const phaseMemory: PhaseMemory = new Map();
const debounce: PhaseDebounce = new Map();
const norm = (raw: unknown, mock = false) => {
  const snap = debouncePhases(normalizeSnapshot(raw, { phaseMemory }), debounce, Date.now(), mock ? { holdSnapshots: 1, holdMs: 0 } : {});
  // the mock library lives in the browser; owed is derived on each mock tick like the daemon does
  return mock ? { ...snap, library: mockField(snap) } : snap;
};

type TurnListener = (msg: { station_id: string; turn: unknown }) => void;
const turnListeners = new Set<TurnListener>();
export function onTurn(fn: TurnListener): () => void {
  turnListeners.add(fn);
  return () => turnListeners.delete(fn);
}

let subscribed: string | null = null;
/** Ask the daemon to stream new turns for one station (only one at a time keeps the loop cheap). */
export function subscribeStation(stationId: string | null) {
  subscribed = stationId;
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'subscribe', station_id: stationId }));
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const MOCK_TICK_MS = 6000;

let socket: WebSocket | null = null;
let attempt = 0;
let mockTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function mockForced(): boolean {
  return new URLSearchParams(window.location.search).get('mock') === '1';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSnap: any = null;
let mockPaused = false;

function startMock() {
  if (mockTimer) return;
  dispatch({ type: 'enter_mock' });
  mockSnap = makeMockSnapshot();
  let tick = 0;
  dispatch({ type: 'snapshot', snapshot: norm(mockSnap, true), at: Date.now() });
  mockTimer = setInterval(() => {
    if (mockPaused) return;
    tick += 1;
    mockSnap = tickMockSnapshot(mockSnap, tick);
    dispatch({ type: 'snapshot', snapshot: norm(mockSnap, true), at: Date.now() });
  }, MOCK_TICK_MS);
  if (import.meta.env.DEV) installMockHooks();
}

/** A scripted change to the mock world, for demos and recordings (dev build with ?mock=1 only). */
export type MockEvent =
  | { type: 'phase'; pr: number; phase: string; stage?: string; ci?: string; reviewer?: string; draft?: boolean }
  | { type: 'question'; station_id: string; question: Record<string, unknown> | null; note?: { state: string; text: string } }
  | { type: 'turn'; station_id: string; role: 'user' | 'assistant'; text: string; tools?: { name: string; summary: string }[] };

/**
 * Dev only: window.__shufler.mockEvent(ev) mutates the mock snapshot (a pod's phase, a session's pending question)
 * or appends a transcript turn, exactly as a daemon push would arrive. window.__shufler.mockPause(true) stops the demo
 * tick. Never installed in a production build or against a live daemon; nothing here calls an action.
 */
function installMockHooks() {
  const apply = (ev: MockEvent) => {
    if (!mockSnap) return;
    const now = Date.now() / 1000;
    if (ev.type === 'turn') {
      turnListeners.forEach((fn) => fn({ station_id: ev.station_id, turn: { ts: now, role: ev.role, text: ev.text, tools: ev.tools ?? [] } }));
      return;
    }
    if (ev.type === 'phase') {
      const events = [...(mockSnap.events ?? [])];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const workpieces = mockSnap.workpieces.map((w: any) => {
        if (w.pr !== ev.pr) return w;
        const from = w.phase ?? null;
        if (from !== ev.phase) events.push({ ts: now, kind: 'phase', pr: w.pr, workpiece_id: w.id, from, to: ev.phase, station_id: w.station_id ?? null });
        return { ...w, phase: ev.phase, stage: ev.stage ?? w.stage, ci: ev.ci ?? w.ci, reviewer: ev.reviewer ?? w.reviewer, draft: ev.draft ?? w.draft, updated_at: new Date().toISOString() };
      });
      mockSnap = { ...mockSnap, workpieces, events };
    }
    if (ev.type === 'question') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stations = mockSnap.stations.map((s: any) =>
        s.id !== ev.station_id ? s : { ...s, pending_question: ev.question, note: ev.note ? { ...ev.note, ts: now } : s.note },
      );
      mockSnap = { ...mockSnap, stations };
    }
    // twice, so the phase debounce (one confirming snapshot) lets the change through at once
    dispatch({ type: 'snapshot', snapshot: norm(mockSnap, true), at: Date.now() });
    dispatch({ type: 'snapshot', snapshot: norm(mockSnap, true), at: Date.now() });
  };
  const w = window as unknown as { __shufler?: Record<string, unknown> };
  w.__shufler = {
    ...w.__shufler,
    mockEvent: apply,
    mockPause: (on = true) => {
      mockPaused = on;
    },
  };
}

function stopMock() {
  if (mockTimer) clearInterval(mockTimer);
  mockTimer = null;
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function isSnapshot(msg: unknown): boolean {
  const m = msg as { stations?: unknown; type?: unknown } | null;
  return !!m && Array.isArray(m.stations) && (m.type === undefined || m.type === 'snapshot');
}

function connect() {
  dispatch({ type: 'conn', status: 'connecting' });
  let opened = false;
  try {
    socket = new WebSocket(wsUrl());
  } catch {
    onFail();
    return;
  }
  socket.onopen = () => {
    opened = true;
    attempt = 0;
    stopMock();
    dispatch({ type: 'ws_opened' });
    if (subscribed) socket?.send(JSON.stringify({ type: 'subscribe', station_id: subscribed }));
  };
  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(String(e.data));
      if (msg && msg.type === 'turn') turnListeners.forEach((fn) => fn(msg));
      else if (isSnapshot(msg)) dispatch({ type: 'snapshot', snapshot: norm(msg), at: Date.now() });
    } catch {
      /* ignore malformed frames */
    }
  };
  socket.onclose = () => {
    socket = null;
    if (opened) dispatch({ type: 'conn', status: 'closed' });
    onFail();
  };
  socket.onerror = () => socket?.close();
}

function onFail() {
  dispatch({ type: 'ws_failed' });
  if (useWorld.getState().mock) startMock();
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt += 1;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, delay);
}

export function startFeed() {
  if (mockForced()) {
    startMock();
    return;
  }
  connect();
}

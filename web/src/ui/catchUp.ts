import { useEffect } from 'react';
import { create } from 'zustand';
import { toast, useWorld } from '../store';
import { PHASES, normalizePhase } from '../lib/domains';
import { getStored, storageKey } from '../lib/storage';
import type { Phase, Snapshot } from '../types';

/** What the viewer last saw: each pod's phase. Kept per mode so mock and live never mix. */
export interface Seen {
  ts: number;
  phases: Record<string, Phase>;
}

export interface Move {
  id: string;
  from: Phase;
  to: Phase;
}

const REPLAY_MS = 6000;
const SAVE_EVERY_MS = 2000;
const idx = (p: Phase) => {
  const n = normalizePhase(p) ?? p;
  return n === 'shipped' ? PHASES.length : PHASES.indexOf(n as (typeof PHASES)[number]);
};

export function seenOf(snap: Pick<Snapshot, 'workpieces'>, now = Date.now()): Seen {
  const phases: Record<string, Phase> = {};
  for (const w of snap.workpieces) phases[w.id] = w.phase;
  return { ts: now, phases };
}

/** Pods whose phase changed since the viewer last looked, in the order the daemon logged them. */
export function diffSeen(seen: Seen | null, snap: Pick<Snapshot, 'workpieces' | 'events'>): { moves: Move[]; merged: number; deployed: number } {
  if (!seen) return { moves: [], merged: 0, deployed: 0 };
  const lastEvent = new Map<string, number>();
  (snap.events ?? []).forEach((e, i) => e.workpiece_id && lastEvent.set(e.workpiece_id, i));
  const moves: Move[] = [];
  for (const w of snap.workpieces) {
    const from = normalizePhase(seen.phases[w.id]);
    if (from && from !== w.phase) moves.push({ id: w.id, from, to: w.phase });
  }
  moves.sort((a, b) => (lastEvent.get(a.id) ?? -1) - (lastEvent.get(b.id) ?? -1));
  const crossed = (m: Move, p: Phase) => idx(m.from) < idx(p) && idx(m.to) >= idx(p);
  // v4.1: entering Deploy means merged; reaching the dock means deployed
  return { moves, merged: moves.filter((m) => crossed(m, 'deploy')).length, deployed: moves.filter((m) => m.to === 'shipped' && m.from !== 'shipped').length };
}

export function awaySummary(merged: number, deployed: number, needs: number, moved: number): string {
  const parts = [merged && `${merged} merged`, deployed && `${deployed} deployed`, `${needs} need${needs === 1 ? 's' : ''} you`].filter(Boolean);
  if (!merged && !deployed) parts.unshift(`${moved} moved`);
  return parts.join(', ');
}

interface ReplayState {
  /** Pods still shown at the phase they had when the viewer left. */
  held: Record<string, Phase>;
  running: boolean;
  start: (moves: Move[]) => void;
  release: (id: string) => void;
  skip: () => void;
}

let timers: ReturnType<typeof setTimeout>[] = [];

export const useReplay = create<ReplayState>()((set, get) => ({
  held: {},
  running: false,
  start: (moves) => {
    timers.forEach(clearTimeout);
    timers = [];
    if (!moves.length) return;
    set({ held: Object.fromEntries(moves.map((m) => [m.id, m.from])), running: true });
    const step = Math.max(350, REPLAY_MS / moves.length);
    moves.forEach((m, i) => timers.push(setTimeout(() => get().release(m.id), 700 + i * step)));
  },
  release: (id) =>
    set((s) => {
      const held = { ...s.held };
      delete held[id];
      return { held, running: Object.keys(held).length > 0 };
    }),
  skip: () => {
    timers.forEach(clearTimeout);
    timers = [];
    skipUntil = performance.now() + 1500;
    set({ held: {}, running: false });
  },
}));

/** After Esc, journeys snap (0.3s) for a moment so the board settles at once. */
let skipUntil = 0;
export const skippingReplay = () => performance.now() < skipUntil;

/** Snapshots already diffed; StrictMode mounts effects twice in dev. */
const checked = new WeakSet<Snapshot>();

const keyFor = (mock: boolean) => storageKey(`lastSeen.${mock ? 'mock' : 'live'}`);

function load(mock: boolean): Seen | null {
  try {
    const raw = getStored(keyFor(mock));
    return raw ? (JSON.parse(raw) as Seen) : null;
  } catch {
    return null;
  }
}

function save(mock: boolean, seen: Seen) {
  try {
    localStorage.setItem(keyFor(mock), JSON.stringify(seen));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Catch-up replay: on connect, or when the tab comes back, diff what the viewer last saw against
 * the new snapshot, replay the moves over ~6s and say what happened. Esc skips.
 */
export function useCatchUp() {
  useEffect(() => {
    let armed = true;
    let lastSave = 0;
    const check = (snap: Snapshot, mock: boolean) => {
      armed = false;
      if (checked.has(snap)) return;
      checked.add(snap);
      const { moves, merged, deployed } = diffSeen(load(mock), snap);
      if (!moves.length) return;
      useReplay.getState().start(moves);
      toast(true, 'While you were away', `${awaySummary(merged, deployed, snap.your_move_count, moves.length)}. Esc skips the replay.`);
    };
    const first = useWorld.getState();
    if (first.snapshot && document.visibilityState === 'visible') check(first.snapshot, first.mock);
    const unsub = useWorld.subscribe((s, prev) => {
      const snap = s.snapshot;
      if (!snap || snap === prev.snapshot) return;
      if (armed && document.visibilityState === 'visible') check(snap, s.mock);
      const now = Date.now();
      if (!armed && document.visibilityState === 'visible' && !useReplay.getState().running && now - lastSave > SAVE_EVERY_MS) {
        lastSave = now;
        save(s.mock, seenOf(snap, now));
      }
    });
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        const s = useWorld.getState();
        if (s.snapshot) save(s.mock, seenOf(s.snapshot));
      }
      // the next snapshot after the tab returns runs the catch-up
      armed = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
}

import type { Phase, Snapshot } from '../types';

/** CONTRACT v3.1 hysteresis: a pod moves only after its new phase held for 2 snapshots and 60s. */
export const HOLD_SNAPSHOTS = 2;
export const HOLD_MS = 60_000;

interface Entry {
  shown: Phase;
  pending: Phase | null;
  count: number;
  since: number;
}

export type PhaseDebounce = Map<string, Entry>;

export function debouncePhases(snap: Snapshot, memory: PhaseDebounce, now: number, opts: { holdSnapshots?: number; holdMs?: number } = {}): Snapshot {
  const holdN = opts.holdSnapshots ?? HOLD_SNAPSHOTS;
  const holdMs = opts.holdMs ?? HOLD_MS;
  const seen = new Set<string>();
  const workpieces = snap.workpieces.map((w) => {
    seen.add(w.id);
    const e = memory.get(w.id);
    if (!e) {
      memory.set(w.id, { shown: w.phase, pending: null, count: 0, since: now });
      return w;
    }
    if (w.phase === e.shown) {
      e.pending = null;
      e.count = 0;
      return w;
    }
    if (e.pending !== w.phase) {
      e.pending = w.phase;
      e.count = 1;
      e.since = now;
    } else e.count += 1;
    if (e.count >= holdN && now - e.since >= holdMs) {
      e.shown = w.phase;
      e.pending = null;
      e.count = 0;
      return w;
    }
    return { ...w, phase: e.shown, phase_pending: w.phase };
  });
  for (const id of [...memory.keys()]) if (!seen.has(id)) memory.delete(id);
  return { ...snap, workpieces };
}

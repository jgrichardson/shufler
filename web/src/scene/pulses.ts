import { create } from 'zustand';

/** A landed dispatch: a bead runs the tether and the session's courier flies for a while. */
export interface Pulse {
  id: number;
  stationId: string;
  at: number;
}

export const COURIER_AFTER_DISPATCH_MS = 20_000;
let seq = 1;

export const usePulses = create<{ pulses: Pulse[]; fire: (stationId: string) => void; clear: (id: number) => void }>()((set) => ({
  pulses: [],
  fire: (stationId) => set((s) => ({ pulses: [...s.pulses.slice(-11), { id: seq++, stationId, at: performance.now() }] })),
  clear: (id) => set((s) => ({ pulses: s.pulses.filter((p) => p.id !== id) })),
}));

/** Stations that had a dispatch land in the last 20s keep a courier out. */
export function recentlyDispatched(pulses: Pulse[], now = performance.now()): Set<string> {
  return new Set(pulses.filter((p) => now - p.at < COURIER_AFTER_DISPATCH_MS).map((p) => p.stationId));
}

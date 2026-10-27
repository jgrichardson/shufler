import { create } from 'zustand';

/** A pod riding from its lane to the Shipping Dock and on into the Warehouse after it shipped. */
export interface Ride {
  id: string;
  pr: number | null;
  domain: string;
  from: [number, number, number];
  startedAt: number;
}

interface RideState {
  rides: Ride[];
  start: (r: Ride) => void;
  finish: (id: string) => void;
}

export const useRides = create<RideState>()((set) => ({
  rides: [],
  start: (r) => set((s) => (s.rides.some((x) => x.id === r.id) ? s : { rides: [...s.rides, r] })),
  finish: (id) => set((s) => ({ rides: s.rides.filter((x) => x.id !== id) })),
}));

/** PRs still in the air: their crate and their tick on the counter wait until they land. */
export function inflightPrs(rides: Ride[]): Set<number> {
  return new Set(rides.map((r) => r.pr).filter((p): p is number => p != null));
}


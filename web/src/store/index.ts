import { create } from 'zustand';
import { initialState, reduce, type WorldEvent, type WorldState } from './reducer';
import type { Station, Workpiece } from '../types';

interface Store extends WorldState {
  dispatch: (ev: WorldEvent) => void;
}

export const useWorld = create<Store>()((set) => ({
  ...initialState,
  dispatch: (ev) => set((s) => reduce(s, ev)),
}));

export const dispatch = (ev: WorldEvent) => useWorld.getState().dispatch(ev);

let toastSeq = 1;
export function toast(ok: boolean, title: string, output = '', cta?: import('./reducer').ToastCta) {
  const id = toastSeq++;
  dispatch({ type: 'toast', toast: { ok, title, output, cta }, id });
  setTimeout(() => dispatch({ type: 'dismiss_toast', id }), ok ? 6000 : 14000);
}

const NO_CAPS = {} as const;
/** Snapshot capabilities; an absent key means "on" so older daemons keep every lever. */
export function useCaps() {
  return useWorld((s) => s.snapshot?.capabilities ?? NO_CAPS) as import('../types').Capabilities;
}
export const capOn = (v: unknown) => v !== false && v !== null;

export function findStation(id: string | null | undefined): Station | undefined {
  if (!id) return undefined;
  return useWorld.getState().snapshot?.stations.find((s) => s.id === id);
}

export function findItem(id: string | null | undefined): Workpiece | undefined {
  if (!id) return undefined;
  return useWorld.getState().snapshot?.workpieces.find((w) => w.id === id);
}

export function findItemByPr(pr: number | null | undefined): Workpiece | undefined {
  if (pr == null) return undefined;
  return useWorld.getState().snapshot?.workpieces.find((w) => w.pr === pr);
}

export function useStation(id: string | null | undefined): Station | undefined {
  return useWorld((s) => (id ? s.snapshot?.stations.find((st) => st.id === id) : undefined));
}

export function useItem(id: string | null | undefined): Workpiece | undefined {
  return useWorld((s) => (id ? s.snapshot?.workpieces.find((w) => w.id === id) : undefined));
}

export function selectItem(id: string, fly = false) {
  dispatch({ type: 'select', selection: { kind: 'item', id }, fly });
}
export function selectStation(id: string, fly = false) {
  dispatch({ type: 'select', selection: { kind: 'station', id }, fly });
}

/** Select a warehouse rack (a domain id), PILE_ALL for the whole Warehouse or PILE_DOCK for the Shipping Dock. Focuses; the camera stays put. */
export function openPile(id: string) {
  dispatch({ type: 'select', selection: { kind: 'pile', id } });
}

/** Select the context library building and open its panel; `fly` takes the camera there whatever the flyOnSelect pref says. */
export function selectLibrary(fly = false) {
  dispatch({ type: 'select', selection: { kind: 'library' }, fly });
}

/** Top bar and the L key: select the library and fly to it, or close it when it is already selected. */
export function toggleLibrary() {
  if (useWorld.getState().selection?.kind === 'library') dispatch({ type: 'select', selection: null });
  else selectLibrary(true);
}

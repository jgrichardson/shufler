import { create } from 'zustand';
import { dispatch, useWorld } from '../store';
import { getStored, storageKey } from '../lib/storage';
import { useHorizon } from '../scene/horizon';

/*
 * How the world is laid out: the grid (one row per session across the district columns, the default) or
 * big islands (one large island per session with its own loop of track). A view preference kept in this
 * browser; ?layout=islands or ?layout=grid picks one for a visit without saving it. Pipeline always
 * draws the grid, whichever is chosen.
 */
export type WorldLayout = 'grid' | 'islands';

export const LAYOUT_STORAGE_KEY = storageKey('layout');

export function parseWorldLayout(raw: unknown): WorldLayout | null {
  return raw === 'grid' || raw === 'islands' ? raw : null;
}

/** The layout a visit starts in: ?layout= first, then the stored choice, else the grid. */
export function initialWorldLayout(search: string, stored: string | null): WorldLayout {
  return parseWorldLayout(new URLSearchParams(search).get('layout')) ?? parseWorldLayout(stored) ?? 'grid';
}

function storedLayout(): string | null {
  try {
    return getStored(LAYOUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export const useWorldLayout = create<{ mode: WorldLayout; set: (mode: WorldLayout) => void }>()((set) => ({
  mode: initialWorldLayout(typeof window !== 'undefined' ? window.location.search : '', storedLayout()),
  set: (mode) => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
    } catch {
      /* storage unavailable: the choice lasts for this tab */
    }
    set({ mode });
  },
}));

/** True when the world draws big islands: the islands layout is chosen and the view is not Pipeline. */
export const islandsShown = (mode: WorldLayout, preset: string) => mode === 'islands' && preset !== 'pipeline';

export function useIslandsView(): boolean {
  const mode = useWorldLayout((s) => s.mode);
  const preset = useWorld((s) => s.preset);
  return islandsShown(mode, preset);
}

/**
 * Switches the layout and frames the camera for it by re-applying the current view. Pipeline keeps the
 * grid, so choosing islands there goes back to the view before Pipeline. The horizon view is a camera mode
 * that works over either layout: when it is on, the switch keeps it on and re-frames it for the new layout.
 */
export function chooseLayout(mode: WorldLayout) {
  if (useWorldLayout.getState().mode === mode) return;
  useWorldLayout.getState().set(mode);
  const { preset, prevPreset } = useWorld.getState();
  if (preset !== 'pipeline' && useHorizon.getState().on) useHorizon.getState().reframe();
  else if (preset !== 'pipeline') dispatch({ type: 'preset', preset });
  else if (mode === 'islands') dispatch({ type: 'preset', preset: prevPreset === 'pipeline' ? 'overview' : prevPreset });
}

/** Key I and the top-bar switch: grid to islands and back. */
export const toggleLayout = () => chooseLayout(useWorldLayout.getState().mode === 'islands' ? 'grid' : 'islands');

import { useMemo } from 'react';
import { create } from 'zustand';
import { useWorld } from '../store';
import { computeLayout, layoutKey, type SceneLayout } from './layout';
import { islandLayout } from './islands';
import { useIslandsView } from '../ui/worldLayout';
import { needsOwnerIds, needsOwnerStations } from '../lib/derive';
import { useReplay } from '../ui/catchUp';
import { useLayers, type Lod } from '../ui/layers';

export function useLayout(): SceneLayout | null {
  const showEmpty = useLayers((s) => s.empty);
  const key = useWorld((s) => layoutKey(s.snapshot, showEmpty));
  const held = useReplay((s) => s.held);
  const islands = useIslandsView();
  return useMemo(() => {
    const snap = useWorld.getState().snapshot;
    if (!snap) return null;
    // catch-up replay: pods not yet released stay where the viewer last saw them
    const hasHeld = Object.keys(held).length > 0;
    const grid = computeLayout(hasHeld ? { ...snap, workpieces: snap.workpieces.map((w) => (held[w.id] ? { ...w, phase: held[w.id] } : w)) } : snap, { showEmpty });
    return islands ? islandLayout(grid) : grid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, held, islands]);
}

export type { Lod } from '../ui/layers';
/** LOD band plus the label threshold (ZOOM_LABEL_PPU) the plates use. */
export const useLod = create<{ lod: Lod; zoomed: boolean; set: (lod: Lod, zoomed: boolean) => void }>()((set) => ({
  lod: 'mid',
  zoomed: false,
  set: (lod, zoomed) => set({ lod, zoomed }),
}));

export function useRedSets() {
  const snapshot = useWorld((s) => s.snapshot);
  return useMemo(
    () => ({
      items: snapshot ? needsOwnerIds(snapshot) : new Set<string>(),
      stations: snapshot ? needsOwnerStations(snapshot) : new Set<string>(),
    }),
    [snapshot],
  );
}

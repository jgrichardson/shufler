import { useMemo } from 'react';
import type { Phase, Snapshot } from '../types';
import type { Selection } from '../store/reducer';
import { useWorld } from '../store';
import { usePrefs } from '../ui/prefs';
import { useLayout, useRedSets } from './useLayout';
import type { SceneLayout } from './layout';

/**
 * What stays lit while something is selected. Selecting never moves the camera; everything outside
 * the focus greys out instead. A null set means "all of that kind stays lit".
 */
export interface Focus {
  /** Row (lane) indexes in focus. */
  lanes: Set<number> | null;
  stations: Set<string> | null;
  items: Set<string> | null;
  /** District columns in focus. */
  phases: Set<Phase> | null;
  warehouse: boolean;
  /** The context library building stays lit. */
  library: boolean;
}

const none = <T,>() => new Set<T>();

/** Rows that hold any of these stations. */
function lanesOf(layout: SceneLayout, stationIds: Iterable<string>): Set<number> {
  const want = new Set(stationIds);
  const out = new Set<number>();
  layout.lanes.forEach((l, i) => {
    if (l.stationId && want.has(l.stationId)) out.add(i);
  });
  return out;
}

/** Items drawn in these rows, plus the given extras. */
function itemsIn(layout: SceneLayout, lanes: Set<number>, extra: Iterable<string> = []): Set<string> {
  const out = new Set<string>(extra);
  for (const [id, slot] of layout.pods) if (lanes.has(slot.lane)) out.add(id);
  return out;
}

/** Sessions whose row is in focus. */
function stationsIn(layout: SceneLayout, lanes: Set<number>, extra: Iterable<string> = []): Set<string> {
  const out = new Set<string>(extra);
  lanes.forEach((i) => {
    const sid = layout.lanes[i]?.stationId;
    if (sid) out.add(sid);
  });
  return out;
}

export function computeFocus(selection: Selection, needsDim: boolean, snap: Snapshot, layout: SceneLayout, red: { items: Set<string>; stations: Set<string> }): Focus | null {
  if (!selection) {
    // Needs-me view: only what you owe stays lit; rows and columns keep their colour
    return needsDim ? { lanes: null, stations: red.stations, items: red.items, phases: null, warehouse: true, library: true } : null;
  }
  switch (selection.kind) {
    case 'station': {
      const lanes = lanesOf(layout, [selection.id]);
      const owned = snap.workpieces.filter((w) => w.station_ids.includes(selection.id)).map((w) => w.id);
      return { lanes, stations: stationsIn(layout, lanes, [selection.id]), items: itemsIn(layout, lanes, owned), phases: null, warehouse: false, library: false };
    }
    case 'domain': {
      const lanes = new Set<number>();
      layout.lanes.forEach((l, i) => l.domain.id === selection.id && lanes.add(i));
      const domainStations = snap.stations.filter((s) => s.domain === selection.id).map((s) => s.id);
      const domainItems = snap.workpieces.filter((w) => w.domain === selection.id).map((w) => w.id);
      return { lanes, stations: stationsIn(layout, lanes, domainStations), items: itemsIn(layout, lanes, domainItems), phases: null, warehouse: false, library: false };
    }
    case 'gate':
      return {
        lanes: none(),
        stations: none(),
        items: new Set(snap.workpieces.filter((w) => w.phase === selection.phase).map((w) => w.id)),
        phases: new Set([selection.phase]),
        warehouse: false,
        library: false,
      };
    case 'item': {
      const w = snap.workpieces.find((x) => x.id === selection.id);
      const slot = layout.pods.get(selection.id);
      const lanes = lanesOf(layout, w?.station_ids ?? []);
      if (slot) lanes.add(slot.lane);
      return { lanes, stations: new Set(w?.station_ids ?? []), items: new Set([selection.id]), phases: null, warehouse: false, library: false };
    }
    case 'pile':
      return { lanes: none(), stations: none(), items: none(), phases: none(), warehouse: true, library: false };
    case 'library':
      // rows stay lit: they are where library cards get dropped
      return null;
    default:
      return null;
  }
}

export function useFocus(): Focus | null {
  const layout = useLayout();
  const snapshot = useWorld((s) => s.snapshot);
  const selection = useWorld((s) => s.selection);
  const dim = useWorld((s) => s.dim);
  const red = useRedSets();
  // with "grey out the rest" off, a selection is only outlined; the Needs-me view still dims
  const selectDims = usePrefs((s) => s.selectDims);
  const sel = selectDims ? selection : null;
  return useMemo(() => (layout && snapshot ? computeFocus(sel, dim, snapshot, layout, red) : null), [layout, snapshot, sel, dim, red]);
}

/** True when a focus is active and `id` (or index) sits outside it. */
export const outside = <T,>(set: Set<T> | null | undefined, key: T | null | undefined, focus: Focus | null): boolean =>
  !!focus && !!set && (key == null || !set.has(key));

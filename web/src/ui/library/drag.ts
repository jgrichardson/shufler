import { create } from 'zustand';
import { useWorld } from '../../store';
import type { Hover } from '../../store/reducer';
import { openSend } from './store';
import { FALLBACK } from '../../lib/domains';

/*
 * Dragging a library card from the Library panel onto a row header or a session in the scene. Pointer events,
 * not HTML5 drag: while the button is held the canvas keeps getting pointermove, so the scene's own station
 * hit-testing (Building's hover) names the session under the cursor. The panel fades and lets the pointer
 * through meanwhile (body.lib-dragging), so the scene under it stays reachable.
 */

interface DragState {
  itemIds: string[] | null;
  label: string;
  x: number;
  y: number;
  /** Station under the pointer, from a row header or the scene. */
  over: string | null;
  /** A drop waiting on "this session or its whole domain?". */
  pending: PendingDrop | null;
}

export interface PendingDrop {
  stationId: string;
  domain: string;
  itemIds: string[];
  label: string;
  x: number;
  y: number;
}

export const useLibDrag = create<DragState>()(() => ({ itemIds: null, label: '', x: 0, y: 0, over: null, pending: null }));

/** The domain a drop could also go to, or null when there is no real domain to offer (utility, unassigned). */
export function dropDomain(stationId: string, stations: { id: string; domain: string }[], fallback: string): string | null {
  const d = stations.find((s) => s.id === stationId)?.domain;
  return d && d !== fallback ? d : null;
}

const THRESHOLD = 5;

/** What the element under the pointer is, as far as a drop cares. */
export interface DropHit {
  /** data-station-id of the row header under the pointer. */
  rowStation: string | null;
  /** Over library chrome (the panel, the library tag): never a target. */
  chrome: boolean;
  canvas: boolean;
}

/** The session a drop would go to: a row header first, else the session the scene says is under the pointer. */
export function dropTarget(hit: DropHit, hover: Hover): string | null {
  if (hit.rowStation) return hit.rowStation;
  if (hit.chrome || !hit.canvas) return null;
  return hover?.kind === 'station' ? hover.id : null;
}

function stationAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const hit: DropHit = {
    rowStation: el?.closest<HTMLElement>('[data-station-id]')?.dataset.stationId ?? null,
    chrome: !!el?.closest('.panel, .lib-sign'),
    canvas: el?.tagName === 'CANVAS',
  };
  return dropTarget(hit, useWorld.getState().hover);
}

export function startCardDrag(e: React.PointerEvent, itemIds: string[], label: string) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let live = false;
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', key, true);
    document.body.classList.remove('lib-dragging');
    useLibDrag.setState({ itemIds: null, over: null });
  };
  const move = (ev: PointerEvent) => {
    if (!live) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      live = true;
      document.body.classList.add('lib-dragging');
    }
    useLibDrag.setState({ itemIds, label, x: ev.clientX, y: ev.clientY, over: stationAt(ev.clientX, ev.clientY) });
  };
  const up = (ev: PointerEvent) => {
    const target = live ? stationAt(ev.clientX, ev.clientY) : null;
    end();
    if (!target) return;
    const domain = dropDomain(target, useWorld.getState().snapshot?.stations ?? [], FALLBACK);
    if (domain) useLibDrag.setState({ pending: { stationId: target, domain, itemIds, label, x: ev.clientX, y: ev.clientY } });
    else openSend(target, itemIds);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    end();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('keydown', key, true);
}

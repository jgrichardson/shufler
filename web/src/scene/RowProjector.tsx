import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { stackRows, type StackIn } from '../lib/rowStack';
import type { SceneLayout } from './layout';
import { morphK } from './morph';
import { useHorizon } from './horizon';

/** DOM nodes of the pinned row-header column, keyed by row id. */
export const rowHeads = { col: null as HTMLElement | null, items: new Map<string, HTMLElement>() };

/** Keep clear of the top bar and layer bar, and of the event ticker and status bar. */
const TOP_MIN = 104;
const BOTTOM_PAD = 92;
const PIN_LEFT = 12;
const GAP = 2;
/** The horizon camera packs the rows closer on screen; its slimmer headers stack tighter to keep level with them. */
const HORIZON_GAP = 1;

/**
 * Places each row header level with its row and just left of its island; headers pin to the left
 * edge when the island scrolls away, and are stacked so they never overlap (round 2 + round 4).
 */
export function RowProjector({ layout }: { layout: SceneLayout }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const col = rowHeads.col;
    if (!col) return;
    if (morphK() > 0.5) {
      col.style.visibility = 'hidden';
      return;
    }
    col.style.visibility = 'visible';
    const want: (StackIn & { x: number; el: HTMLElement; w: number })[] = [];
    const place = (id: string, x: number, y: number, z: number) => {
      const el = rowHeads.items.get(id);
      if (!el) return;
      v.set(x, y, z).project(camera);
      if (v.z > 1) {
        el.style.visibility = 'hidden';
        return;
      }
      want.push({ id, x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, h: el.offsetHeight || 24, w: el.offsetWidth || 160, el });
    };
    for (const isl of layout.islands) place(isl.id, isl.center[0] - isl.radius, isl.top, isl.center[2]);
    const stacked = stackRows(want, useHorizon.getState().on ? HORIZON_GAP : GAP, TOP_MIN, size.height - BOTTOM_PAD);
    stacked.forEach((s, i) => {
      const r = want[i];
      const left = Math.max(PIN_LEFT, r.x - 10 - r.w);
      r.el.style.visibility = s.visible ? 'visible' : 'hidden';
      r.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(s.top)}px, 0)`;
    });
  });
  return null;
}

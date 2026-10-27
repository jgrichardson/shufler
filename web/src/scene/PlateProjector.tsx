import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { plates, stackOffsets, type StackRect } from './plateRegistry';
import { podPositions } from './Pods';
import { morphK } from './morph';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 6;
/** Candidate offsets in (half-widths sideways, plate-heights up), nearest first. */
const CANDIDATES: [number, number][] = [
  [0, 0], [0, 1], [-1, 0.5], [1, 0.5], [0, 2], [-1, 1.5], [1, 1.5], [0, 3], [-1, 2.5], [1, 2.5],
  [-1, -0.6], [1, -0.6], [0, 4], [-2, 1], [2, 1], [-1, 3.5], [1, 3.5], [0, 5], [-2, 2.5], [2, 2.5],
];
const PAD = 3;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x && a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;

/**
 * Projects every registered plate's world anchor to screen space and resolves overlaps:
 * higher-priority plates claim their spot first, lower ones climb upward (leader stem grows)
 * until they find room, and fade if they cannot.
 */
export function PlateProjector() {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  const camDir = useMemo(() => new THREE.Vector3(), []);
  const toAnchor = useMemo(() => new THREE.Vector3(), []);
  const at = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    camera.getWorldDirection(camDir);
    const items: { id: string; px: number; py: number; w: number; h: number; pr: number; el: HTMLElement }[] = [];
    const stacks = new Map<string, { el: HTMLElement; r: StackRect }[]>();
    for (const [id, p] of plates) {
      if (!p.el) continue;
      if (p.follow) {
        const pos = podPositions.get(p.follow);
        if (pos) p.anchor.set(pos.x, pos.y + p.lift, pos.z);
      }
      at.copy(p.anchor);
      if (p.pipe && !p.follow) at.lerp(p.pipe, morphK());
      toAnchor.subVectors(at, camera.position);
      if (toAnchor.dot(camDir) <= 0) {
        p.el.style.visibility = 'hidden';
        continue;
      }
      v.copy(at).project(camera);
      const px = (v.x * 0.5 + 0.5) * size.width;
      const py = (-v.y * 0.5 + 0.5) * size.height;
      if (px < -200 || px > size.width + 200 || py < -200 || py > size.height + 200) {
        p.el.style.visibility = 'hidden';
        continue;
      }
      if (!p.w || !p.h) {
        p.w = p.el.offsetWidth;
        p.h = p.el.offsetHeight;
      }
      if (p.fixed) {
        p.el.style.visibility = 'visible';
        p.el.style.zIndex = String(Math.round(p.priority * 10));
        const r = { x: px - p.w / 2, y: py - p.h - 4, w: p.w, h: p.h, priority: p.priority };
        if (p.stack) {
          const list = stacks.get(p.stack) ?? [];
          list.push({ el: p.el, r });
          stacks.set(p.stack, list);
        } else p.el.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`;
        continue;
      }
      items.push({ id, px, py, w: p.w, h: p.h, pr: p.priority, el: p.el });
    }
    for (const list of stacks.values()) {
      const dy = list.length > 1 ? stackOffsets(list.map((x) => x.r)) : [0];
      list.forEach(({ el, r }, i) => (el.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y + dy[i])}px, 0)`));
    }
    items.sort((a, b) => b.pr - a.pr || a.py - b.py);
    const placed: Rect[] = [];
    for (const it of items) {
      let chosen: Rect | null = null;
      let lift = 0;
      let shift = 0;
      for (const [dx, dy] of CANDIDATES) {
        const r = { x: it.px - it.w / 2 + dx * (it.w * 0.55 + 4), y: it.py - it.h - GAP - dy * Math.max(12, it.h * 0.6), w: it.w, h: it.h };
        if (!placed.some((q) => overlaps(r, q))) {
          chosen = r;
          lift = dy * Math.max(12, it.h * 0.6);
          shift = dx * (it.w * 0.55 + 4);
          break;
        }
      }
      const clear = !!chosen;
      if (!chosen) {
        lift = 0;
        shift = 0;
        chosen = { x: it.px - it.w / 2, y: it.py - it.h - GAP, w: it.w, h: it.h };
      }
      placed.push(chosen);
      const el = it.el;
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${Math.round(chosen.x)}px, ${Math.round(chosen.y)}px, 0)`;
      el.style.setProperty('--stem', `${Math.round(GAP + lift)}px`);
      el.style.setProperty('--stem-x', `${Math.round(-shift)}px`);
      el.style.zIndex = String(Math.round(it.pr * 10 + (clear ? 1 : 0)));
      el.dataset.crowded = clear ? '0' : '1';
    }
  });
  return null;
}

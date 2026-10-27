import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Phase } from '../types';
import { PHASES, PHASE_LABEL, phaseTiny } from '../lib/domains';
import { BAND_W, LANDMARK, SKY_Y, cellX, type SceneLayout } from './layout';
import { morphK } from './morph';

/** DOM cells of the district header strip, keyed by phase; positioned every frame below. */
export const strip = { bar: null as HTMLElement | null, cells: new Map<Phase, HTMLElement>() };

let ctx: CanvasRenderingContext2D | null = null;
let family = '';
const widths = new Map<string, number>();
/** Rendered width of `text` in the strip's label face at `px`, cached. */
function textW(text: string, px: number, face: string) {
  const key = `${px}|${face}|${text}`;
  let w = widths.get(key);
  if (w == null) {
    if (typeof document !== 'undefined') ctx ??= document.createElement('canvas').getContext('2d');
    if (!ctx) return text.length * px * 0.62;
    ctx.font = `650 ${px}px ${face}`;
    widths.set(key, (w = ctx.measureText(text).width + px * 0.02 * text.length));
  }
  return w;
}

export type TagFit = 'full' | 'name' | 'short' | 'tall' | 'stack';
export interface StripTag {
  w: number;
  label: string;
  short: string;
  n: number;
}

/** Narrowest a tag gets; narrower columns spread their tags around the strip's centre instead. */
export const MIN_TAG = 44;

/**
 * Picks ONE layout for the whole strip, so the tags read as a set: `full` (step, name, count), `name`
 * (name, count), `tall` (name over count), `short` (short name, count) or `stack` (short name over
 * count); stacked tiers use the size that fits the tightest tag. Returns the tier and the label size.
 */
export function fitStrip(tags: StripTag[], base: number, face = 'Inter, sans-serif'): [TagFit, number] {
  const chip = (n: number) => Math.max(18, 10 + String(n).length * 0.6 * (base - 1));
  const fits = (need: (t: StripTag) => number) => tags.every((t) => t.w >= need(t));
  if (fits((t) => 33 + textW(t.label, base, face) + chip(t.n))) return ['full', base];
  if (fits((t) => 20 + textW(t.label, base, face) + chip(t.n))) return ['name', base];
  for (let px = base - 1; px >= 10; px -= 0.5) if (fits((t) => 6 + textW(t.label, px, face))) return ['tall', px];
  if (fits((t) => 20 + textW(t.short, base, face) + chip(t.n))) return ['short', base];
  for (let px = base - 1; px > 8; px -= 0.5) if (fits((t) => 6 + textW(t.short, px, face))) return ['stack', px];
  return ['stack', 8];
}

/** Height of the top bar the strip must stay under. */
const TOP_MIN = 104;

/**
 * Projects each district column to the screen and lays the ONE header strip across them: every cell
 * spans its column's projected width, so a label sits over its column. In the city the strip floats
 * above the district landmarks so it never hides them; in the Pipeline board (no landmarks) it hugs
 * the board's back edge.
 */
export function StripProjector({ layout }: { layout: SceneLayout }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const bar = strip.bar;
    if (!bar) return;
    const k = morphK();
    // city: just above the landmark tops; pipeline: the board's back edge at deck height
    const zCity = layout.bounds.minZ - 2.4 - LANDMARK.back;
    const z = zCity + (layout.pipe.backZ - zCity) * k;
    const lift = (1 - k) * (LANDMARK.height * LANDMARK.scale);
    const xs: number[] = [];
    let yTop = Infinity;
    let behind = false;
    for (const p of PHASES) {
      for (const x of [cellX(p) - BAND_W / 2, cellX(p) + BAND_W / 2]) {
        v.set(x, SKY_Y + lift, z).project(camera);
        if (v.z > 1) behind = true;
        xs.push((v.x * 0.5 + 0.5) * size.width);
        yTop = Math.min(yTop, (-v.y * 0.5 + 0.5) * size.height);
      }
    }
    if (behind || !Number.isFinite(yTop)) {
      bar.style.visibility = 'hidden';
      return;
    }
    const h = bar.offsetHeight || 34;
    const y = Math.max(TOP_MIN, Math.min(size.height - h - 60, yTop - h - 8));
    family ||= getComputedStyle(bar).fontFamily;
    const base = document.body.dataset.layout === 'pipeline' ? 14 : 12;
    // columns too narrow for a readable tag: lay the tags at MIN_TAG pitch, centred on the board
    const pitch = (xs[xs.length - 1] - xs[0]) / PHASES.length;
    const spread = pitch < MIN_TAG + 6;
    const mid = (xs[0] + xs[xs.length - 1]) / 2;
    const cells = PHASES.map((_, i) => (spread ? [mid + (i - PHASES.length / 2) * (MIN_TAG + 6), MIN_TAG + 6] : [xs[i * 2], xs[i * 2 + 1] - xs[i * 2]]));
    const left = cells[0][0];
    const right = cells[cells.length - 1][0] + cells[cells.length - 1][1];
    bar.style.visibility = right < 0 || left > size.width ? 'hidden' : 'visible';
    bar.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(y)}px, 0)`;
    bar.style.width = `${Math.round(right - left)}px`;
    const tags: StripTag[] = [];
    PHASES.forEach((p, i) => {
      const el = strip.cells.get(p);
      if (!el) return;
      // a small gap between tags so the landmarks show through between them
      const cw = Math.max(0, Math.round(cells[i][1] - 6));
      el.style.left = `${Math.round(cells[i][0] - left + 3)}px`;
      el.style.width = `${cw}px`;
      tags.push({ w: cw, label: PHASE_LABEL[p] ?? p, short: phaseTiny(p), n: Number(el.dataset.n ?? 0) });
    });
    // re-fit only when a width, count or the layout changed
    const key = `${base}|${tags.map((t) => `${t.w}:${t.n}:${t.label}`).join(',')}`;
    if (bar.dataset.fitKey === key) return;
    bar.dataset.fitKey = key;
    const [fit, px] = fitStrip(tags, base, family);
    bar.dataset.fit = fit;
    bar.style.setProperty('--fs', `${px}px`);
  });
  return null;
}

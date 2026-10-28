import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useWorld } from '../store';
import { plates } from './plateRegistry';
import { REDUCED_SECONDS, reducedMotion } from '../ui/motionPrefs';
import { useIslandsView } from '../ui/worldLayout';

/** Layout morph between the island city (0) and the Pipeline kanban (1). Mutable so frames read it without re-rendering. */
export const morph = { value: 0, target: 0 };

export const MORPH_SECONDS = 0.8;
/** How far islands, buildings and the Control Tower sink in Pipeline mode. */
export const PIPE_SINK = 6;
/** Opacity islands keep in Pipeline mode. */
export const PIPE_FADE = 0.1;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Eased morph amount, 0..1. */
export const morphK = () => ease(morph.value);

export const isPipeline = (preset: string) => preset === 'pipeline';

/** Drives the morph toward the store's preset and mirrors it on <body data-layout> for plate CSS. */
export function MorphDriver() {
  const preset = useWorld((s) => s.preset);
  useEffect(() => {
    morph.target = isPipeline(preset) ? 1 : 0;
    document.body.dataset.layout = isPipeline(preset) ? 'pipeline' : 'city';
    // plate sizes change with the layout CSS; make the projector measure them again
    requestAnimationFrame(() => {
      for (const p of plates.values()) p.w = p.h = 0;
    });
  }, [preset]);
  useFrame((_, dt) => {
    if (morph.value === morph.target) return;
    const step = Math.min(dt, 0.1) / (reducedMotion() ? REDUCED_SECONDS : MORPH_SECONDS);
    morph.value = morph.target > morph.value ? Math.min(morph.target, morph.value + step) : Math.max(morph.target, morph.value - step);
  });
  return null;
}

/** Layout morph between the grid (0) and big islands (1): the boulevard fades and sinks while islands, buildings and pods move. */
export const islandMorph = { value: 0, target: 0 };

/** Seconds islands, buildings and pods take to move between the grid and big islands. */
export const LAYOUT_SECONDS = 1.1;
/** How far the boulevard (district bands, lanes, landmarks, ramps) sinks as it fades out under big islands. */
export const BOULEVARD_SINK = 5;

/** Eased islands morph amount, 0..1. */
export const islandsK = () => ease(islandMorph.value);

/** Drives the islands morph toward the chosen layout and mirrors it on <body data-world>. The first frame starts settled. */
export function IslandsDriver() {
  const on = useIslandsView();
  const first = useRef(true);
  useEffect(() => {
    islandMorph.target = on ? 1 : 0;
    if (first.current) islandMorph.value = islandMorph.target;
    first.current = false;
    document.body.dataset.world = on ? 'islands' : 'grid';
  }, [on]);
  useFrame((_, dt) => {
    if (islandMorph.value === islandMorph.target) return;
    const step = Math.min(dt, 0.1) / (reducedMotion() ? REDUCED_SECONDS : LAYOUT_SECONDS);
    islandMorph.value = islandMorph.target > islandMorph.value ? Math.min(islandMorph.target, islandMorph.value + step) : Math.max(islandMorph.target, islandMorph.value - step);
  });
  return null;
}

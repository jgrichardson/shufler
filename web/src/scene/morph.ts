import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useWorld } from '../store';
import { plates } from './plateRegistry';
import { REDUCED_SECONDS, reducedMotion } from '../ui/motionPrefs';

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

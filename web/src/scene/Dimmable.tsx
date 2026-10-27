import { useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { flagTree } from './materialVariants';

/**
 * Greys out everything under it while `on` (the focus treatment). Works on any skin's meshes without
 * the skin doing anything. It re-applies every few frames while on, so meshes that mount or get a new
 * material mid-focus pick it up.
 */
export function Dimmable({ on, children }: { on: boolean; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const last = useRef(false);
  const frames = useRef(0);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    frames.current++;
    if (on === last.current && !(on && frames.current % 20 === 0)) return;
    last.current = on;
    flagTree(g, 'vDim', on);
  });
  return <group ref={group}>{children}</group>;
}

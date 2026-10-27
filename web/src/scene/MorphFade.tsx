import { useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PIPE_SINK, morphK } from './morph';
import { flagTree } from './materialVariants';

/** Islands, buildings and the Control Tower: fade to 10% and sink in Pipeline mode. */
export function MorphFade({ children, sink = PIPE_SINK }: { children: ReactNode; sink?: number }) {
  const group = useRef<THREE.Group>(null);
  const last = useRef(0);
  const frames = useRef(0);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const k = morphK();
    frames.current++;
    // re-apply now and then while faded, so meshes mounted mid-mode pick it up
    if (k === last.current && !(k > 0 && frames.current % 30 === 0)) return;
    last.current = k;
    g.position.y = -sink * k;
    flagTree(g, 'vFade', k);
  });
  return <group ref={group}>{children}</group>;
}

/** Squeezes lane geometry toward midZ along z (lane pitch 9 to 1.2). */
export function MorphSqueeze({ children, midZ, scale }: { children: ReactNode; midZ: number; scale: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const s = 1 + (scale - 1) * morphK();
    g.scale.z = s;
    g.position.z = midZ * (1 - s);
  });
  return <group ref={group}>{children}</group>;
}

/** Moves children by `dz` along z in Pipeline mode (district landmarks follow the squeezed back edge). */
export function MorphShift({ children, dz }: { children: ReactNode; dz: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (group.current) group.current.position.z = dz * morphK();
  });
  return <group ref={group}>{children}</group>;
}

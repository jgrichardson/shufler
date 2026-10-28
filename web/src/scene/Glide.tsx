import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { REDUCED_SECONDS, reducedMotion } from '../ui/motionPrefs';
import { LAYOUT_SECONDS } from './morph';
import type { Vec3 } from './layout';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Share of the glide the size change takes: shrinking happens first, growing last, so things travel small. */
const SIZE_SHARE = 0.55;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

interface GlideState {
  mode: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromSize: number;
  size: number;
  /** The size drawn this frame. */
  cur: number;
  t: number;
}

/**
 * Places its children at `pos`. When the layout `mode` changes (grid and big islands), it glides there
 * instead of jumping, and grows or shrinks from the size it was drawn at (shrinking early, growing late): `size` is the drawn size in any
 * unit (a radius, a building scale), `scale` the group's own scale at rest. Any other move snaps, as before.
 */
export function Glide({ pos, mode, size = 1, scale = 1, children }: { pos: Vec3; mode: string; size?: number; scale?: number; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const st = useRef<GlideState | null>(null);
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    const prev = st.current;
    const to = new THREE.Vector3(...pos);
    if (!prev || prev.mode === mode) {
      g.position.copy(to);
      g.scale.setScalar(scale);
      st.current = { mode, from: to, to, fromSize: size, size, cur: size, t: 1 };
      return;
    }
    // start from wherever and however big it is drawn now, even mid-glide
    st.current = { mode, from: g.position.clone(), to, fromSize: prev.cur, size, cur: prev.cur, t: 0 };
    g.scale.setScalar((scale * prev.cur) / size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos[0], pos[1], pos[2], mode, size, scale]);
  useFrame((_, dt) => {
    const g = group.current;
    const s = st.current;
    if (!g || !s || s.t >= 1) return;
    s.t = Math.min(1, s.t + Math.min(dt, 0.1) / (reducedMotion() ? REDUCED_SECONDS : LAYOUT_SECONDS));
    const k = ease(s.t);
    const ks = ease(clamp01(s.size < s.fromSize ? s.t / SIZE_SHARE : (s.t - (1 - SIZE_SHARE)) / SIZE_SHARE));
    s.cur = s.fromSize + (s.size - s.fromSize) * ks;
    g.position.lerpVectors(s.from, s.to, k);
    g.scale.setScalar((scale * s.cur) / s.size);
  });
  return <group ref={group}>{children}</group>;
}

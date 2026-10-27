import { useMemo } from 'react';
import type { LandmarkProps } from '../api';
import { useKit } from './kit';
import { Platform, Scatter, scatterProps } from './Island';
import { pyramidRoof, taperedPrism } from './Session';

const PHASE_SEED: Record<string, number> = { brainstorm: 11, plan: 23, build: 37, qa: 41, review: 53, merge: 67, deploy: 79 };

/** A stone tower with windows in the phase accent and a slate (or domed) roof. */
function Tower({ x, z, w, h, accent, lit, dome = false }: { x: number; z: number; w: number; h: number; accent: string; lit: boolean; dome?: boolean }) {
  const kit = useKit();
  const geo = useMemo(() => ({ shaft: taperedPrism(w, w * 0.84, h, 0.75), roof: pyramidRoof(w * 1.2, w * 0.95) }), [w, h]);
  const win = kit.glow(accent, lit ? 2.2 : 0.9);
  const rows = Math.max(1, Math.floor(h / 1.3));
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={geo.shaft} position={[0, h / 2, 0]} material={kit.stone} castShadow receiveShadow />
      {dome ? (
        <mesh position={[0, h, 0]} material={kit.slate} castShadow>
          <sphereGeometry args={[w * 0.62, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      ) : (
        <mesh geometry={geo.roof} position={[0, h + w * 0.475, 0]} material={kit.slate} castShadow />
      )}
      {Array.from({ length: rows }, (_, i) =>
        [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((rot) => (
          <mesh key={`${i}${rot}`} rotation={[0, rot, 0]} position={[Math.sin(rot) * (w * 0.47 + 0.01), 0.9 + i * 1.3, Math.cos(rot) * (w * 0.47 + 0.01)]} material={win}>
            <planeGeometry args={[0.2, 0.7]} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** The district landmark: an island with the phase's tower group, its windows and crystal lit in the phase accent. */
export function Landmark({ phase, accent, active, lit }: LandmarkProps) {
  const kit = useKit();
  const seed = PHASE_SEED[phase] ?? 5;
  const props = useMemo(() => scatterProps(seed * 31, 3.4, 3.4, 7, [[0, 0, 1.6], [1.3, 0, 1.2], [-1.3, 0, 1.2], [-1.6, 0.6, 1.0]]), [seed]);
  const crystal = kit.glow(accent, active ? 3.2 : lit ? 2.4 : 1.2);
  const towers: { x: number; z: number; w: number; h: number; dome?: boolean }[] =
    phase === 'brainstorm'
      ? [{ x: 0, z: 0, w: 1.8, h: 3.2, dome: true }]
      : phase === 'plan'
        ? [{ x: -0.8, z: 0, w: 1.3, h: 4.2 }, { x: 0.9, z: 0.3, w: 1.1, h: 3.0 }]
        : phase === 'merge'
          ? [{ x: -1.1, z: 0, w: 1.2, h: 4.6 }, { x: 1.1, z: 0, w: 1.2, h: 4.6 }]
          : phase === 'qa'
            ? [{ x: 0, z: 0, w: 1.2, h: 6.0 }]
            : phase === 'deploy'
              ? [{ x: 0.4, z: 0, w: 1.6, h: 3.6 }, { x: -1.6, z: 0.6, w: 1.0, h: 2.2 }]
              : [{ x: 0, z: 0, w: 1.7, h: 5.0 }];
  const tallest = Math.max(...towers.map((t) => t.h + t.w));
  return (
    <Platform radius={3.5} seed={seed * 97}>
      <Scatter props={props} />
      {towers.map((t, i) => (
        <Tower key={i} {...t} accent={accent} lit={lit || active} />
      ))}
      {phase === 'merge' && (
        <mesh position={[0, 3.6, 0]} material={kit.stoneDark} castShadow>
          <boxGeometry args={[1.2, 0.4, 0.8]} />
        </mesh>
      )}
      <mesh position={[towers[0].x, tallest + 0.6, towers[0].z]} scale={[1, 1.7, 1]} material={crystal}>
        <octahedronGeometry args={[0.32, 0]} />
      </mesh>
    </Platform>
  );
}

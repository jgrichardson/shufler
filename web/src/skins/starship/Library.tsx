import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type LibraryProps } from '../api';
import { useKit } from './kit';

/* The context library: a glass archive spire ringed by tiers of data slabs, one slab lit per library item. */

const TIERS = [1.75, 3.15, 4.55];
const PER_TIER = 8;
const SLAB_R = 2.6;

function SlabRing({ y, tier, items, lit, edge, glass, dir }: { y: number; tier: number; items: number; lit: THREE.Material; edge: THREE.Material; glass: THREE.Material; dir: number }) {
  const ring = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ring.current && !reducedMotion()) ring.current.rotation.y = tier * 0.39 + clock.elapsedTime * 0.08 * dir;
  });
  return (
    <group ref={ring} position={[0, y, 0]} rotation={[0, tier * 0.39, 0]}>
      {Array.from({ length: PER_TIER }, (_, j) => {
        const a = (j / PER_TIER) * Math.PI * 2;
        const on = tier * PER_TIER + j < items;
        return (
          <group key={j} position={[Math.sin(a) * SLAB_R, 0, Math.cos(a) * SLAB_R]} rotation={[0, a, 0]}>
            <mesh material={glass} castShadow>
              <boxGeometry args={[0.92, 1.12, 0.07]} />
            </mesh>
            {on && (
              <mesh position={[0, 0, 0.045]} material={lit}>
                <planeGeometry args={[0.78, 0.98]} />
              </mesh>
            )}
            <mesh position={[0, -0.6, 0]} material={on ? edge : glass}>
              <boxGeometry args={[0.92, 0.05, 0.1]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function Library({ items, owed, active, hovered, dragging }: LibraryProps) {
  const k = useKit();
  const { p } = k;
  const strength = active ? 3 : hovered || dragging ? 2.5 : 1.9;
  const glow = k.light(p.light, strength);
  const amber = k.light(p.cityLights, 3.2);
  const lit = k.light(p.light, active ? 2.1 : 1.35);
  const halo = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const still = reducedMotion();
    if (halo.current && !still) halo.current.rotation.y = t * 0.2;
    if (beacon.current) beacon.current.scale.setScalar(owed > 0 && !still ? 1 + 0.25 * Math.sin(t * 3.2) : 1);
  });
  return (
    <group>
      {/* hex pad, like the district landmarks */}
      <mesh position={[0, -0.25, 0]} material={k.plated} receiveShadow castShadow>
        <cylinderGeometry args={[4.6, 4.4, 0.5, 6]} />
      </mesh>
      <mesh position={[0, -0.56, 0]} material={glow}>
        <cylinderGeometry args={[4.42, 4.42, 0.1, 6, 1, true]} />
      </mesh>
      <mesh position={[0, -1.6, 0]} material={k.deep} castShadow>
        <coneGeometry args={[4.2, 2.0, 6]} />
      </mesh>
      {/* plinth with a lit reading ring */}
      <mesh position={[0, 0.25, 0]} material={k.graphite} castShadow receiveShadow>
        <cylinderGeometry args={[3.35, 3.55, 0.5, 48]} />
      </mesh>
      <mesh position={[0, 0.51, 0]} rotation={[-Math.PI / 2, 0, 0]} material={glow}>
        <ringGeometry args={[3.05, 3.15, 64]} />
      </mesh>
      {/* the spine: smoked glass around a column of light, braced by titanium ribs */}
      <mesh position={[0, 3.2, 0]} material={k.glass} castShadow>
        <cylinderGeometry args={[1.0, 1.1, 5.4, 32]} />
      </mesh>
      <mesh position={[0, 3.2, 0]} material={glow}>
        <cylinderGeometry args={[0.16, 0.16, 5.3, 12]} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        return (
          <mesh key={i} position={[Math.sin(a) * 1.1, 3.2, Math.cos(a) * 1.1]} rotation={[0, a, 0]} material={k.ti} castShadow>
            <boxGeometry args={[0.32, 5.4, 0.14]} />
          </mesh>
        );
      })}
      {/* slab tiers: each rides a slim rail and turns slowly */}
      {TIERS.map((y, t) => (
        <group key={y}>
          <mesh position={[0, y - 0.68, 0]} rotation={[Math.PI / 2, 0, 0]} material={k.ti}>
            <torusGeometry args={[SLAB_R, 0.05, 6, 64]} />
          </mesh>
          {[0, 1, 2].map((s) => {
            const a = (s / 3) * Math.PI * 2 + t * 0.5;
            return (
              <group key={s} rotation={[0, a, 0]}>
                <mesh position={[0, y - 0.68, (SLAB_R + 1.05) / 2]} rotation={[Math.PI / 2, 0, 0]} material={k.ti}>
                  <cylinderGeometry args={[0.035, 0.035, SLAB_R - 1.05, 6]} />
                </mesh>
              </group>
            );
          })}
          <SlabRing y={y} tier={t} items={items} lit={lit} edge={glow} glass={k.glass} dir={t % 2 ? -1 : 1} />
        </group>
      ))}
      {/* crown: hull collar, glass dome, a precessing halo and the beacon */}
      <mesh position={[0, 6.1, 0]} material={k.hull} castShadow>
        <cylinderGeometry args={[1.25, 1.55, 0.5, 32]} />
      </mesh>
      <mesh position={[0, 6.35, 0]} material={k.glass} castShadow>
        <sphereGeometry args={[1.18, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, 6.37, 0]} material={owed > 0 ? amber : glow}>
        <cylinderGeometry args={[1.2, 1.2, 0.06, 32, 1, true]} />
      </mesh>
      <group ref={halo} position={[0, 6.6, 0]}>
        <mesh rotation={[Math.PI / 2 + 0.3, 0, 0]} material={owed > 0 ? amber : glow}>
          <torusGeometry args={[2.0, 0.045, 8, 72]} />
        </mesh>
      </group>
      <mesh position={[0, 7.75, 0]} material={k.ti}>
        <cylinderGeometry args={[0.05, 0.07, 0.9, 8]} />
      </mesh>
      <mesh ref={beacon} position={[0, 8.3, 0]} material={owed > 0 ? amber : glow}>
        <sphereGeometry args={[0.26, 16, 12]} />
      </mesh>
    </group>
  );
}

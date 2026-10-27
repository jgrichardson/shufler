import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rng, type IslandProps, type PlatformProps } from '../api';
import { BOULDER_GEO, BUSH_GEO, TREE_GEOS, islandVariant, useKit } from './kit';

/** One scattered prop: position on the island top, scale, turn, and kind (0..2 trees, 3 bush, 4 boulder). */
export interface Prop {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  kind: number;
}

/** Trees, bushes and boulders, instanced by kind: five draw calls whatever the count. */
export function Scatter({ props }: { props: Prop[] }) {
  const kit = useKit();
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const byKind = useMemo(() => [0, 1, 2, 3, 4].map((k) => props.filter((p) => p.kind === k)), [props]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    byKind.forEach((list, k) => {
      const mesh = refs.current[k];
      if (!mesh) return;
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        mesh.setMatrixAt(i, m.compose(v.set(p.x, p.y, p.z), q, s.set(p.s, p.s, p.s)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [byKind]);
  const geos = [...TREE_GEOS, BUSH_GEO, BOULDER_GEO];
  return (
    <>
      {byKind.map((list, k) =>
        list.length ? (
          <instancedMesh
            key={k}
            ref={(el) => (refs.current[k] = el)}
            args={[geos[k], k === 4 ? kit.boulder : kit.foliage, list.length]}
            castShadow
            receiveShadow
          />
        ) : null,
      )}
    </>
  );
}

/**
 * Props scattered over a unit-radius island top (scaled by rx, rz), keeping clear of `keepOut` spots
 * (in the same scaled frame) and of an optional band along x (a track).
 */
export function scatterProps(seed: number, rx: number, rz: number, want: number, keepOut: [number, number, number][] = [], trackHalf = 0, treeShare = 0.55): Prop[] {
  const r = rng(seed);
  const out: Prop[] = [];
  let guard = 0;
  while (out.length < want && guard++ < want * 40) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(0.15 + r() * 0.85) * 0.86;
    const x = Math.cos(a) * d * rx;
    const z = Math.sin(a) * d * rz;
    if (trackHalf && Math.abs(z) < trackHalf) continue;
    if (keepOut.some(([kx, kz, kr]) => (kx - x) ** 2 + (kz - z) ** 2 < kr * kr)) continue;
    if (out.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 0.25)) continue;
    const roll = r();
    const kind = roll < treeShare ? Math.floor(r() * 3) : roll < treeShare + (1 - treeShare) * 0.6 ? 3 : 4;
    out.push({ x, y: 0.02, z, s: (kind < 3 ? 0.75 : 0.9) + r() * 0.5, rot: r() * Math.PI * 2, kind });
  }
  return out;
}

/** A floating rock island: grass top at y = 0, carved rock hanging below. */
export function Platform({ radius, seed, stretch = 1, children }: PlatformProps) {
  const kit = useKit();
  const g = islandVariant(seed, 1.8);
  return (
    <group>
      <group scale={[radius * stretch, radius * 0.9, radius]}>
        <mesh geometry={g.top} material={kit.grass} receiveShadow />
        <mesh geometry={g.under} material={[kit.lip, kit.rock]} castShadow receiveShadow />
      </group>
      {children}
    </group>
  );
}

/** A row's home island: the session tower stands at its centre among trees, bushes and stones. */
export function Island({ island, buildingLocal }: IslandProps) {
  // drawn a little wider than the layout radius: the tower should stand on an island, not fill it
  const R = island.radius * 1.45;
  const props = useMemo(() => {
    const keep: [number, number, number][] = buildingLocal.map(([x, z]) => [x, z, 1.9]);
    // the east shoulder holds parked items; keep it clear
    keep.push([island.radius * 0.55, 0, 1.3]);
    return scatterProps(island.seed, R, R, Math.round(5 + R), keep);
  }, [island.seed, island.radius, R, buildingLocal]);
  return (
    <Platform radius={R} seed={island.seed} stretch={island.stretch}>
      <Scatter props={props} />
    </Platform>
  );
}

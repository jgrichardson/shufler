import { useMemo } from 'react';
import * as THREE from 'three';
import type { CrateProps, PodBodyProps, PodKind } from '../api';
import { useKit } from './kit';

/** Body per kind, standing on y=0, long axis along x. */
const geos: Record<PodKind, THREE.BufferGeometry> = {
  pr: (() => {
    const g = new THREE.CapsuleGeometry(0.5, 1.1, 6, 14);
    g.rotateZ(Math.PI / 2);
    g.translate(0, 0.55, 0);
    return g;
  })(),
  issue: (() => {
    const g = new THREE.BoxGeometry(1.5, 0.22, 1.1);
    g.translate(0, 0.16, 0);
    return g;
  })(),
  data_fix: (() => {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 14);
    g.translate(0, 0.62, 0);
    return g;
  })(),
  plan: (() => {
    const g = new THREE.BoxGeometry(1.2, 1.0, 0.18);
    g.translate(0, 0.55, 0);
    return g;
  })(),
  docs: (() => {
    const g = new THREE.BoxGeometry(1.3, 0.38, 0.95);
    g.translate(0, 0.22, 0);
    return g;
  })(),
};
const hoopGeo = (() => {
  const g = new THREE.TorusGeometry(0.52, 0.05, 6, 20);
  g.rotateY(Math.PI / 2);
  return g;
})();
const flagPoleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.0, 4);
const flagGeo = new THREE.PlaneGeometry(0.45, 0.3);
const pipGeo = new THREE.SphereGeometry(0.1, 8, 6);
const canopyGeo = new THREE.SphereGeometry(0.36, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const dotGeo = (() => {
  const g = new THREE.CylinderGeometry(0.8, 0.8, 0.28, 24);
  g.translate(0, 0.16, 0);
  return g;
})();

/** One lacquer material per hull colour, shared across pods. */
const lacquers = new Map<string, THREE.MeshPhysicalMaterial>();
function lacquer(color: string) {
  let m = lacquers.get(color);
  if (!m) lacquers.set(color, (m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12 })));
  return m;
}

/** Lacquered capsule (PR), tile (issue), canister (data fix), panel (plan) or slab (docs) in the domain colour. */
export function PodBody({ kind, hull, ballColor, dot, detail, pips }: PodBodyProps) {
  const kit = useKit();
  const body = lacquer(hull);
  if (dot) return <mesh geometry={dotGeo} material={body} />;
  return (
    <group>
      <mesh geometry={geos[kind]} material={body} castShadow />
      {kind === 'pr' && (
        <>
          <mesh geometry={canopyGeo} material={kit.glass} position={[0.55, 0.78, 0]} scale={[1, 0.7, 1]} />
          {detail && [-0.45, 0.45].map((x) => <mesh key={x} geometry={hoopGeo} position={[x, 0.55, 0]} material={kit.ti} />)}
        </>
      )}
      {kind === 'docs' && (
        <mesh position={[-0.62, 0.22, 0]} material={kit.graphite}>
          <boxGeometry args={[0.1, 0.4, 0.97]} />
        </mesh>
      )}
      {kind === 'issue' && (
        <group position={[0.55, 0.3, 0.35]}>
          <mesh geometry={flagPoleGeo} position={[0, 0.5, 0]} material={kit.ti} />
          <mesh geometry={flagGeo} position={[0.23, 0.85, 0]}>
            <meshStandardMaterial color={ballColor} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      {kind === 'data_fix' && [0.25, 1.0].map((y) => (
        <mesh key={y} position={[0, y, 0]} material={kit.ti}>
          <torusGeometry args={[0.51, 0.04, 6, 18]} />
        </mesh>
      ))}
      {pips && (
        <group position={[0, 0.55, 0.55]}>
          <mesh geometry={pipGeo} position={[-0.25, 0, 0]} material={kit.light(pips.reviewer, 2)} />
          <mesh geometry={pipGeo} position={[0.25, 0, 0]} material={kit.light(pips.ci, 2)} />
        </group>
      )}
    </group>
  );
}

const crateGeo = new THREE.BoxGeometry(1.25, 1.0, 1.25);
crateGeo.translate(0, 0.5, 0);
const bandGeo = new THREE.BoxGeometry(1.29, 0.24, 1.29);
bandGeo.translate(0, 0.52, 0);
const seamGeo = new THREE.BoxGeometry(0.34, 0.03, 1.29);
seamGeo.translate(0, 1.01, 0);

/** Cargo container: pale hull with a domain-colour band and lid seam. */
export function Crate({ color }: CrateProps) {
  const kit = useKit();
  const band = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }), [color]);
  return (
    <group>
      <mesh geometry={crateGeo} material={kit.pale} castShadow receiveShadow />
      <mesh geometry={bandGeo} material={band} />
      <mesh geometry={seamGeo} material={band} />
    </group>
  );
}

import * as THREE from 'three';
import type { CrateProps, PodBodyProps } from '../api';
import { texturedBox, useKit, mergeGeometries } from './kit';

/* Pods are little rail cars riding the track between islands: the body in the domain colour, lit windows. */

const chassisGeo = (() => {
  const g = new THREE.BoxGeometry(1.9, 0.12, 0.92);
  g.translate(0, 0.12, 0);
  return g;
})();
const wheelGeo = (() => {
  const parts = [-0.6, 0.6].flatMap((x) =>
    [-0.42, 0.42].map((z) => {
      const w = new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12);
      w.rotateX(Math.PI / 2);
      w.translate(x, -0.04, z);
      return w;
    }),
  );
  return mergeGeometries(parts);
})();
const carBodyGeo = (() => {
  const g = texturedBox(1.7, 0.66, 0.96, 1.2);
  g.translate(0, 0.51, 0);
  return g;
})();
const carRoofGeo = (() => {
  const g = new THREE.CylinderGeometry(0.56, 0.56, 1.84, 16, 1, false, -Math.PI / 2, Math.PI);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 0.42, 1);
  g.translate(0, 0.84, 0);
  return g;
})();
const winGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.5, 0, 0.5])
    for (const side of [-1, 1]) {
      const p = new THREE.PlaneGeometry(0.3, 0.26);
      if (side < 0) p.rotateY(Math.PI);
      p.translate(x, 0.6, side * 0.485);
      parts.push(p);
    }
  return mergeGeometries(parts);
})();
const tankGeo = (() => {
  const g = new THREE.CapsuleGeometry(0.42, 0.9, 6, 16);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.62, 0);
  return g;
})();
const bandGeo = (() => {
  const parts = [-0.35, 0.35].map((x) => {
    const t = new THREE.TorusGeometry(0.43, 0.035, 6, 20);
    t.rotateY(Math.PI / 2);
    t.translate(x, 0.62, 0);
    return t;
  });
  return mergeGeometries(parts);
})();
const bedGeo = (() => {
  const g = texturedBox(1.6, 0.24, 1.0, 1.2);
  g.translate(0, 0.3, 0);
  return g;
})();
const boardGeo = (() => {
  const g = texturedBox(1.25, 0.9, 0.12, 1.2);
  g.translate(0, 0.9, 0);
  return g;
})();
const bookGeo = (() => {
  const g = texturedBox(1.2, 0.5, 0.85, 1.2);
  g.translate(0, 0.55, 0);
  return g;
})();
const poleGeo = (() => {
  const g = new THREE.CylinderGeometry(0.03, 0.03, 1.0, 5);
  g.translate(0.55, 0.85, 0.32);
  return g;
})();
const flagGeo = (() => {
  const g = new THREE.PlaneGeometry(0.45, 0.3);
  g.translate(0.78, 1.18, 0.32);
  return g;
})();
const lampGeo = new THREE.SphereGeometry(0.07, 8, 6);
const pipGeo = new THREE.SphereGeometry(0.1, 8, 6);
const dotGeo = (() => {
  const g = new THREE.CylinderGeometry(0.8, 0.8, 0.28, 24);
  g.translate(0, 0.16, 0);
  return g;
})();

const flags = new Map<string, THREE.MeshStandardMaterial>();
const flagMat = (c: string) => {
  let m = flags.get(c);
  if (!m) flags.set(c, (m = new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.8 })));
  return m;
};

/** Rail car (PR), flatbed with a flag (issue), tank car (data fix), sign car (plan) or book car (docs). */
export function PodBody({ kind, hull, ballColor, dot, detail, pips }: PodBodyProps) {
  const kit = useKit();
  const body = kit.painted(hull);
  if (dot) return <mesh geometry={dotGeo} material={body} />;
  return (
    <group>
      <mesh geometry={chassisGeo} material={kit.iron} castShadow />
      {detail && <mesh geometry={wheelGeo} material={kit.iron} />}
      {kind === 'pr' && (
        <>
          <mesh geometry={carBodyGeo} material={body} castShadow receiveShadow />
          <mesh geometry={carRoofGeo} material={kit.plankDark} castShadow />
          <mesh geometry={winGeo} material={kit.glow(kit.p.podGlass, 1.7)} />
          <mesh geometry={lampGeo} position={[0.9, 0.5, 0]} material={kit.glow(kit.p.lantern, 3)} />
        </>
      )}
      {kind === 'issue' && (
        <>
          <mesh geometry={bedGeo} material={body} castShadow receiveShadow />
          <mesh geometry={poleGeo} material={kit.plankDark} />
          <mesh geometry={flagGeo} material={flagMat(ballColor)} />
        </>
      )}
      {kind === 'data_fix' && (
        <>
          <mesh geometry={tankGeo} material={body} castShadow receiveShadow />
          <mesh geometry={bandGeo} material={kit.iron} />
        </>
      )}
      {kind === 'plan' && (
        <>
          <mesh geometry={bedGeo} material={kit.plankDark} castShadow />
          <mesh geometry={boardGeo} material={body} castShadow />
        </>
      )}
      {kind === 'docs' && (
        <>
          <mesh geometry={bedGeo} material={kit.plankDark} castShadow />
          <mesh geometry={bookGeo} material={body} castShadow />
        </>
      )}
      {pips && (
        <group position={[0, 0.62, 0.55]}>
          <mesh geometry={pipGeo} position={[-0.25, 0, 0]} material={kit.glow(pips.reviewer, 2)} />
          <mesh geometry={pipGeo} position={[0.25, 0, 0]} material={kit.glow(pips.ci, 2)} />
        </group>
      )}
    </group>
  );
}

const crateGeo = (() => {
  const g = texturedBox(1.25, 1.0, 1.25, 1.1);
  g.translate(0, 0.5, 0);
  return g;
})();
/** Dark battens along the crate's edges. */
const battenGeo = (() => {
  const t = 0.09;
  const parts: THREE.BufferGeometry[] = [];
  for (const y of [0.045, 0.955])
    for (const z of [-0.6, 0.6]) {
      const b = texturedBox(1.29, t, t, 1);
      b.translate(0, y, z);
      parts.push(b);
    }
  for (const y of [0.045, 0.955])
    for (const x of [-0.6, 0.6]) {
      const b = texturedBox(t, t, 1.29, 1);
      b.translate(x, y, 0);
      parts.push(b);
    }
  for (const x of [-0.6, 0.6])
    for (const z of [-0.6, 0.6]) {
      const b = texturedBox(t, 1.0, t, 1);
      b.translate(x, 0.5, z);
      parts.push(b);
    }
  // a diagonal brace on the two long faces
  for (const z of [-0.63, 0.63]) {
    const b = texturedBox(1.45, 0.08, 0.04, 1);
    b.rotateZ(Math.atan2(0.9, 1.15));
    b.translate(0, 0.5, z);
    parts.push(b);
  }
  return mergeGeometries(parts);
})();
const stripeGeo = (() => {
  const g = new THREE.BoxGeometry(1.27, 0.2, 1.27);
  g.translate(0, 0.72, 0);
  return g;
})();

/** A wooden shipping crate with dark battens and a stripe of the domain colour. */
export function Crate({ color }: CrateProps) {
  const kit = useKit();
  return (
    <group>
      <mesh geometry={crateGeo} material={kit.plank} castShadow receiveShadow />
      <mesh geometry={battenGeo} material={kit.plankDark} castShadow />
      <mesh geometry={stripeGeo} material={kit.painted(color)} />
    </group>
  );
}

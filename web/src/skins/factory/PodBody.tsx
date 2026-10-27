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
const glassGeo = new THREE.SphereGeometry(0.36, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const spineGeo = new THREE.BoxGeometry(0.1, 0.4, 0.97);
const ringGeo = new THREE.TorusGeometry(0.51, 0.04, 6, 18);
const dotGeo = (() => {
  const g = new THREE.CylinderGeometry(0.8, 0.8, 0.28, 24);
  g.translate(0, 0.16, 0);
  return g;
})();

/** One double-sided flag material per ball colour. */
const flags = new Map<string, THREE.MeshStandardMaterial>();
function flagMat(color: string) {
  let m = flags.get(color);
  if (!m) flags.set(color, (m = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide })));
  return m;
}

/** Matte capsule (PR), tile (issue), canister (data fix), panel (plan) or book (docs) in the domain colour. */
export function PodBody({ kind, hull, ballColor, dot, detail, pips }: PodBodyProps) {
  const kit = useKit();
  if (dot) return <mesh geometry={dotGeo} material={kit.tint(hull, 0.45)} />;
  return (
    <group>
      <mesh geometry={geos[kind]} material={kit.tint(hull, 0.38, 0.12)} castShadow />
      {kind === 'pr' && (
        <>
          <mesh geometry={glassGeo} material={kit.podGlass} position={[0.55, 0.78, 0]} scale={[1, 0.7, 1]} />
          {detail && [-0.45, 0.45].map((x) => <mesh key={x} geometry={hoopGeo} position={[x, 0.55, 0]} material={kit.podHoop} />)}
        </>
      )}
      {kind === 'docs' && <mesh geometry={spineGeo} position={[-0.62, 0.22, 0]} material={kit.podSpine} />}
      {kind === 'issue' && (
        <group position={[0.55, 0.3, 0.35]}>
          <mesh geometry={flagPoleGeo} position={[0, 0.5, 0]} material={kit.podPole} />
          <mesh geometry={flagGeo} position={[0.23, 0.85, 0]} material={flagMat(ballColor)} />
        </group>
      )}
      {kind === 'data_fix' && [0.25, 1.0].map((y) => <mesh key={y} geometry={ringGeo} position={[0, y, 0]} material={kit.podRing} />)}
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
const stripeGeo = new THREE.BoxGeometry(1.29, 0.24, 1.29);
stripeGeo.translate(0, 0.52, 0);
const tapeGeo = new THREE.BoxGeometry(0.34, 0.03, 1.29);
tapeGeo.translate(0, 1.01, 0);

/** Kraft cardboard crate with a domain-colour stripe and tape. */
export function Crate({ color }: CrateProps) {
  const kit = useKit();
  const stripe = kit.tint(color, 0.6);
  return (
    <group>
      <mesh geometry={crateGeo} material={kit.kraft} castShadow receiveShadow />
      <mesh geometry={stripeGeo} material={stripe} />
      <mesh geometry={tapeGeo} material={stripe} />
    </group>
  );
}

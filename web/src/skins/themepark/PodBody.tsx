import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type CrateProps, type PodBodyProps } from '../api';
import { box, isAlarm, mergeGeometries, post, useKit } from './kit';

/*
 * Pods are ride cars on the coaster: a painted body in the domain colour on a dark bogie, with the core's
 * status lamp riding on a short beacon mast. A car whose ball is with the user is stalled: its hazard
 * lamps flash red at all four corners (the core adds the red beam and ring on top).
 */

/** Side profile of the coaster car tub (x along the car, y up), extruded across the car. */
function profileCar(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.92, 0.2);
  s.lineTo(0.62, 0.2);
  // the scooped nose
  s.quadraticCurveTo(0.98, 0.2, 0.98, 0.5);
  s.quadraticCurveTo(0.98, 0.78, 0.7, 0.8);
  s.lineTo(0.5, 0.66);
  s.lineTo(-0.82, 0.66);
  s.quadraticCurveTo(-0.95, 0.66, -0.95, 0.5);
  s.lineTo(-0.95, 0.3);
  s.quadraticCurveTo(-0.95, 0.2, -0.92, 0.2);
  return s;
}

/** Extrudes a side profile to a body `w` wide, centred on z, with a soft bevel. */
function extrudeBody(shape: THREE.Shape, w: number, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: w - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(w - bevel * 2) / 2);
  g.computeVertexNormals();
  return g;
}

const W = 0.9;
const bogieGeo = (() => {
  const parts = [box(1.7, 0.1, 0.62, 0, 0.14, 0)];
  // wheel sets that sit on the rails (rail spacing over the pod's usual scale)
  for (const x of [-0.6, 0.6])
    for (const z of [-0.3, 0.3]) parts.push(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 10).rotateX(Math.PI / 2).translate(x, 0.08, z));
  return mergeGeometries(parts);
})();
const carGeo = extrudeBody(profileCar(), W);
const seatGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.5, 0.12]) {
    parts.push(box(0.14, 0.34, W - 0.16, x, 0.8, 0));
    parts.push(box(0.4, 0.06, W - 0.16, x + 0.2, 0.64, 0));
  }
  return mergeGeometries(parts);
})();
const barGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.2, 0.42]) parts.push(new THREE.CylinderGeometry(0.03, 0.03, W - 0.2, 6).rotateX(Math.PI / 2).translate(x, 0.82, 0));
  // the beacon mast: the core's status lamp sits on top of it
  parts.push(post(-0.14, 0, 0.66, 1.18, 0.035, 6));
  parts.push(new THREE.CylinderGeometry(0.09, 0.05, 0.08, 10).translate(-0.14, 1.2, 0));
  return mergeGeometries(parts);
})();
/** A cream stripe along each side of the tub. */
const stripeGeo = (() => {
  const parts = [-1, 1].map((s) => box(1.5, 0.07, 0.02, -0.12, 0.47, s * (W / 2 + 0.006)));
  return mergeGeometries(parts);
})();
const headGeo = new THREE.SphereGeometry(0.07, 10, 8).scale(0.6, 1, 1).translate(0.99, 0.5, 0);
/** Hazard lamps on the four corners, lit when the car is stalled. */
const hazardGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.92, 0.86]) for (const z of [-1, 1]) parts.push(new THREE.SphereGeometry(0.1, 10, 8).translate(x, 0.76, z * (W / 2 - 0.02)));
  return mergeGeometries(parts);
})();

// issue: a low open runabout with a pennant
const runGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.85, 0.2);
  s.lineTo(0.7, 0.2);
  s.quadraticCurveTo(0.92, 0.2, 0.92, 0.36);
  s.lineTo(0.84, 0.46);
  s.lineTo(-0.85, 0.46);
  s.lineTo(-0.85, 0.2);
  return extrudeBody(s, W);
})();
const runSeatGeo = box(0.12, 0.12, W - 0.2, -0.25, 0.52, 0);
const poleGeo = post(-0.7, 0, 0.4, 1.25, 0.025, 5);
const pennantGeo = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.69, 1.24, 0, -0.69, 0.96, 0, -0.25, 1.1, 0], 3));
  g.computeVertexNormals();
  return g;
})();

// data fix: a tank car
const tankGeo = new THREE.CapsuleGeometry(0.4, 0.95, 6, 18).rotateZ(Math.PI / 2).translate(0, 0.66, 0);
const tankBandGeo = mergeGeometries([-0.35, 0.35].map((x) => new THREE.TorusGeometry(0.41, 0.035, 6, 24).rotateY(Math.PI / 2).translate(x, 0.66, 0)));
const domeGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.18, 12).translate(0.25, 1.1, 0);

// plan: a flat car carrying a sign board in the domain colour
const flatGeo = box(1.75, 0.16, W, 0, 0.28, 0, 1.2);
const boardGeo = box(1.3, 0.62, 0.08, 0, 0.88, -0.05);
const boardFrameGeo = mergeGeometries([post(-0.6, -0.05, 0.36, 1.2, 0.035, 6), post(0.6, -0.05, 0.36, 1.2, 0.035, 6), box(1.38, 0.05, 0.1, 0, 1.2, -0.05)]);

// docs: a covered mail car
const mailGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.8, 0.2);
  s.lineTo(0.8, 0.2);
  s.lineTo(0.8, 0.5);
  s.quadraticCurveTo(0.8, 0.58, 0.72, 0.58);
  s.lineTo(-0.72, 0.58);
  s.quadraticCurveTo(-0.8, 0.58, -0.8, 0.5);
  s.lineTo(-0.8, 0.2);
  return extrudeBody(s, W - 0.06, 0.04);
})();
const mailBandGeo = box(0.12, 0.4, W - 0.02, 0, 0.4, 0);

const pipGeo = new THREE.SphereGeometry(0.1, 10, 8);
/** Overview token: a round ride token in the domain colour with a gold rim. */
const dotGeo = new THREE.CylinderGeometry(0.78, 0.8, 0.26, 28).translate(0, 0.15, 0);
const dotRimGeo = new THREE.TorusGeometry(0.79, 0.06, 6, 32).rotateX(Math.PI / 2).translate(0, 0.28, 0);

const flags = new Map<string, THREE.MeshStandardMaterial>();
const flagMat = (c: string) => {
  let m = flags.get(c);
  if (!m) flags.set(c, (m = new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.7 })));
  return m;
};

/** Hazard lamps that flash while the car is stalled (steady when the user asked for less motion). */
function Hazards({ color }: { color: string }) {
  const kit = useKit();
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.visible = reducedMotion() || Math.sin(clock.elapsedTime * 7) > -0.1;
  });
  return <mesh ref={ref} geometry={hazardGeo} material={kit.glow(color, 3)} />;
}

/** Coaster car (PR), runabout with a pennant (issue), tank car (data fix), sign car (plan) or mail car (docs). */
export function PodBody({ kind, hull, ballColor, dot, detail, pips }: PodBodyProps) {
  const kit = useKit();
  const body = kit.painted(hull);
  if (dot)
    return (
      <group>
        <mesh geometry={dotGeo} material={body} />
        <mesh geometry={dotRimGeo} material={kit.gold} />
      </group>
    );
  const stalled = isAlarm(ballColor);
  return (
    <group>
      <mesh geometry={bogieGeo} material={kit.tie} castShadow />
      {kind === 'pr' && (
        <>
          <mesh geometry={carGeo} material={body} castShadow receiveShadow />
          {detail && <mesh geometry={stripeGeo} material={kit.trim} />}
          <mesh geometry={seatGeo} material={kit.seat} castShadow />
          <mesh geometry={barGeo} material={kit.steel} />
          <mesh geometry={headGeo} material={kit.glow(kit.p.bulb, 2.6)} />
        </>
      )}
      {kind === 'issue' && (
        <>
          <mesh geometry={runGeo} material={body} castShadow receiveShadow />
          <mesh geometry={runSeatGeo} material={kit.seat} />
          <mesh geometry={poleGeo} material={kit.steel} />
          <mesh geometry={pennantGeo} material={flagMat(ballColor)} />
        </>
      )}
      {kind === 'data_fix' && (
        <>
          <mesh geometry={flatGeo} material={kit.steelDark} castShadow />
          <mesh geometry={tankGeo} material={body} castShadow receiveShadow />
          <mesh geometry={tankBandGeo} material={kit.trim} />
          <mesh geometry={domeGeo} material={kit.steel} />
        </>
      )}
      {kind === 'plan' && (
        <>
          <mesh geometry={flatGeo} material={kit.steelDark} castShadow />
          <mesh geometry={boardFrameGeo} material={kit.trim} />
          <mesh geometry={boardGeo} material={body} castShadow />
        </>
      )}
      {kind === 'docs' && (
        <>
          <mesh geometry={mailGeo} material={body} castShadow receiveShadow />
          <mesh geometry={mailBandGeo} material={kit.trim} />
        </>
      )}
      {stalled && <Hazards color={ballColor} />}
      {pips && (
        <group position={[0, 0.62, W / 2 + 0.12]}>
          <mesh geometry={pipGeo} position={[-0.25, 0, 0]} material={kit.glow(pips.reviewer, 2)} />
          <mesh geometry={pipGeo} position={[0.25, 0, 0]} material={kit.glow(pips.ci, 2)} />
        </group>
      )}
    </group>
  );
}

/* ---------- shipped items: gift boxes ---------- */

const giftGeo = box(1.16, 0.86, 1.16, 0, 0.43, 0);
const lidGeo = box(1.25, 0.2, 1.25, 0, 0.94, 0);
const ribbonGeo = mergeGeometries([box(1.27, 1.06, 0.2, 0, 0.53, 0), box(0.2, 1.06, 1.27, 0, 0.53, 0)]);
const bowGeo = mergeGeometries([
  new THREE.TorusGeometry(0.16, 0.05, 6, 14).rotateY(Math.PI / 4).rotateZ(0.5).translate(-0.12, 1.12, 0),
  new THREE.TorusGeometry(0.16, 0.05, 6, 14).rotateY(Math.PI / 4).rotateZ(-0.5).translate(0.12, 1.12, 0),
  new THREE.SphereGeometry(0.07, 8, 6).translate(0, 1.07, 0),
]);

/** A wrapped gift box in the domain colour with a cream ribbon and bow. */
export function Crate({ color }: CrateProps) {
  const kit = useKit();
  return (
    <group>
      <mesh geometry={giftGeo} material={kit.painted(color, 0.55)} castShadow receiveShadow />
      <mesh geometry={lidGeo} material={kit.painted(color, 0.45)} castShadow />
      <mesh geometry={ribbonGeo} material={kit.painted(kit.p.ribbon, 0.4)} />
      <mesh geometry={bowGeo} material={kit.painted(kit.p.ribbon, 0.4)} />
    </group>
  );
}

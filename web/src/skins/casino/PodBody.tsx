import { useId, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type CrateProps, type PodBodyProps } from '../api';
import { RANKS, backTexture, chipEdgeTexture, chipTopTexture, faceTexture, jokerTexture } from './cards';
import { flatShape, hash, isAlarm, roundedRect, useKit } from './kit';

/*
 * Pods are playing cards on the felt. Zoomed in, each lies face up: rank and suit from the item (pull
 * requests are spades, issues hearts, data fixes diamonds, plans and docs clubs), framed in the row's
 * colour. In the calm overview the cards lie face down, showing a back in the row's colour with the house
 * monogram. A card whose ball is with the user is a red joker, face up even in the overview, on a softly
 * pulsing red rim; the core's red beam and ring stay on top. When a card moves it is dealt: it lifts, its
 * leading edge rises as it slides, and it taps down and settles where it lands.
 */

/** Card size in pod units: about 2 x 2.8 on the board at the core's usual pod scale. */
export const CW = 1.3;
export const CH = 1.82;
const T = 0.05;
const R = 0.13;

const shape = roundedRect(CW, CH, R);
const edgeGeo = (() => {
  const g = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g.translate(0, -T / 2, 0);
})();
const faceGeo = flatShape(shape, CW, CH, true).translate(0, T / 2 + 0.002, 0);
const backGeo = flatShape(shape, CW, CH, false).translate(0, -T / 2 - 0.002, 0);
/** Soft red rim under a needs-you card. */
const rimGeo = flatShape(roundedRect(CW + 0.26, CH + 0.26, R + 0.12), CW + 0.26, CH + 0.26, true).translate(0, 0.004, 0);
/** A faint shadow plate so a card reads off the felt even in flat light. */
const shadowGeo = flatShape(roundedRect(CW + 0.08, CH + 0.08, R + 0.04), CW + 0.08, CH + 0.08, true).translate(0.05, 0.003, 0.07);
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false });

const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30').multiplyScalar(2.2), toneMapped: false, transparent: true, depthWrite: false });

/** Lammers: the two review markers (review bot, CI) as small glowing buttons beside the card. */
const lammerGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.07, 20).translate(0, 0.035, 0);
const lammerRimGeo = new THREE.TorusGeometry(0.17, 0.025, 6, 20).rotateX(Math.PI / 2).translate(0, 0.07, 0);

const faceMats = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
function cardMat(t: THREE.Texture | null, fallback: string): THREE.MeshStandardMaterial {
  if (!t) return new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.5 });
  let m = faceMats.get(t);
  if (!m) faceMats.set(t, (m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.42, metalness: 0 })));
  return m;
}
const jokerMats = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
function jokerMat(t: THREE.Texture | null): THREE.MeshStandardMaterial {
  if (!t) return new THREE.MeshStandardMaterial({ color: '#f3d6d6' });
  let m = jokerMats.get(t);
  if (!m) jokerMats.set(t, (m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.42, emissive: '#ff2a1f', emissiveIntensity: 0 })));
  return m;
}

const tmp = new THREE.Vector3();

/**
 * The dealt-card motion, layered on the core's travel: reads how fast the card moves in the world, lifts it
 * and raises its leading edge while it slides, lets it tap down and rock to rest on a spring when it stops,
 * and turns it over (lifting it on its edge) when it flips between face down and face up.
 */
function Dealt({ faceUp, children }: { faceUp: boolean; children: ReactNode }) {
  const probe = useRef<THREE.Group>(null);
  const card = useRef<THREE.Group>(null);
  const s = useRef({ prev: null as THREE.Vector3 | null, v: 0, dir: 1, lift: 0, liftV: 0, tilt: 0, tiltV: 0, flip: faceUp ? 0 : 1 });
  useFrame((_, rawDt) => {
    const p = probe.current;
    const c = card.current;
    if (!p || !c) return;
    const dt = Math.min(rawDt, 0.05);
    const st = s.current;
    p.getWorldPosition(tmp);
    if (st.prev && dt > 0) {
      const dx = tmp.x - st.prev.x;
      const dz = tmp.z - st.prev.z;
      const speed = Math.hypot(dx, dz) / dt;
      st.v += (speed - st.v) * Math.min(1, dt * 12);
      if (Math.abs(dx) > 1e-4) st.dir = Math.sign(dx);
      st.prev.copy(tmp);
    } else st.prev = tmp.clone();
    const target = faceUp ? 0 : 1;
    if (reducedMotion()) {
      st.flip = target;
      st.lift = st.tilt = 0;
    } else {
      const moving = st.v > 0.4;
      const wantLift = moving ? Math.min(0.32, 0.06 + st.v * 0.025) : 0;
      const wantTilt = moving ? st.dir * Math.min(0.2, st.v * 0.018) : 0;
      // underdamped springs: the card overshoots a touch and taps down when it lands
      st.liftV += (140 * (wantLift - st.lift) - 10 * st.liftV) * dt;
      st.lift += st.liftV * dt;
      if (st.lift < 0) {
        st.lift = 0;
        st.liftV = -st.liftV * 0.35;
      }
      st.tiltV += (110 * (wantTilt - st.tilt) - 7 * st.tiltV) * dt;
      st.tilt += st.tiltV * dt;
      st.flip += Math.sign(target - st.flip) * Math.min(Math.abs(target - st.flip), dt / 0.45);
    }
    const f = st.flip * st.flip * (3 - 2 * st.flip);
    const angle = st.tilt + f * Math.PI;
    c.rotation.set(0, -st.tilt * 0.25, angle);
    // lift clear of the felt by however far the turned card's edge would dip
    c.position.y = T / 2 + st.lift + Math.abs(Math.sin(angle)) * (CW / 2) + Math.sin(Math.PI * f) * 0.25;
  });
  return (
    <group ref={probe}>
      <group ref={card}>{children}</group>
    </group>
  );
}

/** The red rim and a gentle red bloom on the joker's face, pulsing slowly. */
function AlarmPulse({ face }: { face: THREE.MeshStandardMaterial }) {
  useFrame(({ clock }) => {
    const k = reducedMotion() ? 0.8 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.2);
    rimMat.opacity = 0.45 + 0.55 * k;
    face.emissiveIntensity = 0.06 + 0.16 * k;
  });
  return <mesh geometry={rimGeo} material={rimMat} renderOrder={1} />;
}

export function PodBody({ kind, hull, ballColor, dot, detail, pips }: PodBodyProps) {
  const kit = useKit();
  const id = useId();
  const alarm = isAlarm(ballColor);
  const rank = RANKS[hash(`${id}|${kind}`) % RANKS.length];
  const face = useMemo(
    () => (alarm ? jokerMat(jokerTexture(kind, hull, kit.p.ivory)) : cardMat(faceTexture(kind, rank, hull, kit.p.ivory), kit.p.ivory)),
    [alarm, kind, rank, hull, kit.p.ivory],
  );
  const back = useMemo(() => cardMat(backTexture(hull, kit.p.ivory), hull), [hull, kit.p.ivory]);
  const faceUp = alarm || !dot;
  return (
    <group>
      {!kit.light || detail ? <mesh geometry={shadowGeo} material={shadowMat} renderOrder={-1} /> : null}
      {alarm && <AlarmPulse face={face} />}
      <Dealt faceUp={faceUp}>
        <mesh geometry={edgeGeo} material={kit.cardEdge} castShadow />
        <mesh geometry={faceGeo} material={face} />
        <mesh geometry={backGeo} material={back} />
      </Dealt>
      {pips && !dot && (
        <group position={[CW / 2 + 0.3, 0, 0.2]}>
          <mesh geometry={lammerGeo} position={[0, 0, -0.22]} material={kit.glow(pips.reviewer, 1.8)} />
          <mesh geometry={lammerRimGeo} position={[0, 0, -0.22]} material={kit.brass} />
          <mesh geometry={lammerGeo} position={[0, 0, 0.22]} material={kit.glow(pips.ci, 1.8)} />
          <mesh geometry={lammerRimGeo} position={[0, 0, 0.22]} material={kit.brass} />
        </group>
      )}
    </group>
  );
}

/* ---------- shipped items: chip stacks ---------- */

const CHIP_R = 0.56;
const CHIP_H = 0.125;
function stackGeo(n: number, y0: number, dx: number, dz: number) {
  return new THREE.CylinderGeometry(CHIP_R, CHIP_R, n * CHIP_H, 32, 1).translate(dx, y0 + (n * CHIP_H) / 2, dz);
}
const lowerGeo = stackGeo(5, 0, 0, 0);
const upperGeo = stackGeo(3, 5 * CHIP_H, 0.035, -0.03);

const chipMats = new Map<string, THREE.Material[][]>();
/** Side, top and bottom materials for a stack of n chips in a colour. */
function chipMaterials(color: string): THREE.Material[][] {
  let m = chipMats.get(color);
  if (m) return m;
  const top = new THREE.MeshStandardMaterial({ map: chipTopTexture(color), roughness: 0.4 });
  const edge = chipEdgeTexture(color);
  m = [5, 3].map((n) => {
    const t = edge?.clone() ?? null;
    if (t) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1, n);
      t.needsUpdate = true;
    }
    return [new THREE.MeshStandardMaterial({ map: t, color: t ? '#ffffff' : color, roughness: 0.45 }), top, top];
  });
  chipMats.set(color, m);
  return m;
}

/** A shipped item: a stack of chips in the row's colour, eight high, the top three a touch askew. */
export function Crate({ color }: CrateProps) {
  const [lower, upper] = chipMaterials(color);
  return (
    <group>
      <mesh geometry={lowerGeo} material={lower} castShadow receiveShadow />
      <mesh geometry={upperGeo} material={upper} castShadow receiveShadow />
    </group>
  );
}

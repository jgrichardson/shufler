import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { domainDef, reducedMotion, type CrateProps, type PodBodyProps, type PodKind } from '../api';
import { Bins, box, chunk, flatShape, hexShape, isAlarm, lettered, monogram, post, roundRect, roundedRect, stencilText, strut, useKit, v3, type Kit } from './kit';

/*
 * Work items are a supply convoy. Close in, each is a vehicle facing the way the work flows: a six-wheel
 * supply truck for a pull request (canopy in the row's colour), a scout buggy for an issue, a tanker for a
 * data fix, a courier motorbike and sidecar with a rolled map for a plan, and a small mail van for docs.
 * In the calm overview each is a flat tabletop counter: a rounded hex in the row's colour with a white
 * pictogram of its vehicle. When the ball is with the user the counter turns into a red YOUR MOVE chit, a
 * square on its point with a chevron (a shape change, so it never relies on red alone), face up even in the
 * overview; the vehicle gets an amber-red roof beacon and a red chevron plate. The core's red beam and
 * ring stay on top. Review pips are two signal lamps on the cab roof, each in a dark bezel. Wheels turn
 * with the distance travelled and the body rocks a touch on the move.
 */

/** Heights stay under the core's ball lamp for each kind (pr 1.25, issue 0.55, data fix 1.45, plan 1.3, docs 0.65). */
interface Axle {
  x: number;
  r: number;
  /** Half track: wheels at z = ±track. */
  track: number;
  /** One wheel on the centre line (the bike), or the sidecar wheel. */
  single?: number[];
}

interface VehicleSpec {
  axles: Axle[];
  /** Where the review lamps sit (cab roof), and the beacon. */
  roof: [number, number, number];
  /** Parts painted in the row colour. */
  hull: (b: Bins) => void;
  body: (b: Bins, kit: Kit) => void;
}

const CHASSIS = (b: Bins, kit: Kit, x0: number, x1: number, y: number, w: number) => b.paint('v', box(x1 - x0, 0.12, w, (x0 + x1) / 2, y, 0), kit.p.oliveDark);

/** A cab facing +x: a bevelled box with a dark windscreen and side windows. */
function cab(b: Bins, kit: Kit, x: number, len: number, w: number, y0: number, h: number) {
  b.paint('v', chunk(len, h, w, 0.06).translate(x, y0, 0), kit.p.olive);
  b.paint('v', box(0.03, h * 0.38, w * 0.82, x + len / 2 + 0.005, y0 + h * 0.66, 0), kit.p.bezel);
  for (const s of [-1, 1]) b.paint('v', box(len * 0.5, h * 0.3, 0.03, x + len * 0.12, y0 + h * 0.66, s * (w / 2 + 0.005)), kit.p.bezel);
  // a bumper and headlamps
  b.paint('v', box(0.08, 0.1, w * 1.04, x + len / 2 + 0.03, y0 + 0.06, 0), kit.p.steel);
  for (const s of [-1, 1]) b.paint('v', box(0.03, 0.07, 0.1, x + len / 2 + 0.02, y0 + h * 0.3, s * w * 0.34), kit.p.stencil);
}

const SPECS: Record<PodKind, VehicleSpec> = {
  // six-wheel supply truck: cab forward, canopy over the bed in the row's colour
  pr: {
    axles: [{ x: 0.66, r: 0.22, track: 0.36 }, { x: -0.32, r: 0.22, track: 0.36 }, { x: -0.78, r: 0.22, track: 0.36 }],
    roof: [0.62, 1.0, 0],
    hull: (b) => {
      b.add('h', chunk(1.36, 0.62, 0.84, 0.08).translate(-0.4, 0.5, 0));
    },
    body: (b, kit) => {
      CHASSIS(b, kit, -1.1, 0.95, 0.3, 0.6);
      cab(b, kit, 0.62, 0.62, 0.8, 0.32, 0.66);
      b.paint('v', box(1.38, 0.14, 0.86, -0.4, 0.43, 0), kit.p.olive);
      // canopy hoops
      for (const x of [-0.95, -0.4, 0.15]) b.paint('v', box(0.04, 0.03, 0.88, x, 1.12, 0), kit.p.oliveDark);
      // mudguards
      for (const x of [-0.55]) for (const s of [-1, 1]) b.paint('v', box(0.7, 0.04, 0.16, x, 0.47, s * 0.4), kit.p.oliveDark);
    },
  },
  // scout buggy: low and open, a roll bar, a spare wheel on the back
  issue: {
    axles: [{ x: 0.55, r: 0.2, track: 0.4 }, { x: -0.5, r: 0.2, track: 0.4 }],
    roof: [-0.05, 0.5, 0],
    hull: (b) => {
      b.add('h', chunk(1.3, 0.2, 0.72, 0.05).translate(0.05, 0.18, 0));
      b.add('h', chunk(0.42, 0.14, 0.62, 0.04).translate(0.52, 0.36, 0));
    },
    body: (b, kit) => {
      CHASSIS(b, kit, -0.8, 0.85, 0.2, 0.5);
      for (const s of [-1, 1]) {
        b.paint('v', strut(v3(-0.25, 0.36, s * 0.32), v3(-0.12, 0.5, s * 0.28), 0.03, 5), kit.p.steel);
        b.paint('v', strut(v3(0.18, 0.36, s * 0.32), v3(-0.02, 0.5, s * 0.28), 0.03, 5), kit.p.steel);
      }
      b.paint('v', box(0.16, 0.03, 0.62, -0.07, 0.5, 0), kit.p.steel);
      b.paint('v', box(0.3, 0.1, 0.5, -0.32, 0.36, 0), kit.p.bezel);
      b.paint('v', new THREE.CylinderGeometry(0.18, 0.18, 0.09, 12).rotateZ(Math.PI / 2).translate(-0.88, 0.32, 0), kit.p.tyre);
      b.paint('v', box(0.04, 0.12, 0.5, 0.35, 0.42, 0), kit.p.bezel);
    },
  },
  // tanker: a cab and a round tank in the row's colour on two rear axles
  data_fix: {
    axles: [{ x: 0.7, r: 0.22, track: 0.36 }, { x: -0.3, r: 0.22, track: 0.36 }, { x: -0.76, r: 0.22, track: 0.36 }],
    roof: [0.66, 1.0, 0],
    hull: (b) => {
      b.add('h', new THREE.CylinderGeometry(0.38, 0.38, 1.3, 18).rotateZ(Math.PI / 2).scale(1, 1.05, 1).translate(-0.42, 0.82, 0));
    },
    body: (b, kit) => {
      CHASSIS(b, kit, -1.1, 1.0, 0.3, 0.6);
      cab(b, kit, 0.68, 0.56, 0.78, 0.32, 0.66);
      for (const x of [-1.07, 0.23]) b.paint('v', new THREE.CylinderGeometry(0.4, 0.4, 0.05, 18).rotateZ(Math.PI / 2).translate(x, 0.82, 0), kit.p.oliveDark);
      for (const x of [-0.9, -0.42, 0.06]) b.paint('v', box(0.05, 0.12, 0.6, x, 0.42, 0), kit.p.oliveDark);
      // a walkway and a hatch on top
      b.paint('v', box(1.0, 0.03, 0.18, -0.42, 1.22, 0), kit.p.steel);
      b.paint('v', new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10).translate(-0.42, 1.25, 0), kit.p.steel);
    },
  },
  // courier motorbike with a sidecar carrying a rolled map; a tall whip antenna
  plan: {
    axles: [{ x: 0.6, r: 0.24, track: 0, single: [0] }, { x: -0.45, r: 0.24, track: 0, single: [0, -0.6] }],
    roof: [-0.25, 0.86, -0.6],
    hull: (b) => {
      // the sidecar's tub
      const tub = new THREE.CylinderGeometry(0.24, 0.2, 0.95, 14).rotateZ(Math.PI / 2).scale(1, 0.9, 1.05).translate(0.0, 0.42, -0.6);
      b.add('h', tub);
      b.add('h', new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI).rotateY(-Math.PI / 2).scale(0.9, 0.85, 1.0).translate(0.47, 0.42, -0.6));
    },
    body: (b, kit) => {
      // the bike: frame, tank, seat, bars
      b.paint('v', strut(v3(0.6, 0.24, 0), v3(0.38, 0.72, 0), 0.04, 5), kit.p.steel);
      b.paint('v', strut(v3(-0.45, 0.24, 0), v3(0.0, 0.5, 0), 0.04, 5), kit.p.steel);
      b.paint('v', chunk(0.48, 0.2, 0.22, 0.05).translate(0.12, 0.44, 0), kit.p.olive);
      b.paint('v', chunk(0.42, 0.1, 0.2, 0.04).translate(-0.24, 0.52, 0), kit.p.bezel);
      b.paint('v', box(0.05, 0.05, 0.5, 0.38, 0.74, 0), kit.p.steel);
      // the sidecar's frame and the rolled map in it
      b.paint('v', box(0.9, 0.05, 0.6, 0.0, 0.2, -0.3), kit.p.oliveDark);
      b.paint('v', new THREE.CylinderGeometry(0.08, 0.08, 0.7, 10).rotateZ(1.2).translate(-0.1, 0.72, -0.6), kit.p.stencil);
      // the antenna rises from the sidecar's back (where the lamps sit)
      b.paint('v', post(-0.25, -0.6, 0.55, 1.05, 0.012, 4), kit.p.steel);
    },
  },
  // a small mail van, low enough to pass under its lamp, with a dispatch satchel on the back step
  docs: {
    axles: [{ x: 0.5, r: 0.17, track: 0.36 }, { x: -0.52, r: 0.17, track: 0.36 }],
    roof: [-0.2, 0.62, 0],
    hull: (b) => {
      b.add('h', chunk(1.2, 0.4, 0.78, 0.07).translate(-0.18, 0.17, 0));
    },
    body: (b, kit) => {
      CHASSIS(b, kit, -0.85, 0.82, 0.16, 0.56);
      b.paint('v', chunk(0.46, 0.4, 0.76, 0.08).translate(0.58, 0.17, 0), kit.p.olive);
      b.paint('v', box(0.03, 0.16, 0.6, 0.82, 0.44, 0), kit.p.bezel);
      for (const s of [-1, 1]) b.paint('v', box(0.24, 0.14, 0.03, 0.6, 0.44, s * 0.385), kit.p.bezel);
      b.paint('v', box(0.06, 0.08, 0.8, 0.84, 0.21, 0), kit.p.steel);
      // roof rack and the satchel on the back step
      b.paint('v', box(0.9, 0.03, 0.6, -0.2, 0.58, 0), kit.p.steel);
      b.paint('v', chunk(0.22, 0.24, 0.42, 0.05).translate(-0.86, 0.12, 0), kit.p.timber);
    },
  },
};

/** Every kind of work that has a vehicle and a counter pictogram (checked by the tests). */
export const VEHICLE_KINDS = Object.keys(SPECS) as PodKind[];

/** One axle's wheels (tyres with a pale hub), centred on the axle, for spinning about z. */
function axleGeometry(kit: Kit, a: Axle): THREE.BufferGeometry {
  const b = new Bins();
  const zs = a.single ?? [-a.track, a.track];
  for (const z of zs) {
    b.paint('w', new THREE.CylinderGeometry(a.r, a.r, 0.16, 14).rotateX(Math.PI / 2).translate(0, 0, z), kit.p.tyre);
    b.paint('w', new THREE.CylinderGeometry(a.r * 0.5, a.r * 0.5, 0.17, 8).rotateX(Math.PI / 2).translate(0, 0, z), kit.p.khaki);
    // a spoke bar so the turn is visible
    b.paint('w', box(a.r * 1.5, 0.05, 0.175, 0, 0, z), kit.p.oliveDark);
  }
  return b.merged().w;
}

const vehicleCache = new WeakMap<Kit, Map<PodKind, { body: THREE.BufferGeometry; hull: THREE.BufferGeometry; axles: THREE.BufferGeometry[] }>>();
function vehicle(kit: Kit, kind: PodKind) {
  let m = vehicleCache.get(kit);
  if (!m) vehicleCache.set(kit, (m = new Map()));
  let v = m.get(kind);
  if (!v) {
    const spec = SPECS[kind];
    const b = new Bins();
    spec.body(b, kit);
    spec.hull(b);
    const merged = b.merged();
    v = { body: merged.v, hull: merged.h, axles: spec.axles.map((a) => axleGeometry(kit, a)) };
    m.set(kind, v);
  }
  return v;
}

/* ---------- counters ---------- */

/** White vehicle pictograms for the counters, drawn into a square centred on (cx, cy) of size s. */
function pictogram(g: CanvasRenderingContext2D, kind: PodKind, cx: number, cy: number, s: number) {
  g.save();
  g.translate(cx, cy);
  g.scale(s / 100, s / 100);
  g.fillStyle = '#ffffff';
  const wheel = (x: number, y: number, r = 9) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    roundRect(g, x, y, w, h, r);
    g.fill();
  };
  if (kind === 'pr') {
    rr(-46, -26, 58, 36, 5);
    rr(16, -14, 28, 24, 5);
    wheel(-30, 18);
    wheel(-10, 18);
    wheel(30, 18);
  } else if (kind === 'issue') {
    rr(-40, -4, 80, 18, 6);
    g.lineWidth = 7;
    g.strokeStyle = '#ffffff';
    g.beginPath();
    g.moveTo(-14, -2);
    g.lineTo(-4, -26);
    g.lineTo(14, -26);
    g.lineTo(20, -2);
    g.stroke();
    wheel(-24, 18, 11);
    wheel(26, 18, 11);
  } else if (kind === 'data_fix') {
    g.beginPath();
    g.ellipse(-14, -6, 32, 18, 0, 0, Math.PI * 2);
    g.fill();
    rr(18, -18, 26, 30, 5);
    wheel(-30, 18);
    wheel(-8, 18);
    wheel(30, 18);
  } else if (kind === 'plan') {
    wheel(-30, 14, 13);
    wheel(30, 14, 13);
    rr(-18, -12, 40, 14, 6);
    g.beginPath();
    g.ellipse(-4, -28, 26, 9, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    rr(-44, -22, 76, 36, 8);
    rr(28, -10, 16, 24, 5);
    wheel(-24, 18);
    wheel(26, 18);
  }
  g.restore();
}

const counterTex = new Map<string, THREE.Texture | null>();
/** A counter's face: the row colour, a dark rim, a white pictogram; or the red YOUR MOVE chit. */
function counterFace(kind: PodKind, color: string, yourMove: boolean): THREE.Texture | null {
  const key = `${kind}|${color}|${yourMove}`;
  if (counterTex.has(key)) return counterTex.get(key)!;
  const t = lettered(256, 256, (g, w, h) => {
    if (yourMove) {
      g.fillStyle = '#d93a2b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      // a double chevron pointing up (forward): the move is yours
      for (const dy of [0, 44]) {
        g.beginPath();
        g.moveTo(w / 2 - 64, 120 - dy + 20);
        g.lineTo(w / 2, 56 - dy + 20);
        g.lineTo(w / 2 + 64, 120 - dy + 20);
        g.lineTo(w / 2 + 64, 148 - dy + 20);
        g.lineTo(w / 2, 84 - dy + 20);
        g.lineTo(w / 2 - 64, 148 - dy + 20);
        g.closePath();
        g.fill();
      }
      stencilText(g, 'YOUR MOVE', w / 2, 196, 32, '#ffffff', { bg: '#d93a2b', spacing: 3 });
    } else {
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      const shade = new THREE.Color(color).multiplyScalar(0.55).getStyle();
      g.strokeStyle = shade;
      g.lineWidth = 14;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = w / 2 + Math.cos(a) * 104;
        const y = h / 2 + Math.sin(a) * 104;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
      g.stroke();
      pictogram(g, kind, w / 2, h / 2 + 4, 150);
    }
  });
  counterTex.set(key, t);
  return t;
}

const faceMats = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
function faceMat(t: THREE.Texture | null, fallback: string, alarm: boolean) {
  if (!t) return new THREE.MeshStandardMaterial({ color: fallback });
  let m = faceMats.get(t);
  if (!m) faceMats.set(t, (m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: alarm ? '#ff3b2a' : '#ffffff', emissiveMap: alarm ? null : t, emissiveIntensity: alarm ? 0.15 : 0.08 })));
  return m;
}

const HEX_R = 0.9;
const COUNTER_T = 0.16;
const hexBody = (() => {
  const g = new THREE.ExtrudeGeometry(hexShape(HEX_R, 0.14), { depth: COUNTER_T, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1, curveSegments: 3 });
  g.rotateX(-Math.PI / 2);
  return g.translate(0, 0.03, 0);
})();
const hexFace = flatShape(hexShape(HEX_R, 0.14), HEX_R * 2, HEX_R * 2).translate(0, COUNTER_T + 0.065, 0);
// the your-move chit: a square, not a hex, standing twice as tall, so it reads without its colour
const CHIT = 1.2;
const chitShape = roundedRect(CHIT, CHIT, 0.12);
const chitBody = (() => {
  const g = new THREE.ExtrudeGeometry(chitShape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1, curveSegments: 3 });
  g.rotateX(-Math.PI / 2);
  return g.translate(0, 0.03, 0);
})();
const chitFace = flatShape(chitShape, CHIT, CHIT).translate(0, 0.365, 0);
const rimGeo = flatShape(roundedRect(CHIT + 0.5, CHIT + 0.5, 0.3), CHIT + 0.5, CHIT + 0.5).translate(0, 0.01, 0);
const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30').multiplyScalar(2.0), toneMapped: false, transparent: true, depthWrite: false });

const sideMats = new Map<string, THREE.MeshStandardMaterial>();
function sideMat(color: string) {
  let m = sideMats.get(color);
  if (!m) sideMats.set(color, (m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.5), roughness: 0.7 })));
  return m;
}

function AlarmPulse() {
  useFrame(({ clock }) => {
    const k = reducedMotion() ? 0.8 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.0);
    rimMat.opacity = 0.35 + 0.55 * k;
  });
  return <mesh geometry={rimGeo} material={rimMat} renderOrder={1} />;
}

/* ---------- motion ---------- */

const tmp = new THREE.Vector3();

/** Reads how far the pod moved in the world each frame: turns the wheels and rocks the body a touch. */
function Drive({ axles, children }: { axles: Axle[]; children: (refs: RefObject<THREE.Group>[]) => ReactNode }) {
  const probe = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const wheelRefs = useMemo(() => axles.map(() => ({ current: null as THREE.Group | null })), [axles]);
  const s = useRef({ prev: null as THREE.Vector3 | null, v: 0, t: 0 });
  useFrame((_, rawDt) => {
    const p = probe.current;
    if (!p) return;
    const dt = Math.min(rawDt, 0.05);
    const st = s.current;
    p.getWorldPosition(tmp);
    let dist = 0;
    if (st.prev) {
      dist = Math.hypot(tmp.x - st.prev.x, tmp.z - st.prev.z);
      st.prev.copy(tmp);
    } else st.prev = tmp.clone();
    if (reducedMotion()) return;
    const scale = p.parent ? p.parent.getWorldScale(tmp).x || 1 : 1;
    const local = dist / scale;
    st.v += (local / Math.max(dt, 1e-3) - st.v) * Math.min(1, dt * 10);
    axles.forEach((a, i) => {
      const w = wheelRefs[i].current;
      if (w) w.rotation.z -= local / a.r;
    });
    st.t += dt;
    const b = bodyRef.current;
    if (b) {
      const k = Math.min(1, st.v / 3);
      b.position.y = Math.abs(Math.sin(st.t * 14)) * 0.025 * k;
      b.rotation.z = Math.sin(st.t * 9) * 0.012 * k;
    }
  });
  return (
    <group ref={probe}>
      <group ref={bodyRef}>{children(wheelRefs as RefObject<THREE.Group>[])}</group>
    </group>
  );
}

/** The amber-red roof beacon on a vehicle whose ball is with the user: a slow sweep. */
function Beacon({ at }: { at: [number, number, number] }) {
  const kit = useKit();
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current && !reducedMotion()) ref.current.rotation.y += dt * 2.4;
  });
  return (
    <group position={at}>
      <mesh material={kit.bezel}>
        <cylinderGeometry args={[0.13, 0.15, 0.06, 12]} />
      </mesh>
      <mesh position={[0, 0.1, 0]} material={kit.glow('#ff5a2a', 2.6)}>
        <sphereGeometry args={[0.1, 12, 8]} />
      </mesh>
      <group ref={ref} position={[0, 0.1, 0]}>
        <mesh position={[0.12, 0, 0]} material={kit.glow('#ff8a3a', 3.2)}>
          <boxGeometry args={[0.12, 0.08, 0.04]} />
        </mesh>
      </group>
    </group>
  );
}

const chevronPlate = (() => {
  const s = new THREE.Shape([new THREE.Vector2(-0.16, -0.14), new THREE.Vector2(0, 0.02), new THREE.Vector2(0.16, -0.14), new THREE.Vector2(0.16, 0.0), new THREE.Vector2(0, 0.16), new THREE.Vector2(-0.16, 0.0)]);
  return new THREE.ShapeGeometry(s);
})();

export function PodBody({ kind, hull, ballColor, dot, pips }: PodBodyProps) {
  const kit = useKit();
  const alarm = isAlarm(ballColor);
  const spec = SPECS[kind];
  const v = vehicle(kit, kind);
  if (dot) {
    if (alarm) {
      const face = faceMat(counterFace(kind, hull, true), '#d93a2b', true);
      return (
        <group>
          <AlarmPulse />
          <mesh geometry={chitBody} material={sideMat('#d93a2b')} castShadow />
          <mesh geometry={chitFace} material={face} />
        </group>
      );
    }
    const face = faceMat(counterFace(kind, hull, false), hull, false);
    return (
      <group>
        <mesh geometry={hexBody} material={sideMat(hull)} castShadow />
        <mesh geometry={hexFace} material={face} />
      </group>
    );
  }
  return (
    <Drive axles={spec.axles}>
      {(wheels) => (
        <>
          <mesh geometry={v.body} material={kit.vcol} castShadow />
          <mesh geometry={v.hull} material={kit.painted(hull, 0.75)} castShadow />
          {spec.axles.map((a, i) => (
            <group key={i} ref={wheels[i]} position={[a.x, a.r, 0]}>
              <mesh geometry={v.axles[i]} material={kit.vcol} castShadow />
            </group>
          ))}
          {pips && (
            <group position={spec.roof}>
              <mesh material={kit.bezel}>
                <boxGeometry args={[0.24, 0.12, 0.62]} />
              </mesh>
              <mesh position={[0, 0.1, -0.16]} material={kit.glow(pips.reviewer, 2.2)}>
                <sphereGeometry args={[0.085, 10, 8]} />
              </mesh>
              <mesh position={[0, 0.1, 0.16]} material={kit.glow(pips.ci, 2.2)}>
                <sphereGeometry args={[0.085, 10, 8]} />
              </mesh>
            </group>
          )}
          {alarm && (
            <>
              <Beacon at={[spec.roof[0] - 0.12, spec.roof[1] + (pips ? 0.12 : 0), spec.roof[2]]} />
              <mesh geometry={chevronPlate} position={[kind === 'plan' ? 0.75 : 1.0, 0.4, 0]} rotation={[0, Math.PI / 2, 0]} material={kit.glow('#e74c3c', 1.6)} />
            </>
          )}
        </>
      )}
    </Drive>
  );
}

/* ---------- shipped items: crates ---------- */

const crateTex = new Map<string, THREE.Texture | null>();
/** The crate's stencilled face: the house monogram, the row code and a band in the row's colour. */
function crateFace(kit: Kit, code: string, color: string): THREE.Texture | null {
  const key = `${code}|${color}|${kit.p.olive}`;
  if (crateTex.has(key)) return crateTex.get(key)!;
  const t = lettered(128, 128, (g, w, h) => {
    const bg = kit.p.olive;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // planks
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
    g.fillStyle = color;
    g.fillRect(0, h - 26, w, 16);
    monogram(g, 36, 48, 44, kit.p.stencil, bg);
    stencilText(g, code, 88, 48, 30, kit.p.stencil, { bg, spacing: 2 });
  });
  crateTex.set(key, t);
  return t;
}

const crateBodies = new WeakMap<Kit, THREE.BufferGeometry>();
/** The crate: planked olive box, darker corner battens and rope handles, one vertex-coloured draw. */
function crateBody(kit: Kit) {
  let g = crateBodies.get(kit);
  if (!g) {
    const b = new Bins();
    b.paint('c', chunk(1.18, 1.1, 1.18, 0.06), kit.p.olive);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.paint('c', box(0.12, 1.12, 0.12, sx * 0.55, 0.56, sz * 0.55), kit.p.oliveDark);
    for (const s of [-1, 1]) b.paint('c', new THREE.TorusGeometry(0.14, 0.025, 5, 10, Math.PI).rotateY(Math.PI / 2).translate(s * 0.6, 0.72, 0), kit.p.khaki);
    crateBodies.set(kit, (g = b.merged().c));
  }
  return g;
}
const crateFaceGeo = new THREE.PlaneGeometry(1.0, 1.0).translate(0, 0.55, 0.6);
const crateMats = new Map<THREE.Texture | null, THREE.MeshStandardMaterial>();

/** A shipped item: an olive supply crate, its face stencilled with the house mark and the row's code. */
export function Crate({ domain, color }: CrateProps) {
  const kit = useKit();
  const tex = crateFace(kit, domainDef(domain).code, color);
  let face = crateMats.get(tex);
  if (!face) crateMats.set(tex, (face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })));
  return (
    <group>
      <mesh geometry={crateBody(kit)} material={kit.vcol} castShadow receiveShadow />
      <mesh geometry={crateFaceGeo} material={face} />
    </group>
  );
}

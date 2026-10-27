import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type LandmarkProps } from '../api';
import { Bins, box, post, strut, stripedTent, useKit, type Kit } from './kit';
import { Platform } from './Island';
import { PARK } from './palette';

/*
 * Each phase's landmark is a ride behind its column, lit in the phase accent: a carousel (brainstorm), a
 * wave swinger (plan), a coaster loop (build), a drop tower (QA), a swinging ship (review), teacups (merge)
 * and a rocket on its gantry (deploy). Rides turn slowly while something live sits in the district.
 */

/** Turns its children about y (or swings them about z) while `on`. One cheap rotation per ride. */
function Turn({ on, speed = 0.25, swing = 0, children }: { on: boolean; speed?: number; swing?: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g || !on || reducedMotion()) return;
    if (swing) g.rotation.z = Math.sin(clock.elapsedTime * speed) * swing;
    else g.rotation.y = clock.elapsedTime * speed;
  });
  return <group ref={ref}>{children}</group>;
}

function lathe(points: [number, number][], seg = 28) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg);
}

interface Parts {
  /** Static parts by material key. */
  fixed: Record<string, THREE.BufferGeometry>;
  /** Moving parts by material key. */
  moving: Record<string, THREE.BufferGeometry>;
  /** Pivot for the moving group (swing rides pivot high). */
  pivot?: [number, number, number];
  swing?: number;
  speed?: number;
  height: number;
}

const bulbRing = (bins: Bins, key: string, r: number, y: number, n: number, size = 0.07) => {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    bins.add(key, new THREE.SphereGeometry(size, 6, 4).translate(Math.cos(a) * r, y, Math.sin(a) * r));
  }
};

function carousel(accent: string): Parts {
  const f = new Bins();
  const m = new Bins();
  f.add('curb', new THREE.CylinderGeometry(2.7, 2.8, 0.3, 40).translate(0, 0.15, 0));
  m.add('trim', new THREE.CylinderGeometry(2.5, 2.5, 0.12, 40).translate(0, 0.36, 0));
  m.add('stucco', new THREE.CylinderGeometry(0.7, 0.7, 2.0, 20).translate(0, 1.4, 0));
  m.add('accent', new THREE.CylinderGeometry(0.72, 0.72, 0.3, 20).translate(0, 1.6, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.cos(a) * 1.9, z = Math.sin(a) * 1.9;
    m.add('gold', post(x, z, 0.42, 2.45, 0.035, 6));
    const y = 1.05 + (i % 2) * 0.3;
    // a stylised horse: body, neck and head, cream with a saddle in the accent
    const body = new THREE.CapsuleGeometry(0.13, 0.42, 4, 10).rotateZ(Math.PI / 2).rotateY(-a).translate(x, y, z);
    const t = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const head = new THREE.CapsuleGeometry(0.08, 0.2, 4, 8).rotateZ(0.6).rotateY(-a - Math.PI / 2).translate(x + t.x * 0.3, y + 0.2, z + t.z * 0.3);
    m.add('horse', body);
    m.add('horse', head);
    m.add('accentPaint', box(0.2, 0.06, 0.28, x, y + 0.13, z, 1, -a));
  }
  m.add('tent', stripedTent(3.0, 1.7, 16, accent, PARK.canopy, 0.22).translate(0, 2.45, 0));
  m.add('gold', post(0, 0, 4.1, 4.7, 0.05));
  bulbRing(m, 'bulbs', 2.98, 2.4, 24);
  m.add('lamp', new THREE.SphereGeometry(0.2, 12, 10).translate(0, 4.85, 0));
  return { fixed: f.merged(), moving: m.merged(), speed: 0.35, height: 5.1 };
}

function swinger(accent: string): Parts {
  const f = new Bins();
  const m = new Bins();
  f.add('curb', new THREE.CylinderGeometry(1.2, 1.4, 0.4, 24).translate(0, 0.2, 0));
  f.add('support', new THREE.CylinderGeometry(0.28, 0.38, 5.6, 16).translate(0, 3.0, 0));
  f.add('accent', new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16).translate(0, 2.2, 0));
  f.add('accent', new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16).translate(0, 3.6, 0));
  m.add('tent', stripedTent(2.5, 1.0, 14, accent, PARK.canopy, 0.18).translate(0, 5.6, 0));
  m.add('trim', new THREE.CylinderGeometry(2.5, 2.5, 0.16, 28).translate(0, 5.55, 0));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    // chains flung outward as if spinning
    const top = new THREE.Vector3(Math.cos(a) * 2.3, 5.5, Math.sin(a) * 2.3);
    const seat = new THREE.Vector3(Math.cos(a) * 3.0, 3.3, Math.sin(a) * 3.0);
    m.add('steel', strut(top, seat, 0.02, 4));
    m.add('seat', box(0.3, 0.08, 0.3, seat.x, seat.y - 0.04, seat.z, 1, -a));
    m.add('seatBack', box(0.06, 0.3, 0.3, seat.x + Math.cos(a) * 0.14, seat.y + 0.1, seat.z + Math.sin(a) * 0.14, 1, -a));
  }
  bulbRing(m, 'bulbs', 2.52, 5.4, 22);
  m.add('lamp', new THREE.SphereGeometry(0.2, 12, 10).translate(0, 6.85, 0));
  return { fixed: f.merged(), moving: m.merged(), speed: 0.45, height: 7.0 };
}

function coasterLoop(): Parts {
  const f = new Bins();
  // a vertical loop with run-in and run-out, as two rails and a spine along a curve
  const pts: THREE.Vector3[] = [];
  const R = 2.3;
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const a = -Math.PI / 2 + t * Math.PI * 2;
    // a slight corkscrew so the run-out passes beside the run-in
    pts.push(new THREE.Vector3(Math.cos(a) * R, 0.9 + R + Math.sin(a) * R, -0.6 + t * 1.2));
  }
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-4.6, 0.9, -0.6), new THREE.Vector3(-2.2, 0.9, -0.6), ...pts.slice(1, -1), new THREE.Vector3(2.2, 0.9, 0.6), new THREE.Vector3(4.6, 0.9, 0.6)]);
  const frames = curve.computeFrenetFrames(160, false);
  const railPts = (side: number) =>
    Array.from({ length: 161 }, (_, i) => {
      const p = curve.getPointAt(i / 160);
      // binormal across the track, kept roughly along z
      const b = frames.binormals[i].clone();
      if (b.z < 0) b.negate();
      return p.add(b.multiplyScalar(side * 0.32));
    });
  const tube = (list: THREE.Vector3[], r: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(list), 200, r, 6, false);
  f.add('steel', tube(railPts(-1), 0.06));
  f.add('steel', tube(railPts(1), 0.06));
  f.add('spine', new THREE.TubeGeometry(curve, 200, 0.13, 8, false));
  // supports: a pair under the loop and columns under the run-in and run-out
  for (const x of [-4, -2.6, 2.6, 4]) f.add('support', post(x, x < 0 ? -0.6 : 0.6, 0, 0.8, 0.1, 8));
  f.add('support', strut(new THREE.Vector3(-1.4, 0, 0), new THREE.Vector3(-0.4, 5.0, 0), 0.1, 8));
  f.add('support', strut(new THREE.Vector3(1.4, 0, 0), new THREE.Vector3(0.4, 5.0, 0), 0.1, 8));
  f.add('support', strut(new THREE.Vector3(-1.0, 2.4, 0), new THREE.Vector3(1.0, 2.4, 0), 0.07, 6));
  f.add('lamp', new THREE.SphereGeometry(0.2, 12, 10).translate(0, 6.0, 0));
  return { fixed: f.merged(), moving: {}, height: 6.2 };
}

function dropTower(): Parts {
  const f = new Bins();
  const m = new Bins();
  const H = 7.2;
  f.add('curb', new THREE.CylinderGeometry(1.4, 1.6, 0.3, 24).translate(0, 0.15, 0));
  // a square truss mast
  const s = 0.32;
  for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]] as const) f.add('support', post(x, z, 0.3, H, 0.06, 6));
  for (let y = 0.6; y < H; y += 0.7)
    for (let k = 0; k < 4; k++) {
      const a = [[-s, -s], [s, -s], [s, s], [-s, s]][k];
      const b = [[-s, -s], [s, -s], [s, s], [-s, s]][(k + 1) % 4];
      f.add('support', strut(new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y + 0.7, b[1]), 0.025, 4));
    }
  f.add('accent', box(0.08, H - 1, 0.08, 0, H / 2 + 0.2, s + 0.06));
  f.add('trim', new THREE.CylinderGeometry(0.62, 0.5, 0.5, 16).translate(0, H + 0.2, 0));
  f.add('lamp', new THREE.SphereGeometry(0.22, 12, 10).translate(0, H + 0.65, 0));
  // the gondola ring with seats, parked at the top
  m.add('ringPaint', new THREE.CylinderGeometry(1.0, 1.0, 0.36, 24, 1, true).translate(0, 4.9, 0));
  m.add('trim', new THREE.TorusGeometry(1.0, 0.05, 6, 28).rotateX(Math.PI / 2).translate(0, 5.08, 0));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    m.add('seat', box(0.26, 0.4, 0.2, Math.cos(a) * 1.12, 4.75, Math.sin(a) * 1.12, 1, -a + Math.PI / 2));
  }
  bulbRing(m, 'bulbs', 1.04, 4.72, 18);
  return { fixed: f.merged(), moving: m.merged(), speed: 0.3, height: 7.9 };
}

function swingShip(): Parts {
  const f = new Bins();
  const m = new Bins();
  const pivotY = 4.4;
  // A-frames at each end
  for (const x of [-2.4, 2.4])
    for (const z of [-1.6, 1.6]) f.add('support', strut(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, pivotY, 0), 0.11, 8));
  f.add('steel', strut(new THREE.Vector3(-2.6, pivotY, 0), new THREE.Vector3(2.6, pivotY, 0), 0.12, 10));
  f.add('lamp', new THREE.SphereGeometry(0.2, 12, 10).translate(0, pivotY + 0.45, 0));
  // the ship hangs below the pivot: hull (lathe, squashed), deck, mast, arms
  // the lathe axis is y; turn it to x and flatten into a hull
  const h2 = lathe([[0, -1], [0.55, -0.85], [0.75, -0.5], [0.8, 0], [0.75, 0.5], [0.55, 0.85], [0, 1]], 24);
  h2.rotateZ(Math.PI / 2).scale(2.0, 0.8, 0.85).translate(0, -3.0, 0);
  m.add('hull', h2);
  m.add('plank', box(3.4, 0.08, 1.15, 0, -2.7, 0, 0.8));
  m.add('accentPaint', box(3.6, 0.14, 1.32, 0, -2.62, 0));
  m.add('steel', post(0, 0, -2.6, -0.1, 0.05, 6));
  for (const x of [-1.4, 1.4]) m.add('support', strut(new THREE.Vector3(x, -2.7, 0), new THREE.Vector3(0, 0, 0), 0.07, 6));
  const sail = new THREE.PlaneGeometry(1.0, 1.1).translate(0.15, -1.45, 0.06);
  m.add('sail', sail);
  return { fixed: f.merged(), moving: m.merged(), pivot: [0, pivotY, 0], swing: 0.5, speed: 0.9, height: 5.0 };
}

function teacups(accent: string): Parts {
  const f = new Bins();
  const m = new Bins();
  f.add('curb', new THREE.CylinderGeometry(3.0, 3.1, 0.3, 40).translate(0, 0.15, 0));
  m.add('trim', new THREE.CylinderGeometry(2.8, 2.8, 0.1, 40).translate(0, 0.35, 0));
  const cup = lathe([[0, 0], [0.45, 0.02], [0.7, 0.25], [0.82, 0.62], [0.86, 0.75], [0.8, 0.75], [0.76, 0.62], [0.64, 0.3], [0, 0.2]], 24);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 1.75, z = Math.sin(a) * 1.75;
    m.add(i % 2 ? 'cupA' : 'cupB', cup.clone().translate(x, 0.4, z));
    m.add('trim', new THREE.TorusGeometry(0.84, 0.04, 6, 24).rotateX(Math.PI / 2).translate(x, 1.16, z));
  }
  // the teapot in the middle with a canopy
  m.add('cupA', lathe([[0, 0], [0.55, 0.1], [0.7, 0.6], [0.55, 1.1], [0.2, 1.25], [0, 1.3]], 24).translate(0, 0.4, 0));
  m.add('gold', post(0, 0, 1.6, 3.0, 0.05));
  m.add('tent', stripedTent(1.3, 0.8, 10, accent, PARK.canopy, 0.12).translate(0, 3.0, 0));
  m.add('lamp', new THREE.SphereGeometry(0.18, 12, 10).translate(0, 4.05, 0));
  bulbRing(m, 'bulbs', 2.85, 0.42, 30, 0.06);
  return { fixed: f.merged(), moving: m.merged(), speed: 0.4, height: 4.3 };
}

function rocket(): Parts {
  const f = new Bins();
  f.add('curb', new THREE.CylinderGeometry(1.6, 1.8, 0.4, 24).translate(0, 0.2, 0));
  const body = lathe([[0, 0.4], [0.5, 0.45], [0.62, 1.2], [0.64, 3.2], [0.55, 4.4], [0.32, 5.3], [0.1, 5.8], [0, 5.9]], 28).translate(0, 0.3, 0);
  f.add('trim', body);
  f.add('accentPaint', lathe([[0.555, 4.36], [0.33, 5.28], [0.1, 5.8], [0, 5.92], [0, 4.36]], 28).translate(0, 0.31, 0));
  f.add('accentPaint', new THREE.CylinderGeometry(0.655, 0.655, 0.3, 28).translate(0, 2.4, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const fin = box(0.08, 1.2, 0.7, 0, 1.1, 0, 1).translate(0, 0, 0.85);
    fin.rotateY(a);
    f.add('accentPaint', fin);
  }
  // portholes
  for (const y of [2.0, 3.0, 3.8]) f.add('window', new THREE.CircleGeometry(0.13, 14).translate(0, y + 0.3, 0.645));
  // the gantry: a lattice tower beside the rocket with an arm
  const gx = -1.5;
  for (const [x, z] of [[gx - 0.3, -0.3], [gx + 0.3, -0.3], [gx + 0.3, 0.3], [gx - 0.3, 0.3]] as const) f.add('support', post(x, z, 0.4, 6.6, 0.05, 6));
  for (let y = 0.8; y < 6.6; y += 0.8) f.add('support', box(0.66, 0.05, 0.66, gx, y, 0));
  f.add('support', box(1.0, 0.12, 0.2, gx + 0.8, 4.6, 0));
  f.add('lamp', new THREE.SphereGeometry(0.2, 12, 10).translate(gx, 6.9, 0));
  return { fixed: f.merged(), moving: {}, height: 7.0 };
}

const BUILDERS: Record<string, (accent: string) => Parts> = {
  brainstorm: carousel,
  plan: swinger,
  build: coasterLoop,
  qa: dropTower,
  review: swingShip,
  merge: teacups,
  deploy: rocket,
};
const FALLBACK = [carousel, swinger, dropTower, teacups];

function materialFor(key: string, kit: Kit, accent: string, glowK: number): THREE.Material {
  switch (key) {
    case 'curb':
      return kit.curb;
    case 'trim':
    case 'horse':
      return kit.trim;
    case 'stucco':
      return kit.stucco;
    case 'gold':
      return kit.gold;
    case 'steel':
      return kit.steel;
    case 'support':
      return kit.support;
    case 'seat':
      return kit.seat;
    case 'seatBack':
    case 'spine':
    case 'ringPaint':
    case 'accentPaint':
    case 'cupA':
    case 'hull':
      return kit.painted(accent, 0.35);
    case 'cupB':
      return kit.painted(kit.p.canopy, 0.35);
    case 'tent':
      return kit.vcol;
    case 'plank':
      return kit.plank;
    case 'sail':
      return kit.canopy;
    case 'window':
      return kit.glow(kit.p.window, 1.6);
    case 'bulbs':
      return kit.glow(kit.p.bulb, kit.light ? 1.2 : 2.6);
    case 'accent':
    case 'lamp':
      return kit.glow(accent, glowK);
    default:
      return kit.trim;
  }
}

function Meshes({ geos, kit, accent, glowK }: { geos: Record<string, THREE.BufferGeometry>; kit: Kit; accent: string; glowK: number }) {
  return (
    <>
      {Object.entries(geos).map(([k, g]) => (
        <mesh key={k} geometry={g} material={materialFor(k, kit, accent, glowK)} castShadow={k !== 'bulbs' && k !== 'lamp' && k !== 'accent'} receiveShadow />
      ))}
    </>
  );
}

const cache = new Map<string, Parts>();

/** The district landmark: a paved plaza with the phase's ride, its lights in the phase accent. */
export function Landmark({ phase, accent, active, lit }: LandmarkProps) {
  const kit = useKit();
  const parts = useMemo(() => {
    const key = `${phase}|${accent}`;
    let p = cache.get(key);
    if (!p) {
      const build = BUILDERS[phase] ?? FALLBACK[Math.abs([...phase].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % FALLBACK.length];
      cache.set(key, (p = build(accent)));
    }
    return p;
  }, [phase, accent]);
  const glowK = active ? 3.2 : lit ? 2.4 : 1.2;
  const pivot = parts.pivot ?? [0, 0, 0];
  return (
    <Platform radius={3.5} seed={7} rim={accent} detail>
      <Meshes geos={parts.fixed} kit={kit} accent={accent} glowK={glowK} />
      {Object.keys(parts.moving).length > 0 && (
        <group position={pivot}>
          <Turn on={lit || active} speed={parts.speed} swing={parts.swing}>
            <Meshes geos={parts.moving} kit={kit} accent={accent} glowK={glowK} />
          </Turn>
        </group>
      )}
    </Platform>
  );
}

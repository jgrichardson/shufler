import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type LandmarkProps } from '../api';
import { accentChips } from './Table';
import { Bins, FLOOR_Y, box, canvas, canvasTexture, mergeGeometries, paint, post, spaced, useKit, type Kit } from './kit';

/*
 * Each phase's landmark is a piece of the casino behind its column, on a round plinth ringed in the phase
 * accent: a roulette wheel for brainstorming (ideas land where they land), dice for planning, chip towers
 * for building, the big money wheel for QA, the eye in the sky for review, a riffle-shuffle bridge for
 * merging (two halves of the deck, interleaved) and a jackpot machine for deploy. They move gently while
 * something live sits in the district.
 */

/** Landmark origin height in the world (SKY_Y - 0.7) and the scale the skin asks for. */
const ORIGIN_Y = 4.8;
export const LANDMARK_SCALE = 2.0;
/** The gaming floor in landmark-local units. */
const FLOOR = (FLOOR_Y - ORIGIN_Y) / LANDMARK_SCALE - 0.02;

/** Turns its children about an axis while `on` (one cheap rotation per landmark). */
function Turn({ on, speed = 0.3, axis = 'y', children, position }: { on: boolean; speed?: number; axis?: 'y' | 'z'; children: ReactNode; position?: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g || !on || reducedMotion()) return;
    g.rotation[axis] += dt * speed;
  });
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

/** The plinth every landmark stands on: dark wood down to the floor, a felt top and a ring in the accent. */
function Plinth({ kit, accent, active, r = 4.3 }: { kit: Kit; accent: string; active: boolean; r?: number }) {
  const geo = useMemo(
    () => ({
      wall: new THREE.CylinderGeometry(r, r + 0.15, -FLOOR, 48).translate(0, FLOOR / 2, 0),
      top: new THREE.CylinderGeometry(r - 0.25, r - 0.25, 0.06, 48).translate(0, 0.03, 0),
      rim: new THREE.TorusGeometry(r - 0.12, 0.14, 8, 64).rotateX(Math.PI / 2).translate(0, 0.02, 0),
      ring: new THREE.TorusGeometry(r + 0.02, 0.05, 6, 64).rotateX(Math.PI / 2).translate(0, -0.22, 0),
    }),
    [r],
  );
  return (
    <group>
      <mesh geometry={geo.wall} material={kit.woodDark} castShadow receiveShadow />
      <mesh geometry={geo.top} material={kit.felt} receiveShadow />
      <mesh geometry={geo.rim} material={kit.brass} castShadow />
      <mesh geometry={geo.ring} material={kit.glow(accent, active ? 3 : kit.light ? 1.3 : 2)} />
    </group>
  );
}

const ROUGE = '#b3202a';
const NOIR = '#18161a';
const VERT = '#127a46';

/** A flat ring sector in the xz plane, painted. */
function sector(r0: number, r1: number, a0: number, a1: number, y: number, color: string) {
  return paint(new THREE.RingGeometry(r0, r1, 3, 1, a0, a1 - a0).rotateX(-Math.PI / 2).translate(0, y, 0), color);
}

/* ---------- brainstorm: a roulette wheel ---------- */

function Roulette({ kit, accent, lit }: { kit: Kit; accent: string; lit: boolean }) {
  const g = useMemo(() => {
    const fixed = new Bins();
    const head = new Bins();
    // the bowl: a turned wooden rim and the ball track
    const bowl = new THREE.LatheGeometry([[3.3, 0], [3.4, 0.5], [3.25, 0.75], [3.0, 0.7], [2.75, 0.55]].map(([x, y]) => new THREE.Vector2(x, y)), 64);
    fixed.add('wood', bowl);
    fixed.add('woodDark', new THREE.CylinderGeometry(3.3, 3.1, 0.5, 48).translate(0, 0.25, 0));
    // the turning head: 37 pockets, a number ring and the brass turret
    const n = 37;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const c = i === 0 ? VERT : i % 2 ? ROUGE : NOIR;
      head.add('vcol', sector(2.0, 2.7, a0, a1, 0.5, c));
      head.add('vcol', sector(1.55, 2.0, a0, a1, 0.46, c === VERT ? VERT : '#2a1a14'));
      head.add('brass', box(0.7, 0.08, 0.04, Math.cos(a0) * 2.35, 0.53, -Math.sin(a0) * 2.35, 1, a0));
    }
    head.add('woodDark', new THREE.ConeGeometry(1.6, 0.5, 48).translate(0, 0.62, 0));
    head.add('brass', new THREE.CylinderGeometry(0.22, 0.36, 0.9, 16).translate(0, 1.2, 0));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      head.add('brass', new THREE.CylinderGeometry(0.06, 0.06, 1.3, 8).rotateZ(Math.PI / 2).rotateY(a).translate(Math.cos(a) * 0.65, 1.5, -Math.sin(a) * 0.65));
      head.add('brass', new THREE.SphereGeometry(0.13, 10, 8).translate(Math.cos(a) * 1.3, 1.5, -Math.sin(a) * 1.3));
    }
    return { fixed: fixed.merged(), head: head.merged(), ball: new THREE.SphereGeometry(0.16, 14, 10).translate(2.35, 0.66, 0.2) };
  }, []);
  return (
    <group position={[0, 0.05, 0]} rotation={[0.18, 0, 0]}>
      <mesh geometry={g.fixed.wood} material={kit.wood} castShadow receiveShadow />
      <mesh geometry={g.fixed.woodDark} material={kit.woodDark} castShadow />
      <Turn on={lit} speed={0.6}>
        <mesh geometry={g.head.vcol} material={kit.vcol} receiveShadow />
        <mesh geometry={g.head.woodDark} material={kit.woodDark} castShadow />
        <mesh geometry={g.head.brass} material={kit.brass} castShadow />
      </Turn>
      <Turn on={lit} speed={-1.4}>
        <mesh geometry={g.ball} material={kit.ivory} castShadow />
      </Turn>
      <mesh position={[0, 0.78, 0]} rotation={[-Math.PI / 2, 0, 0]} material={kit.glow(accent, 1.4)}>
        <ringGeometry args={[3.24, 3.32, 64]} />
      </mesh>
    </group>
  );
}

/* ---------- plan: a pair of dice ---------- */

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** A die of side s at the origin: a softened cube and its pips, faces 1..6 on +y, +z, +x, -x, -z, -y. */
function dieGeometry(s: number) {
  const body = new THREE.BoxGeometry(s, s, s, 8, 8, 8);
  // round the edges: clamp each vertex to an inner box, then push it out by the corner radius
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  const h = s / 2;
  const r = s * 0.16;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    inner.set(THREE.MathUtils.clamp(v.x, -h + r, h - r), THREE.MathUtils.clamp(v.y, -h + r, h - r), THREE.MathUtils.clamp(v.z, -h + r, h - r));
    v.sub(inner).normalize().multiplyScalar(r).add(inner);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  body.computeVertexNormals();
  const pips: THREE.BufferGeometry[] = [];
  const faces: [number, THREE.Euler][] = [
    [1, new THREE.Euler(0, 0, 0)],
    [2, new THREE.Euler(Math.PI / 2, 0, 0)],
    [3, new THREE.Euler(0, 0, -Math.PI / 2)],
    [4, new THREE.Euler(0, 0, Math.PI / 2)],
    [5, new THREE.Euler(-Math.PI / 2, 0, 0)],
    [6, new THREE.Euler(Math.PI, 0, 0)],
  ];
  const d = s * 0.26;
  for (const [n, rot] of faces)
    for (const [a, b] of PIPS[n]) {
      const pip = new THREE.CylinderGeometry(s * 0.09, s * 0.09, 0.04, 16).translate(a * d, s / 2 + 0.005, b * d);
      pip.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
      pips.push(pip);
    }
  return { body, pips: mergeGeometries(pips) };
}

function Dice({ kit, accent, lit }: { kit: Kit; accent: string; lit: boolean }) {
  const die = useMemo(() => dieGeometry(2.2), []);
  const spin = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = spin.current;
    if (!g || !lit || reducedMotion()) return;
    const t = clock.elapsedTime;
    g.position.y = 1.1 + 0.6 + Math.abs(Math.sin(t * 0.9)) * 0.5;
    g.rotation.x = t * 0.5;
    g.rotation.z = t * 0.35;
  });
  const pipMat = kit.painted(accent, 0.3);
  return (
    <group>
      <group position={[-1.4, 1.1, 0.4]} rotation={[0, 0.5, 0]}>
        <mesh geometry={die.body} material={kit.ivory} castShadow receiveShadow />
        <mesh geometry={die.pips} material={pipMat} />
      </group>
      <group ref={spin} position={[1.5, 1.7, -0.5]} rotation={[0.6, -0.3, 0.4]}>
        <mesh geometry={die.body} material={kit.ivory} castShadow receiveShadow />
        <mesh geometry={die.pips} material={pipMat} />
      </group>
    </group>
  );
}

/* ---------- build: chip towers ---------- */

function ChipTowers({ accent, lit }: { accent: string; lit: boolean }) {
  const stacks = useMemo(
    () =>
      [
        [0, 0, 26, accent],
        [-1.7, 0.6, 16, accent],
        [1.6, 0.4, 20, '#f2ece0'],
        [-0.6, 1.9, 10, '#18161a'],
        [1.1, -1.6, 13, accent],
        [-1.9, -1.3, 7, '#b3202a'],
      ] as [number, number, number, string][],
    [accent],
  );
  const top = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = top.current;
    if (!g) return;
    const t = lit && !reducedMotion() ? clock.elapsedTime : 0;
    g.position.y = 26 * 0.22 + 0.8 + Math.max(0, Math.sin(t * 1.4)) * 0.8;
    g.rotation.y = t * 0.6;
  });
  return (
    <group>
      {stacks.map(([x, z, n, c], i) => (
        <mesh key={i} position={[x, (n * 0.22) / 2, z]} material={accentChips(c, n)} castShadow receiveShadow>
          <cylinderGeometry args={[0.85, 0.85, n * 0.22, 32]} />
        </mesh>
      ))}
      {/* the next chip, about to land on the tallest tower */}
      <group ref={top}>
        <mesh material={accentChips(accent, 1)} castShadow>
          <cylinderGeometry args={[0.85, 0.85, 0.22, 32]} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------- QA: the big money wheel ---------- */

function MoneyWheel({ kit, accent, lit }: { kit: Kit; accent: string; lit: boolean }) {
  const g = useMemo(() => {
    const wheel = new Bins();
    const n = 24;
    const colours = ['#f2ece0', ROUGE, '#d4a84a', NOIR, VERT, '#f2ece0', '#2f5fa8', ROUGE];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      wheel.add('vcol', paint(new THREE.RingGeometry(0.7, 2.75, 3, 1, a0, (Math.PI * 2) / n), colours[i % colours.length]));
      wheel.add('brass', new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6).rotateX(Math.PI / 2).translate(Math.cos(a0) * 2.95, Math.sin(a0) * 2.95, 0.12));
      wheel.add('brass', box(0.04, 2.05, 0.03, 0, 0, 0).translate(0, 1.72, 0.01).rotateZ(a0 - Math.PI / 2));
    }
    wheel.add('brass', new THREE.TorusGeometry(2.85, 0.12, 8, 64));
    wheel.add('brass', new THREE.CylinderGeometry(0.7, 0.7, 0.2, 32).rotateX(Math.PI / 2).translate(0, 0, 0.05));
    wheel.add('back', new THREE.CylinderGeometry(2.85, 2.85, 0.2, 48).rotateX(Math.PI / 2).translate(0, 0, -0.11));
    const stand = new Bins();
    for (const s of [-1, 1]) stand.add('woodDark', box(0.35, 4.6, 0.5, s * 1.3, 2.1, -0.5, 0.6, 0).rotateZ(0) as THREE.BufferGeometry);
    stand.add('woodDark', box(3.4, 0.4, 1.4, 0, 0.2, -0.5));
    stand.add('brass', new THREE.ConeGeometry(0.25, 0.7, 4).rotateZ(Math.PI).translate(0, 7.2, 0.15));
    return { wheel: wheel.merged(), stand: stand.merged() };
  }, []);
  return (
    <group position={[0, 0, 0.6]}>
      <mesh geometry={g.stand.woodDark} material={kit.woodDark} castShadow receiveShadow />
      <mesh geometry={g.stand.brass} material={kit.painted(accent, 0.3)} castShadow />
      <group position={[0, 4.15, 0]}>
        <Turn on={lit} axis="z" speed={-0.5}>
          <mesh geometry={g.wheel.vcol} material={kit.vcol} />
          <mesh geometry={g.wheel.brass} material={kit.brass} castShadow />
          <mesh geometry={g.wheel.back} material={kit.woodDark} castShadow />
        </Turn>
        <mesh position={[0, 0, 0.2]} material={kit.glow(accent, 1.8)}>
          <circleGeometry args={[0.32, 24]} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------- review: the eye in the sky ---------- */

function EyeInTheSky({ kit, accent, lit }: { kit: Kit; accent: string; lit: boolean }) {
  const g = useMemo(() => {
    const b = new Bins();
    b.add('woodDark', new THREE.CylinderGeometry(1.1, 1.4, 0.5, 24).translate(0, 0.25, 0));
    b.add('brass', post(0, 0, 0.5, 2.6, 0.18, 16));
    // a brass cradle ring holding the sphere
    b.add('brass', new THREE.TorusGeometry(1.95, 0.1, 8, 64).rotateX(Math.PI / 2).translate(0, 3.6, 0));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      b.add('brass', new THREE.CylinderGeometry(0.07, 0.07, 1.4, 8).rotateZ(0.9).rotateY(a).translate(Math.cos(a) * 1.2, 3.0, -Math.sin(a) * 1.2));
    }
    return b.merged();
  }, []);
  const eye = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!eye.current) return;
    // scans the floor, slowly, while anything waits for review
    eye.current.rotation.y = lit && !reducedMotion() ? Math.sin(clock.elapsedTime * 0.5) * 0.7 : 0;
  });
  return (
    <group>
      <mesh geometry={g.brass} material={kit.brass} castShadow />
      <mesh geometry={g.woodDark} material={kit.woodDark} castShadow />
      <mesh position={[0, 4.1, 0]} material={kit.glass} castShadow>
        <sphereGeometry args={[2.1, 48, 32]} />
      </mesh>
      <group ref={eye} position={[0, 4.1, 0]}>
        {/* the iris in the phase accent and a dark pupil with a red recording light, looking out at the floor */}
        <mesh position={[0, 0, 2.08]} material={kit.glow(accent, 2.0)}>
          <ringGeometry args={[0.55, 0.95, 48]} />
        </mesh>
        <mesh position={[0, 0, 2.09]} material={kit.painted('#050506', 0.1)}>
          <circleGeometry args={[0.55, 32]} />
        </mesh>
        <mesh position={[0.18, 0.18, 2.1]} material={kit.glow('#ff3b30', 2.5)}>
          <circleGeometry args={[0.1, 16]} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------- merge: a riffle-shuffle bridge ---------- */

function RiffleBridge({ kit, accent, lit }: { kit: Kit; accent: string; lit: boolean }) {
  const g = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const other = `#${new THREE.Color(accent).lerp(new THREE.Color('#f2ece0'), 0.55).getHexString()}`;
    // two half decks
    for (const s of [-1, 1]) {
      for (let k = 0; k < 12; k++) parts.push(paint(box(1.7, 0.05, 2.4, s * 2.4, 0.03 + k * 0.055, 0), k % 2 ? '#f2ece0' : s < 0 ? accent : other));
    }
    // the bridge: cards from both halves interleaved in an arch
    const n = 28;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = -1.8 + 3.6 * t;
      const y = 0.75 + Math.sin(Math.PI * t) * 1.5;
      const slope = Math.cos(Math.PI * t) * 1.5 * Math.PI / 3.6;
      const card = box(1.7, 0.035, 2.4, 0, 0, 0).rotateZ(Math.atan(slope) * 0.9 + (t - 0.5) * 0.7);
      parts.push(paint(card.translate(x, y, 0), i % 2 ? accent : other));
    }
    return mergeGeometries(parts);
  }, [accent]);
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const r = ref.current;
    if (!r) return;
    const k = lit && !reducedMotion() ? Math.sin(clock.elapsedTime * 1.2) * 0.06 : 0;
    r.scale.set(1 - k * 0.5, 1 + k, 1);
  });
  return (
    <group ref={ref} position={[0, 0.06, 0]} rotation={[0, -0.25, 0]} scale={1.15}>
      <mesh geometry={g} material={kit.vcol} castShadow receiveShadow />
    </group>
  );
}

/* ---------- deploy: the jackpot machine ---------- */

const sevens = (() => {
  const made = canvas(384, 160);
  if (!made) return null;
  const [c, g] = made;
  g.fillStyle = '#fbf6ea';
  g.fillRect(0, 0, 384, 160);
  g.fillStyle = '#c3262f';
  g.font = '700 120px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) g.fillText('7', 64 + i * 128, 86);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = 1; i < 3; i++) g.fillRect(i * 128 - 2, 0, 4, 160);
  return canvasTexture(c);
})();
const jackpotSign = (() => {
  const made = canvas(512, 128);
  if (!made) return null;
  const [c, g] = made;
  g.fillStyle = '#140c0a';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#f2d48a';
  g.font = '700 66px Georgia, serif';
  g.textBaseline = 'middle';
  spaced(g, 'JACKPOT', 256, 68, 10);
  return canvasTexture(c);
})();

function Jackpot({ kit, accent, lit }: { kit: Kit; accent: string; lit: boolean }) {
  const g = useMemo(() => {
    const b = new Bins();
    b.add('body', box(3.6, 2.2, 2.4, 0, 1.1, 0));
    b.add('body', box(3.3, 3.0, 2.1, 0, 3.7, -0.1));
    b.add('accent', box(3.7, 0.3, 2.6, 0, 2.3, 0.05).rotateX(0));
    b.add('accent', new THREE.CylinderGeometry(1.65, 1.65, 2.1, 32, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, 0.75, 1).translate(0, 5.2, -0.1));
    b.add('brass', box(3.0, 1.5, 0.08, 0, 3.9, 0.96));
    b.add('brass', new THREE.CylinderGeometry(0.08, 0.08, 2.4, 8).rotateZ(0.1).translate(2.05, 3.0, 0));
    b.add('brass', new THREE.CylinderGeometry(0.2, 0.2, 0.25, 12).rotateZ(Math.PI / 2).translate(1.85, 1.9, 0));
    const bulbs = new Bins();
    // marquee bulbs round the arch, in two alternating sets that chase
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * (i / 16);
      const gb = new THREE.SphereGeometry(0.1, 8, 6).translate(Math.cos(a) * 1.75, 5.2 + Math.sin(a) * 1.32, 0.98);
      bulbs.add(i % 2 ? 'a' : 'b', gb);
    }
    return { m: b.merged(), bulbs: bulbs.merged(), ball: new THREE.SphereGeometry(0.3, 14, 10).translate(2.15, 4.2, 0) };
  }, []);
  const a = useRef<THREE.Mesh>(null);
  const bRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const on = !lit || reducedMotion() ? true : Math.sin(clock.elapsedTime * 6) > 0;
    if (a.current) a.current.visible = on;
    if (bRef.current) bRef.current.visible = !lit || reducedMotion() || !on;
  });
  const bulb = kit.glow(kit.p.bokeh, kit.light ? 1.4 : 2.6);
  return (
    <group position={[0, 0, 0.3]}>
      <mesh geometry={g.m.body} material={kit.slotBody} castShadow receiveShadow />
      <mesh geometry={g.m.accent} material={kit.painted(accent, 0.25)} castShadow />
      <mesh geometry={g.m.brass} material={kit.brass} castShadow />
      <mesh geometry={g.ball} material={kit.painted(ROUGE, 0.2)} castShadow />
      <mesh position={[0, 3.9, 1.01]}>
        <planeGeometry args={[2.8, 1.2]} />
        <meshStandardMaterial map={sevens} emissive="#ffffff" emissiveMap={sevens} emissiveIntensity={kit.light ? 0.15 : 0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 5.55, 0.99]}>
        <planeGeometry args={[2.4, 0.6]} />
        <meshStandardMaterial map={jackpotSign} emissive="#ffffff" emissiveMap={jackpotSign} emissiveIntensity={kit.light ? 0.2 : 0.8} roughness={0.5} />
      </mesh>
      <mesh ref={a} geometry={g.bulbs.a} material={bulb} />
      <mesh ref={bRef} geometry={g.bulbs.b} material={bulb} />
    </group>
  );
}

export function Landmark({ phase, accent, active, lit }: LandmarkProps) {
  const kit = useKit();
  const piece = (() => {
    switch (phase) {
      case 'brainstorm':
        return <Roulette kit={kit} accent={accent} lit={lit} />;
      case 'plan':
        return <Dice kit={kit} accent={accent} lit={lit} />;
      case 'qa':
        return <MoneyWheel kit={kit} accent={accent} lit={lit} />;
      case 'review':
        return <EyeInTheSky kit={kit} accent={accent} lit={lit} />;
      case 'merge':
        return <RiffleBridge kit={kit} accent={accent} lit={lit} />;
      case 'deploy':
        return <Jackpot kit={kit} accent={accent} lit={lit} />;
      default:
        return <ChipTowers accent={accent} lit={lit} />;
    }
  })();
  return (
    <group>
      <Plinth kit={kit} accent={accent} active={active} />
      {piece}
    </group>
  );
}

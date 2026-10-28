import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { reducedMotion, rng, useResolvedTheme } from '../api';
import { ASSET_BASE, Bins, bare, box, post, strut, stripedTent, useKit, type Kit } from './kit';
import { TREE_GEOS } from './Island';

/** The park floor in world space (the board's lanes sit at y = 5.5 above it). */
export const PARK_Y = -0.55;
/** Rough centre of a 12-row board; the shadow camera and the scenery ring centre on it. */
const BOARD_CENTRE = new THREE.Vector3(45, 0, -42);
/** Keep scenery out of this box (the board, its islands, landmarks and the gift shop). */
const CLEAR = { x0: -48, x1: 150, z0: -135, z1: 22 };

/** Golden hour: a low sun in the west, a little in front of the board so faces toward the camera catch it. */
const SUN_DIR = new THREE.Vector3(-0.78, 0.42, 0.46).normalize();
/** Night: moonlight from high front-right; the moon itself is drawn behind the board where the eye finds it. */
const MOON_LIGHT = new THREE.Vector3(0.35, 0.82, 0.45).normalize();
const MOON_DISC = new THREE.Vector3(0.38, 0.3, -0.87).normalize();

/**
 * One dome for the sky: golden hour by day (amber at the horizon, a sun glow in the west, a few high
 * streaks); a clear night with stars, a moon and the park's warm glow on the haze at the horizon.
 */
function SkyDome({ light }: { light: boolean }) {
  const { p } = useKit();
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color(p.skyZenith) },
          upper: { value: new THREE.Color(p.skyUpper) },
          horizon: { value: new THREE.Color(p.skyHorizon) },
          glow: { value: new THREE.Color(p.skyGlow) },
          sunCol: { value: new THREE.Color(p.sun) },
          starCol: { value: new THREE.Color(p.stars) },
          fogCol: { value: new THREE.Color(p.fog) },
          sunDir: { value: light ? SUN_DIR : MOON_DISC },
          night: { value: light ? 0 : 1 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith, upper, horizon, glow, sunCol, starCol, sunDir, fogCol;
          uniform float night;
          varying vec3 vWorld;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
          }
          float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; }
            return v;
          }
          void main() {
            vec3 d = normalize(vWorld - cameraPosition);
            float h = max(d.y, -0.2);
            float s = max(dot(d, sunDir), 0.0);
            vec3 flat2 = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
            float sh = max(dot(flat2, normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
            vec3 sky = mix(horizon, upper, smoothstep(0.0, 0.28, h));
            sky = mix(sky, zenith, smoothstep(0.25, 0.9, h));
            if (night < 0.5) {
              // golden hour: amber glow toward the sun, soft high streaks
              sky = mix(sky, glow, pow(sh, 2.5) * exp(-max(h, 0.0) * 7.0) * 0.9);
              vec2 sp = d.xz / (h + 0.15) * vec2(0.8, 2.4);
              float st = smoothstep(0.55, 0.85, fbm(sp * 1.2 + 3.0));
              sky = mix(sky, mix(vec3(1.0), glow, 0.55 + 0.45 * sh), st * 0.45 * smoothstep(0.03, 0.15, h) * (1.0 - smoothstep(0.4, 0.75, h)));
              sky += sunCol * (pow(s, 600.0) * 4.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
            } else {
              // night: stars, a moon and the park's warm glow low on the haze
              sky = mix(sky, glow, exp(-max(h, 0.0) * 14.0) * 0.55);
              vec2 cell = floor(vec2(atan(d.z, d.x) * 260.0, h * 420.0));
              float r = hash(cell);
              float star = step(0.9965, r) * smoothstep(0.05, 0.3, h) * (0.5 + 0.5 * hash(cell + 3.1));
              sky += starCol * star * 1.2;
              float moon = smoothstep(0.99955, 0.9997, s);
              sky = mix(sky, sunCol * 1.6, moon);
              sky += sunCol * (pow(s, 120.0) * 0.25 + pow(s, 12.0) * 0.06);
            }
            // below the horizon the dome stands in for the lawn past its edge: fogged like the lawn's far rim,
            // so the horizon camera sees the park run out to the sky with no seam
            sky = mix(sky, fogCol, smoothstep(0.01, -0.025, d.y));
            sky += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
            gl_FragColor = vec4(sky, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [p, light],
  );
  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[2600, 48, 32]} />
    </mesh>
  );
}

/** The park floor: lawn to the horizon, promenades in front of and behind the board, lamp posts along them. */
function Grounds({ kit }: { kit: Kit }) {
  const lawn = useMemo(() => {
    const m = kit.lawn.clone();
    for (const t of [m.map, m.normalMap]) {
      if (!t) continue;
      const c = t.clone();
      c.repeat.set(260, 260);
      if (t === m.map) m.map = c;
      else m.normalMap = c;
    }
    return m;
  }, [kit.lawn]);
  const built = useMemo(() => {
    const bins = new Bins();
    // promenades: one along the front of the rows, one behind the rides, one down each side
    bins.add('paving', box(CLEAR.x1 - CLEAR.x0 + 30, 0.1, 9, (CLEAR.x0 + CLEAR.x1) / 2 + 5, PARK_Y + 0.05, CLEAR.z1 - 2, 0.18));
    bins.add('paving', box(CLEAR.x1 - CLEAR.x0 + 30, 0.1, 9, (CLEAR.x0 + CLEAR.x1) / 2 + 5, PARK_Y + 0.05, CLEAR.z0 - 2, 0.18));
    bins.add('paving', box(9, 0.1, CLEAR.z1 - CLEAR.z0, CLEAR.x0 - 6, PARK_Y + 0.05, (CLEAR.z0 + CLEAR.z1) / 2, 0.18));
    bins.add('curb', box(CLEAR.x1 - CLEAR.x0 + 30, 0.16, 0.4, (CLEAR.x0 + CLEAR.x1) / 2 + 5, PARK_Y + 0.08, CLEAR.z1 + 2.5));
    // lamp posts along the front promenade
    for (let x = CLEAR.x0; x <= CLEAR.x1 + 18; x += 9) {
      bins.add('lampPost', post(x, CLEAR.z1 + 1.8, PARK_Y, PARK_Y + 3.2, 0.07, 6));
      bins.add('globes', bare(new THREE.SphereGeometry(0.24, 10, 8).translate(x, PARK_Y + 3.4, CLEAR.z1 + 1.8)));
    }
    // a hedge line along the outside of the front promenade
    for (let x = CLEAR.x0 - 10; x <= CLEAR.x1 + 18; x += 2.2) bins.add('hedge', box(2.0, 0.9, 1.1, x, PARK_Y + 0.45, CLEAR.z1 + 4.2, 0.5));
    return bins.merged();
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[BOARD_CENTRE.x, PARK_Y, BOARD_CENTRE.z]} material={lawn} receiveShadow>
        <circleGeometry args={[2400, 64]} />
      </mesh>
      <mesh geometry={built.paving} material={kit.paving} receiveShadow />
      <mesh geometry={built.curb} material={kit.curb} receiveShadow />
      <mesh geometry={built.lampPost} material={kit.steelDark} />
      <mesh geometry={built.globes} material={kit.glow(kit.p.bulb, kit.light ? 1.0 : 2.6)} />
      <mesh geometry={built.hedge} material={kit.hedge} castShadow receiveShadow />
    </group>
  );
}

/** Trees scattered round the park outside the board, instanced by shape: three draw calls. */
function Trees({ kit }: { kit: Kit }) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const lists = useMemo(() => {
    const r = rng(0x7a11);
    const out: THREE.Matrix4[][] = [[], [], []];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let guard = 0;
    while (out.reduce((n, l) => n + l.length, 0) < 520 && guard++ < 6000) {
      const a = r() * Math.PI * 2;
      const d = 30 + Math.pow(r(), 0.7) * 380;
      const x = BOARD_CENTRE.x + Math.cos(a) * d * 1.3;
      const z = BOARD_CENTRE.z + Math.sin(a) * d;
      if (x > CLEAR.x0 - 14 && x < CLEAR.x1 + 14 && z > CLEAR.z0 - 10 && z < CLEAR.z1 + 7) continue;
      const s = 2.2 + r() * 2.2;
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      out[Math.floor(r() * 3)].push(new THREE.Matrix4().compose(new THREE.Vector3(x, PARK_Y, z), q, new THREE.Vector3(s, s, s)));
    }
    return out;
  }, []);
  useLayoutEffect(() => {
    lists.forEach((list, k) => {
      const mesh = refs.current[k];
      if (!mesh) return;
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [lists]);
  return (
    <>
      {lists.map((list, k) => (
        <instancedMesh key={k} ref={(el) => (refs.current[k] = el)} args={[TREE_GEOS[k], kit.vcol, list.length]} castShadow receiveShadow />
      ))}
    </>
  );
}

/** The park's name board on the lawn in front of the rows, tipped back toward the board's camera. */
function ParkSign({ kit, light }: { kit: Kit; light: boolean }) {
  const W = 22, H = 3.4;
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 1536;
    c.height = 236;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#7a2f2a';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#e8b85c';
    g.lineWidth = 10;
    g.strokeRect(22, 22, c.width - 44, c.height - 44);
    g.fillStyle = '#fbefd6';
    g.font = '600 132px Georgia, "Times New Roman", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const text = 'SHUFLER  PARK';
    const spacing = 18;
    const widths = [...text].map((ch) => g.measureText(ch).width + spacing);
    let x = c.width / 2 - (widths.reduce((a, b) => a + b, 0) - spacing) / 2;
    [...text].forEach((ch, i) => {
      g.fillText(ch, x + widths[i] / 2 - spacing / 2, c.height / 2 + 6);
      x += widths[i];
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  const built = useMemo(() => {
    const bins = new Bins();
    for (const sx of [-1, 1]) {
      bins.add('posts', post((sx * (W + 1.2)) / 2, 0, -0.2, H + 1.2, 0.35, 12));
      bins.add('gold', new THREE.SphereGeometry(0.5, 14, 10).translate((sx * (W + 1.2)) / 2, H + 1.6, 0));
    }
    // marquee bulbs round the board
    const n = 44;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const per = 2 * (W + H);
      let d = t * per;
      let x: number, y: number;
      if (d < W) (x = -W / 2 + d), (y = H / 2 + 0.22);
      else if ((d -= W) < H) (x = W / 2 + 0.22), (y = H / 2 - d);
      else if ((d -= H) < W) (x = W / 2 - d), (y = -H / 2 - 0.22);
      else (d -= W), (x = -W / 2 - 0.22), (y = -H / 2 + d);
      bins.add('bulbs', bare(new THREE.SphereGeometry(0.13, 8, 6).translate(x, y, 0.2)));
    }
    return bins.merged();
  }, []);
  return (
    <group position={[22, PARK_Y, 13]}>
      <mesh geometry={built.posts} material={kit.trim} castShadow />
      <mesh geometry={built.gold} material={kit.gold} />
      <group position={[0, H / 2 + 0.9, 0]} rotation={[-0.62, 0, 0]}>
        <mesh material={kit.painted('#5e2420', 0.6)} castShadow>
          <boxGeometry args={[W + 0.8, H + 0.8, 0.3]} />
        </mesh>
        {texture && (
          <mesh position={[0, 0, 0.16]}>
            <planeGeometry args={[W, H]} />
            <meshStandardMaterial map={texture} roughness={0.55} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={light ? 0.05 : 0.35} />
          </mesh>
        )}
        <mesh geometry={built.bulbs} material={kit.glow(kit.p.bulb, light ? 1.2 : 2.8)} />
      </group>
    </group>
  );
}

/* ---------- the skyline: a Ferris wheel, a big coaster and park buildings ---------- */

const WHEEL = { x: -45, z: -178, R: 30, hub: 36, cabs: 18 };

/** The Ferris wheel: twin rims on spokes, an A-frame, gondolas that hang level, bulbs on rims and spokes. */
function FerrisWheel({ kit, light }: { kit: Kit; light: boolean }) {
  const wheel = useRef<THREE.Group>(null);
  const cabs = useRef<THREE.InstancedMesh>(null);
  const built = useMemo(() => {
    const frame = new Bins();
    const turn = new Bins();
    const { R, hub } = WHEEL;
    // A-frame legs on each side of the wheel to the hub
    for (const z of [-3, 3])
      for (const x of [-R * 0.55, R * 0.55]) frame.add('legs', strut(new THREE.Vector3(x, 0, z * 2.2), new THREE.Vector3(0, hub, z * 0.7), 0.55, 8));
    frame.add('legs', strut(new THREE.Vector3(0, hub, -3), new THREE.Vector3(0, hub, 3), 0.9, 12));
    frame.add('legs', box(R * 1.3, 0.8, 9, 0, 0.4, 0));
    // rotating parts, drawn about the hub
    for (const z of [-1.3, 1.3]) {
      turn.add('rim', new THREE.TorusGeometry(R, 0.32, 8, 96).translate(0, 0, z));
      turn.add('rim', new THREE.TorusGeometry(R * 0.93, 0.18, 6, 96).translate(0, 0, z));
    }
    const spokes = 24;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const tip = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0);
      for (const z of [-1.3, 1.3]) turn.add('spoke', strut(new THREE.Vector3(0, 0, z * 0.5), tip.clone().setZ(z), 0.09, 4));
      turn.add('spoke', strut(tip.clone().setZ(-1.3), tip.clone().setZ(1.3), 0.12, 4));
      // bulbs along the spoke and the rim
      for (let k = 2; k <= 10; k++) turn.add('bulbs', bare(new THREE.SphereGeometry(0.2, 6, 4).translate(Math.cos(a) * R * (k / 10), Math.sin(a) * R * (k / 10), 1.45)));
    }
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      turn.add('bulbs', bare(new THREE.SphereGeometry(0.22, 6, 4).translate(Math.cos(a) * R, Math.sin(a) * R, 1.7)));
    }
    turn.add('hubCap', new THREE.CylinderGeometry(2.2, 2.2, 3.4, 20).rotateX(Math.PI / 2));
    const cab = new THREE.CylinderGeometry(1.25, 1.25, 1.8, 12).translate(0, -1.9, 0);
    const roof = new THREE.ConeGeometry(1.5, 0.8, 12).translate(0, -0.6, 0);
    return { frame: frame.merged(), turn: turn.merged(), cab: (() => {
      const g = new Bins();
      g.add('c', cab);
      g.add('c', roof);
      return g.merged().c;
    })() };
  }, []);
  useFrame(({ clock }) => {
    const angle = reducedMotion() ? 0.2 : clock.elapsedTime * 0.035;
    if (wheel.current) wheel.current.rotation.z = angle;
    const mesh = cabs.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < WHEEL.cabs; i++) {
      const a = (i / WHEEL.cabs) * Math.PI * 2 + angle;
      m.makeTranslation(WHEEL.x + Math.cos(a) * WHEEL.R, PARK_Y + WHEEL.hub + Math.sin(a) * WHEEL.R, WHEEL.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  const bulbs = kit.glow(kit.p.bulb, light ? 1.1 : 3.0);
  return (
    <group>
      <group position={[WHEEL.x, PARK_Y, WHEEL.z]}>
        <mesh geometry={built.frame.legs} material={kit.painted(kit.p.wheelFrame, 0.5)} castShadow />
        <group ref={wheel} position={[0, WHEEL.hub, 0]}>
          <mesh geometry={built.turn.rim} material={kit.painted(kit.p.wheelFrame, 0.4)} />
          <mesh geometry={built.turn.spoke} material={kit.painted(kit.p.wheelFrame, 0.5)} />
          <mesh geometry={built.turn.hubCap} material={kit.gold} />
          <mesh geometry={built.turn.bulbs} material={bulbs} />
        </group>
      </group>
      <instancedMesh ref={cabs} args={[built.cab, kit.painted(kit.p.wheelCab, 0.45), WHEEL.cabs]} frustumCulled={false} />
    </group>
  );
}

/** A big steel coaster on the skyline: a closed circuit of hills and a loop on white lattice towers. */
function SkylineCoaster({ kit, light }: { kit: Kit; light: boolean }) {
  const built = useMemo(() => {
    const ox = 95, oz = -190;
    const raw: [number, number, number][] = [
      [0, 6, 0], [30, 6, 6], [48, 44, 10], [62, 50, 12], [76, 10, 14], [96, 30, 10], [112, 8, 4], [130, 22, -4],
      [140, 8, -18], [128, 6, -34], [100, 26, -38], [80, 8, -36], [60, 18, -34], [36, 6, -30], [14, 14, -22], [-4, 6, -12],
    ];
    const curve = new THREE.CatmullRomCurve3(raw.map(([x, y, z]) => new THREE.Vector3(ox + x, PARK_Y + y, oz + z)), true, 'centripetal');
    const bins = new Bins();
    const N = 600;
    const pts = curve.getSpacedPoints(N);
    const left: THREE.Vector3[] = [];
    const right: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const t = curve.getTangentAt(i / N);
      const side = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(0.9);
      left.push(pts[i].clone().add(side));
      right.push(pts[i].clone().sub(side));
    }
    bins.add('rail', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(left, true), N, 0.28, 6, true));
    bins.add('rail', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(right, true), N, 0.28, 6, true));
    bins.add('spine', new THREE.TubeGeometry(curve, N, 0.55, 8, true));
    // lattice towers under the track every few metres
    for (let i = 0; i < N; i += 8) {
      const p = pts[i];
      if (p.y - PARK_Y < 3) continue;
      bins.add('tower', post(p.x, p.z, PARK_Y, p.y - 0.5, 0.35, 6));
      if (p.y - PARK_Y > 14) {
        const t = curve.getTangentAt(i / N);
        const side = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(3);
        bins.add('tower', strut(new THREE.Vector3(p.x + side.x, PARK_Y, p.z + side.z), new THREE.Vector3(p.x, p.y - 0.6, p.z), 0.22, 5));
        bins.add('tower', strut(new THREE.Vector3(p.x - side.x, PARK_Y, p.z - side.z), new THREE.Vector3(p.x, p.y - 0.6, p.z), 0.22, 5));
      }
    }
    // a vertical loop beside the circuit
    const loopPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = -Math.PI / 2 + (i / 48) * Math.PI * 2;
      loopPts.push(new THREE.Vector3(ox + 92 + Math.cos(a) * 13, PARK_Y + 15 + Math.sin(a) * 13, oz + 30 + (i / 48) * 4));
    }
    bins.add('spine', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loopPts), 96, 0.55, 8, false));
    bins.add('tower', post(ox + 85, oz + 31, PARK_Y, PARK_Y + 26, 0.4, 6));
    bins.add('tower', post(ox + 99, oz + 33, PARK_Y, PARK_Y + 26, 0.4, 6));
    // bulbs on the lift hill
    for (let i = 0; i < N; i += 3) {
      const p = left[i];
      if (p.y - PARK_Y < 20) continue;
      bins.add('bulbs', bare(new THREE.SphereGeometry(0.3, 6, 4).translate(p.x, p.y + 0.4, p.z)));
    }
    return bins.merged();
  }, []);
  return (
    <group>
      <mesh geometry={built.tower} material={kit.painted(kit.p.wheelFrame, 0.6)} castShadow />
      <mesh geometry={built.spine} material={kit.painted(kit.p.wheelCab, 0.4)} castShadow />
      <mesh geometry={built.rail} material={kit.steel} />
      {built.bulbs && <mesh geometry={built.bulbs} material={kit.glow(kit.p.bulb, light ? 1.0 : 2.6)} />}
    </group>
  );
}

/** Park buildings far out: pavilions with tent roofs and a few towers, in a hazy silhouette tone. */
function Skyline({ kit, light }: { kit: Kit; light: boolean }) {
  const built = useMemo(() => {
    const r = rng(0x5e11);
    const bins = new Bins();
    for (let i = 0; i < 42; i++) {
      const a = Math.PI * 0.06 - (i / 42) * Math.PI * 1.12 + (r() - 0.5) * 0.08;
      const d = 230 + r() * 200;
      const x = BOARD_CENTRE.x + Math.cos(a) * d * 1.2;
      const z = BOARD_CENTRE.z + Math.sin(a) * d;
      const kind = r();
      const w = 8 + r() * 14;
      const h = 3 + r() * 5;
      if (kind < 0.55) {
        bins.add('body', new THREE.CylinderGeometry(w / 2, w / 2, h, 16).translate(x, PARK_Y + h / 2, z));
        bins.add('tent', stripedTent(w * 0.66, w * 0.5, 14, i % 3 ? kit.p.wheelCab : '#5d7fa8', kit.p.canopy, w * 0.04).translate(x, PARK_Y + h, z));
        if (!light) for (let k = 0; k < 10; k++) {
          const b = (k / 10) * Math.PI * 2;
          bins.add('lit', bare(new THREE.SphereGeometry(0.45, 6, 4).translate(x + Math.cos(b) * w * 0.6, PARK_Y + h + 0.2, z + Math.sin(b) * w * 0.6)));
        }
      } else if (kind < 0.8) {
        bins.add('body', box(w, h, w * 0.7, x, PARK_Y + h / 2, z));
        bins.add('roof', new THREE.CylinderGeometry(0, w * 0.75, w * 0.4, 4).rotateY(Math.PI / 4).scale(1, 1, 0.7).translate(x, PARK_Y + h + w * 0.2, z));
      } else {
        const th = h * 2.6;
        bins.add('body', new THREE.CylinderGeometry(1.4, 2.0, th, 10).translate(x, PARK_Y + th / 2, z));
        bins.add('roof', new THREE.ConeGeometry(2.6, 4, 10).translate(x, PARK_Y + th + 2, z));
        bins.add('lit', bare(new THREE.SphereGeometry(0.9, 8, 6).translate(x, PARK_Y + th + 4.5, z)));
      }
    }
    return bins.merged();
  }, [light, kit.p.wheelCab, kit.p.canopy]);
  return (
    <group>
      <mesh geometry={built.body} material={kit.painted(kit.p.silhouette, 0.9)} />
      <mesh geometry={built.roof} material={kit.painted(kit.p.silhouette, 0.8)} />
      {built.tent && <mesh geometry={built.tent} material={kit.vcol} />}
      {built.lit && <mesh geometry={built.lit} material={kit.glow(kit.p.bulb, light ? 0.9 : 2.2)} />}
    </group>
  );
}

function Lights({ kit, light }: { kit: Kit; light: boolean }) {
  const { p } = kit;
  const scene = useThree((s) => s.scene);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const dir = light ? SUN_DIR : MOON_LIGHT;
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.copy(BOARD_CENTRE);
    return o;
  }, []);
  useLayoutEffect(() => {
    scene.add(target);
    if (sunRef.current) sunRef.current.target = target;
    return () => {
      scene.remove(target);
    };
  }, [scene, target]);
  const pos = dir.clone().multiplyScalar(260).add(BOARD_CENTRE);
  return (
    <>
      <hemisphereLight args={[p.hemiSky, p.hemiGround, light ? 1.15 : 1.7]} />
      {/* the warm wash of the park's own lamps, low from the front */}
      <directionalLight position={[BOARD_CENTRE.x + 40, 40, 260]} intensity={light ? 0.45 : 1.5} color={p.fillLight} />
      <directionalLight
        ref={sunRef}
        position={pos.toArray()}
        intensity={light ? 3.3 : 2.3}
        color={p.sunLight}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-130}
        shadow-camera-right={130}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-camera-near={20}
        shadow-camera-far={600}
        shadow-bias={-0.0003}
        shadow-normalBias={0.05}
      />
    </>
  );
}

/** Night reflections without a download: warm string-light panels low around the park and a cool sky above. */
function NightEnvironment() {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.7}>
      <Lightformer form="rect" intensity={0.6} color="#3a4a8c" scale={[60, 60, 1]} position={[0, 30, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <Lightformer form="rect" intensity={2.2} color="#ffb070" scale={[40, 3, 1]} position={[0, 2, 30]} />
      <Lightformer form="rect" intensity={1.6} color="#ffc890" scale={[40, 3, 1]} position={[-30, 3, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Lightformer form="rect" intensity={1.2} color="#ff9a70" scale={[40, 3, 1]} position={[30, 3, -10]} rotation={[0, -Math.PI / 2, 0]} />
      <Lightformer form="ring" intensity={2.5} color="#dfe6ff" scale={4} position={[10, 22, -30]} />
    </Environment>
  );
}

/** Theme Park backdrop: the sky, the park floor with promenades and trees, the skyline rides, lights and reflections. */
export function Backdrop() {
  const kit = useKit();
  const light = useResolvedTheme() === 'light';
  return (
    <>
      <SkyDome light={light} />
      <Grounds kit={kit} />
      <Trees kit={kit} />
      <ParkSign kit={kit} light={light} />
      <FerrisWheel kit={kit} light={light} />
      <SkylineCoaster kit={kit} light={light} />
      <Skyline kit={kit} light={light} />
      <Lights kit={kit} light={light} />
      {light ? (
        <Suspense fallback={null}>
          <Environment files={ASSET_BASE + 'industrial_sunset_02_puresky.hdr'} environmentIntensity={0.75} environmentRotation={[0, 2.4, 0]} />
        </Suspense>
      ) : (
        <NightEnvironment />
      )}
    </>
  );
}

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { reducedMotion, rng, useResolvedTheme } from '../api';
// the backdrop is not told how long the roads run; the live stage count is (as Casino's floor does)
import { BAND_W, PHASES } from '../../lib/domains';
import { Bins, GROUND_Y, LOWER_Y, box, chunk, lettered, monogram, stencilText, strut, useKit, v3, worldUV, type Kit } from './kit';

/*
 * The sand table come alive: printed map terrain with grid squares and contour bands running out to the
 * horizon, a low escarpment past the end of the roads down to the flat where the depot and helipad stand,
 * scrub and rocks round the edges, and the base gate in front of the board. The horizon view gets its own
 * skyline beyond the Overview's frame: ridgelines of flat-topped mesas, a radio mast with a slow white
 * strobe on the left, a water tower, a row of huts and a tethered weather balloon, and an airfield on the
 * right with blue runway lights and a cargo plane. Night Watch has stars, a thin moon and sodium lights;
 * Daylight Exercise has a dusty blue sky with a few cumulus.
 */

/** Rough centre of a 12-row board. */
const BOARD_CENTRE = new THREE.Vector3(45, 0, -42);
/** Keep scenery out of this box (the board, compounds, landmarks, library and the depot). */
const CLEAR = { x0: -60, x1: 150, z0: -150, z1: 30 };
/** End of the roads in x: the table steps down to the flat just past it. */
const roadsEnd = () => (PHASES.length - 0.5) * BAND_W + 1;

const MOON_DIR = new THREE.Vector3(-0.45, 0.42, -0.78).normalize();
const SUN_DIR = new THREE.Vector3(-0.55, 0.64, 0.54).normalize();

/** The sky: zenith to a haze band at the horizon that matches the fog, stars and a thin moon by night, cumulus by day. */
function SkyDome({ kit, light }: { kit: Kit; light: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color(kit.p.skyZenith) },
          horizon: { value: new THREE.Color(kit.p.skyHorizon) },
          below: { value: new THREE.Color(kit.p.fog) },
          cloud: { value: new THREE.Color(kit.p.cloud) },
          moonDir: { value: MOON_DIR },
          sunDir: { value: SUN_DIR },
          night: { value: light ? 0 : 1 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith, horizon, below, cloud, moonDir, sunDir;
          uniform float night;
          varying vec3 vDir;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.32, h));
            // below the horizon the dome is the fog colour, so the ground fades into it without a seam
            col = mix(col, below, 1.0 - smoothstep(-0.02, 0.05, h));
            if (night > 0.5) {
              // stars: a fixed grid of directions, only above the haze
              vec3 g = floor(d * 260.0);
              float s = hash(g);
              float star = step(0.9965, s) * smoothstep(0.06, 0.3, h) * (0.5 + 0.5 * hash(g + 3.1));
              col += vec3(0.85, 0.9, 1.0) * star * 0.9;
              // a thin crescent: the moon's disc less a disc offset toward the sun side
              float m = dot(d, moonDir);
              float disc = smoothstep(0.99955, 0.99965, m);
              vec3 side = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)));
              float cut = smoothstep(0.99955, 0.99965, dot(d, normalize(moonDir + side * 0.018)));
              col += vec3(0.95, 0.93, 0.82) * max(disc - cut, 0.0) * 1.6;
              col += vec3(0.25, 0.3, 0.45) * pow(max(m, 0.0), 400.0) * 0.25;
            } else {
              // a dusty sun glow and three low cumulus banks
              float sd = max(dot(d, sunDir), 0.0);
              col += vec3(1.0, 0.96, 0.85) * (pow(sd, 300.0) * 0.6 + pow(sd, 12.0) * 0.08);
              float az = atan(d.x, -d.z);
              float band = smoothstep(0.015, 0.06, h) * (1.0 - smoothstep(0.12, 0.26, h));
              float puffs = 0.0;
              for (int i = 0; i < 3; i++) {
                float c = -0.75 + float(i) * 0.72;
                puffs += exp(-pow((az - c) / 0.22, 2.0));
              }
              float n = fbm(vec2(az * 9.0, h * 22.0));
              float cl = smoothstep(0.42, 0.7, n * puffs * band * 1.6);
              col = mix(col, cloud, cl * 0.85);
            }
            col += (hash(d * 913.0) - 0.5) / 255.0;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [kit, light],
  );
  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[1500, 48, 24]} />
    </mesh>
  );
}

/** The map: the sand table up to the escarpment, the flat below it, and the escarpment face between. */
function Ground({ kit }: { kit: Kit }) {
  const end = roadsEnd();
  const g = useMemo(() => {
    const plane = (x0: number, x1: number, z0: number, z1: number, y: number) => {
      const p = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      return worldUV(p);
    };
    const bins = new Bins();
    // the escarpment: a face of layered strata, stepping in a little at each band
    const z0 = -2600;
    const z1 = 2600;
    const h = GROUND_Y - LOWER_Y;
    const strata = [kit.p.terrainAlt, kit.p.khaki, kit.p.terrainAlt];
    for (let i = 0; i < 3; i++) {
      const y0 = LOWER_Y + (i * h) / 3;
      bins.paint('cliff', box(1.2 - i * 0.25, h / 3, z1 - z0, end + 0.6 - i * 0.12, y0 + h / 6, (z0 + z1) / 2, 0.1), new THREE.Color(strata[i]).multiplyScalar(kit.light ? 0.95 : 1.1));
    }
    return { upper: plane(-2600, end, z0, z1, GROUND_Y), lower: plane(end, 2600, z0, z1, LOWER_Y), m: bins.merged() };
  }, [end, kit]);
  return (
    <group>
      <mesh geometry={g.upper} material={kit.terrain} receiveShadow />
      <mesh geometry={g.lower} material={kit.terrain} receiveShadow />
      <mesh geometry={g.m.cliff} material={kit.vcol} receiveShadow />
    </group>
  );
}

/** Low scrub and boulders round the board, never on it. */
function Scrub({ kit }: { kit: Kit }) {
  const bush = useRef<THREE.InstancedMesh>(null);
  const rock = useRef<THREE.InstancedMesh>(null);
  const end = roadsEnd();
  const placed = useMemo(() => {
    const r = rng(0x5c4b);
    const bushes: THREE.Matrix4[] = [];
    const rocks: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 900 && bushes.length + rocks.length < 520; i++) {
      const x = -320 + r() * 760;
      const z = -420 + r() * 520;
      if (x > CLEAR.x0 && x < CLEAR.x1 + 40 && z > CLEAR.z0 && z < CLEAR.z1) continue;
      // nothing on the escarpment face
      if (Math.abs(x - end) < 4) continue;
      const y = x > end ? LOWER_Y : GROUND_Y;
      const s = 0.6 + r() * 1.6;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, r() * 6.28).clone(), new THREE.Vector3(s * (0.8 + r() * 0.6), s * (0.5 + r() * 0.4), s));
      (r() < 0.7 ? bushes : rocks).push(m);
    }
    return { bushes, rocks };
  }, [end]);
  useLayoutEffect(() => {
    for (const [ref, list] of [[bush, placed.bushes], [rock, placed.rocks]] as const) {
      const m = ref.current;
      if (!m) continue;
      list.forEach((x, i) => m.setMatrixAt(i, x));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [placed]);
  const geo = useMemo(() => ({ bush: new THREE.IcosahedronGeometry(0.8, 0).translate(0, 0.35, 0), rock: new THREE.DodecahedronGeometry(0.7, 0).translate(0, 0.2, 0) }), []);
  return (
    <group>
      <instancedMesh ref={bush} args={[geo.bush, kit.netting, placed.bushes.length]} />
      <instancedMesh ref={rock} args={[geo.rock, kit.khaki, placed.rocks.length]} />
    </group>
  );
}

/** Flat-topped mesas in three ridgelines behind and beside the board, fading into the haze. */
function Mesas({ kit }: { kit: Kit }) {
  const refs = [useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null)];
  const rings = useMemo(() => {
    const r = rng(0x3e5a);
    return [900, 1150, 1400].map((radius, k) => {
      const list: THREE.Matrix4[] = [];
      const n = 30 + k * 10;
      for (let i = 0; i < n; i++) {
        // the back half and the sides only: the camera looks in from the front
        const a = Math.PI * (1.02 + (i / (n - 1)) * 0.96) + (r() - 0.5) * 0.05;
        const rad = radius * (0.92 + r() * 0.16);
        const x = BOARD_CENTRE.x + Math.cos(a) * rad * 1.25;
        const z = BOARD_CENTRE.z + Math.sin(a) * rad;
        const w = 60 + r() * 90 + k * 30;
        const h = 14 + r() * 26 + k * 14;
        list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, GROUND_Y - 2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(w, h, w * (0.5 + r() * 0.5))));
      }
      return list;
    });
  }, []);
  useLayoutEffect(() => {
    rings.forEach((list, k) => {
      const m = refs[k].current;
      if (!m) return;
      list.forEach((x, i) => m.setMatrixAt(i, x));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    });
  });
  // a stepped, flat-topped butte: a wide base, a cliff band and a cap
  const geo = useMemo(() => {
    const parts = [new THREE.CylinderGeometry(0.42, 0.5, 0.55, 7).translate(0, 0.275, 0), new THREE.CylinderGeometry(0.34, 0.4, 0.45, 7).translate(0, 0.775, 0)];
    const bins = new Bins();
    for (const p of parts) bins.add('m', p);
    const g = bins.merged().m;
    g.computeVertexNormals();
    return g;
  }, []);
  const mats = useMemo(() => {
    // layers of haze: each ridgeline further into the horizon colour; fog off so the far ones still read
    const base = new THREE.Color(kit.p.mesa);
    const haze = new THREE.Color(kit.p.skyHorizon);
    return [0.25, 0.45, 0.62].map((k) => new THREE.MeshBasicMaterial({ color: base.clone().lerp(haze, k), fog: false }));
  }, [kit]);
  return (
    <group>
      {rings.map((list, k) => (
        <instancedMesh key={k} ref={refs[k]} args={[geo, mats[k], list.length]} />
      ))}
    </group>
  );
}

/** A tall lattice mast: four legs, cross bracing, a platform; its strobe is drawn separately. */
function latticeMast(bins: Bins, x: number, z: number, h: number, steel: string) {
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (y: number) => 3.2 * (1 - y / h) + 0.5;
  for (const [sx, sz] of legs) bins.paint('sky', strut(v3(x + sx * at(0), GROUND_Y, z + sz * at(0)), v3(x + sx * at(h), GROUND_Y + h, z + sz * at(h)), 0.25, 5), steel);
  for (let y = 0; y < h - 4; y += 7) {
    for (let k = 0; k < 4; k++) {
      const [ax, az] = legs[k];
      const [bx, bz] = legs[(k + 1) % 4];
      bins.paint('sky', strut(v3(x + ax * at(y), GROUND_Y + y, z + az * at(y)), v3(x + bx * at(y + 7), GROUND_Y + y + 7, z + bz * at(y + 7)), 0.12, 4), steel);
    }
  }
}

/** The horizon skyline: mast, water tower, huts, hangars, runway; drawn far beyond the Overview's frame. */
function Skyline({ kit, light }: { kit: Kit; light: boolean }) {
  const { p } = kit;
  const MAST = { x: -330, z: -470, h: 120 };
  const RUNWAY = { x: 560, z: -430, len: 420, w: 26 };
  const built = useMemo(() => {
    const bins = new Bins();
    const steel = new THREE.Color(p.steel).multiplyScalar(0.9);
    latticeMast(bins, MAST.x, MAST.z, MAST.h, `#${steel.getHexString()}`);
    // guy wires
    for (const [dx, dz] of [[40, 30], [-40, 30], [0, -45]]) bins.paint('sky', strut(v3(MAST.x + dx, GROUND_Y, MAST.z + dz), v3(MAST.x, GROUND_Y + MAST.h * 0.8, MAST.z), 0.06, 3), p.steel);
    // water tower: four legs, a tank and a conical roof
    const wt = { x: -170, z: -400 };
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bins.paint('sky', strut(v3(wt.x + sx * 7, GROUND_Y, wt.z + sz * 7), v3(wt.x + sx * 4, GROUND_Y + 26, wt.z + sz * 4), 0.6, 5), p.steel);
    bins.paint('sky', new THREE.CylinderGeometry(8, 8, 10, 16).translate(wt.x, GROUND_Y + 31, wt.z), p.olive);
    bins.paint('sky', new THREE.ConeGeometry(8.6, 4, 16).translate(wt.x, GROUND_Y + 38, wt.z), p.oliveDark);
    // a row of huts (corrugated half-cylinders) between the tower and the balloon
    for (let i = 0; i < 6; i++) {
      const hx = -120 + i * 26;
      bins.paint('sky', new THREE.CylinderGeometry(7, 7, 22, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).rotateY(Math.PI / 2).translate(hx, GROUND_Y, -360 - (i % 2) * 14), i % 3 ? p.steel : p.khaki);
    }
    // hangars beside the runway, with their doors facing it
    for (let i = 0; i < 4; i++) {
      const hx = RUNWAY.x - 150 + i * 70;
      bins.paint('sky', new THREE.CylinderGeometry(20, 20, 40, 18, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(hx, GROUND_Y, RUNWAY.z - 70), p.steel, 0.85);
      bins.paint('sky', box(30, 14, 0.8, hx, GROUND_Y + 7, RUNWAY.z - 49.6), p.oliveDark);
    }
    // the control tower with its cab, and a windsock mast
    bins.paint('sky', box(10, 30, 10, RUNWAY.x + 230, GROUND_Y + 15, RUNWAY.z - 40), p.khaki);
    bins.paint('sky', box(14, 6, 14, RUNWAY.x + 230, GROUND_Y + 33, RUNWAY.z - 40), p.oliveDark);
    // the runway and its taxiway, painted flat on the map
    const strip = new Bins();
    strip.paint('run', box(RUNWAY.len, 0.2, RUNWAY.w, RUNWAY.x, GROUND_Y + 0.1, RUNWAY.z), p.concrete);
    strip.paint('run', box(RUNWAY.len * 0.7, 0.2, 10, RUNWAY.x, GROUND_Y + 0.08, RUNWAY.z - 30), p.concrete, 0.9);
    for (let i = 0; i < 18; i++) strip.paint('run', box(10, 0.24, 1.2, RUNWAY.x - RUNWAY.len / 2 + 20 + i * 22, GROUND_Y + 0.12, RUNWAY.z), p.roadLine);
    return { m: bins.merged(), run: strip.merged().run };
  }, [p]);
  // the runway edge lights: one Points draw
  const lights = useMemo(() => {
    const pos: number[] = [];
    for (let i = 0; i <= 30; i++) for (const s of [-1, 1]) pos.push(RUNWAY.x - RUNWAY.len / 2 + (i * RUNWAY.len) / 30, GROUND_Y + 0.8, RUNWAY.z + (s * (RUNWAY.w + 2)) / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, []);
  const lightMat = useMemo(
    () => new THREE.PointsMaterial({ color: new THREE.Color(p.runwayLight).multiplyScalar(light ? 1.2 : 2.6), size: light ? 2.2 : 3.4, map: kit.softMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true }),
    [p, light, kit],
  );
  const strobe = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    // a slow white strobe: one short flash every two seconds, never faster than 1 Hz
    if (strobe.current) strobe.current.visible = reducedMotion() || clock.elapsedTime % 2 < 0.25;
  });
  return (
    <group>
      <mesh geometry={built.m.sky} material={kit.vcol} />
      <mesh geometry={built.run} material={kit.vcol} receiveShadow />
      <points geometry={lights} material={lightMat} frustumCulled={false} />
      <mesh ref={strobe} position={[MAST.x, GROUND_Y + MAST.h + 1.5, MAST.z]} material={kit.glow(p.strobe, light ? 2 : 4)}>
        <sphereGeometry args={[1.6, 10, 8]} />
      </mesh>
      <WeatherBalloon kit={kit} />
      <CargoPlane kit={kit} light={light} runway={RUNWAY} />
    </group>
  );
}

/** A big tethered weather balloon swaying over the huts. */
function WeatherBalloon({ kit }: { kit: Kit }) {
  const ref = useRef<THREE.Group>(null);
  const at = { x: 40, z: -520, h: 95 };
  const tether = useMemo(() => strut(v3(0, -at.h + 2, 0), v3(0, -9, 0), 0.15, 4), [at.h]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g || reducedMotion()) return;
    const t = clock.elapsedTime;
    g.rotation.z = Math.sin(t * 0.25) * 0.05;
    g.rotation.x = Math.sin(t * 0.18 + 1) * 0.04;
  });
  return (
    <group ref={ref} position={[at.x, GROUND_Y + at.h, at.z]}>
      <mesh material={kit.painted(kit.p.stencil, 0.5)}>
        <sphereGeometry args={[9, 20, 14]} />
      </mesh>
      <mesh geometry={tether} material={kit.steel} />
    </group>
  );
}

/**
 * A high-wing cargo plane on the airfield. By day it taxis, takes off and comes round on a long loop
 * every 90 s; by night it sits by the hangars under their lights.
 */
function CargoPlane({ kit, light, runway }: { kit: Kit; light: boolean; runway: { x: number; z: number; len: number } }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const bins = new Bins();
    const { p } = kit;
    bins.paint('b', new THREE.CylinderGeometry(3.2, 3.0, 34, 12).rotateZ(Math.PI / 2), p.olive);
    bins.paint('b', new THREE.ConeGeometry(3.2, 7, 12).rotateZ(-Math.PI / 2).translate(20.5, 0, 0), p.olive);
    bins.paint('b', new THREE.ConeGeometry(3.0, 12, 12).rotateZ(Math.PI / 2).translate(-23, 1.5, 0), p.olive);
    bins.paint('b', box(9, 0.8, 52, 3, 3.2, 0), p.oliveDark);
    bins.paint('b', box(1.2, 9, 0.8, -26, 6, 0), p.oliveDark);
    bins.paint('b', box(6, 0.6, 18, -26, 2.6, 0), p.oliveDark);
    for (const z of [-17, -8, 8, 17]) bins.paint('b', new THREE.CylinderGeometry(1.2, 1.2, 6, 10).rotateZ(Math.PI / 2).translate(5, 2.2, z), p.steel);
    // the cockpit glazing
    bins.paint('b', box(3, 1.2, 4.2, 15.5, 1.8, 0), p.bezel);
    return bins.merged().b;
  }, [kit]);
  const path = useMemo(() => {
    // taxi to the threshold, roll, climb out, a wide circuit, and land again
    const y = GROUND_Y + 4;
    const x0 = runway.x - runway.len / 2 + 20;
    const x1 = runway.x + runway.len / 2;
    return new THREE.CatmullRomCurve3(
      [
        v3(x0, y, runway.z),
        v3(runway.x, y, runway.z),
        v3(x1 + 40, y + 30, runway.z),
        v3(x1 + 260, y + 120, runway.z - 120),
        v3(runway.x, y + 160, runway.z - 340),
        v3(x0 - 260, y + 120, runway.z - 120),
        v3(x0 - 120, y + 30, runway.z),
        v3(x0 - 40, y + 4, runway.z),
      ],
      true,
      'centripetal',
    );
  }, [runway]);
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), t: new THREE.Vector3() }), []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (!light || reducedMotion()) {
      g.position.set(runway.x - 60, GROUND_Y + 4, runway.z - 42);
      g.rotation.set(0, Math.PI / 2, 0);
      return;
    }
    const u = (clock.elapsedTime / 90) % 1;
    path.getPointAt(u, tmp.p);
    path.getTangentAt(u, tmp.t);
    g.position.copy(tmp.p);
    g.rotation.set(0, Math.atan2(-tmp.t.z, tmp.t.x), Math.asin(Math.max(-0.4, Math.min(0.4, tmp.t.y))));
  });
  return <mesh ref={ref} geometry={geo} material={kit.vcol} />;
}

/** The base gate in front of the board: two olive pylons and a stencilled sign over the road in. */
function BaseGate({ kit, light }: { kit: Kit; light: boolean }) {
  const W = 34;
  const H = 5.6;
  const texture = useMemo(
    () =>
      lettered(1700, 280, (g, w, h) => {
        const bg = kit.p.olive;
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = kit.p.stencil;
        g.lineWidth = 6;
        g.strokeRect(16, 16, w - 32, h - 32);
        monogram(g, 150, 140, 150, kit.p.stencil, bg);
        monogram(g, w - 150, 140, 150, kit.p.stencil, bg);
        stencilText(g, 'SHUFLER FIELD HQ', w / 2, 112, 104, kit.p.stencil, { bg, spacing: 14 });
        stencilText(g, 'SUPPLY · BUILD · SHIP', w / 2, 212, 50, kit.p.stencil, { bg, spacing: 18 });
      }),
    [kit],
  );
  const built = useMemo(() => {
    const bins = new Bins();
    for (const s of [-1, 1]) {
      const x = (s * (W + 3)) / 2;
      bins.paint('g', chunk(2.6, H + 3.4, 2.6, 0.18).translate(x, 0, 0), kit.p.olive);
      bins.paint('g', chunk(3.2, 0.7, 3.2, 0.12).translate(x, 0, 0), kit.p.oliveDark);
      bins.paint('g', chunk(3.0, 0.5, 3.0, 0.1).translate(x, H + 3.4, 0), kit.p.oliveDark);
      // floodlights on the pylon tops, aimed at the sign
      bins.paint('g', box(0.8, 0.5, 0.8, x - s * 0.4, H + 4.2, 0.9), kit.p.bezel);
    }
    bins.paint('g', box(W + 4, 0.5, 0.8, 0, H + 2.7, 0), kit.p.oliveDark);
    return bins.merged().g;
  }, [kit]);
  return (
    <group position={[40, GROUND_Y, 22]}>
      <mesh geometry={built} material={kit.vcol} castShadow receiveShadow />
      <group position={[0, H / 2 + 0.5, 0]} rotation={[-0.42, 0, 0]}>
        <mesh material={kit.oliveDark} castShadow>
          <boxGeometry args={[W + 0.6, H + 0.6, 0.35]} />
        </mesh>
        {texture && (
          <mesh position={[0, 0, 0.19]}>
            <planeGeometry args={[W, H]} />
            <meshStandardMaterial map={texture} roughness={0.75} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={light ? 0.04 : 0.32} />
          </mesh>
        )}
      </group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (W + 3)) / 2 - s * 0.4, H + 4.0, 1.35]} material={kit.glow(kit.p.floodLamp, light ? 1.1 : 3)}>
          <boxGeometry args={[0.6, 0.3, 0.1]} />
        </mesh>
      ))}
      {!light && <mesh position={[0, 0.05, 6]} rotation={[-Math.PI / 2, 0, 0]} material={kit.pool(kit.p.floodLamp, 0.22)}>
        <planeGeometry args={[W + 16, 16]} />
      </mesh>}
    </group>
  );
}

function Lights({ kit, light }: { kit: Kit; light: boolean }) {
  const { p } = kit;
  const scene = useThree((s) => s.scene);
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.copy(BOARD_CENTRE);
    return o;
  }, []);
  useLayoutEffect(() => {
    scene.add(target);
    if (keyRef.current) keyRef.current.target = target;
    return () => {
      scene.remove(target);
    };
  }, [scene, target]);
  // daylight: a warm sun from front-left at about 40°; night: a cool moon high from back-left
  const dir = light ? SUN_DIR.clone() : new THREE.Vector3(-0.35, 0.86, 0.1).normalize();
  const pos = dir.multiplyScalar(260).add(BOARD_CENTRE);
  return (
    <>
      <hemisphereLight args={[p.hemiSky, p.hemiGround, light ? 1.25 : 2.1]} />
      <directionalLight position={[BOARD_CENTRE.x + 120, 80, 200]} intensity={light ? 0.45 : 1.1} color={p.fillLight} />
      <directionalLight
        ref={keyRef}
        position={pos.toArray()}
        intensity={light ? 2.9 : 3.0}
        color={p.keyLight}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-140}
        shadow-camera-right={140}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
        shadow-camera-near={20}
        shadow-camera-far={600}
        shadow-bias={-0.0003}
        shadow-normalBias={0.05}
      />
    </>
  );
}

/** Reflections without a download: sky and ground panels, plus sodium lamps low round the base at night. */
function Env({ light }: { light: boolean }) {
  return light ? (
    <Environment resolution={128} frames={1} environmentIntensity={0.55}>
      <Lightformer form="rect" intensity={1.6} color="#dfe8ef" scale={[80, 80, 1]} position={[0, 40, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <Lightformer form="rect" intensity={0.9} color="#e9dcb8" scale={[80, 10, 1]} position={[0, 2, 40]} />
      <Lightformer form="rect" intensity={0.7} color="#c9b48a" scale={[80, 10, 1]} position={[-40, 2, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Lightformer form="ring" intensity={3} color="#fff4df" scale={10} position={[-30, 30, 30]} />
    </Environment>
  ) : (
    <Environment resolution={128} frames={1} environmentIntensity={0.5}>
      <Lightformer form="rect" intensity={0.6} color="#3a4a6a" scale={[80, 80, 1]} position={[0, 40, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <Lightformer form="rect" intensity={1.4} color="#ffb874" scale={[80, 4, 1]} position={[0, 3, 30]} />
      <Lightformer form="rect" intensity={0.8} color="#7fe0c2" scale={[60, 4, 1]} position={[30, 3, -10]} rotation={[0, -Math.PI / 2, 0]} />
    </Environment>
  );
}

/** Command Post backdrop: sky, the map and escarpment, scrub, the far skyline, the base gate, lights. */
export function Backdrop() {
  const kit = useKit();
  const light = useResolvedTheme() === 'light';
  return (
    <>
      <SkyDome kit={kit} light={light} />
      <Ground kit={kit} />
      <Scrub kit={kit} />
      <Mesas kit={kit} />
      <Skyline kit={kit} light={light} />
      <BaseGate kit={kit} light={light} />
      <Lights kit={kit} light={light} />
      <Env light={light} />
    </>
  );
}


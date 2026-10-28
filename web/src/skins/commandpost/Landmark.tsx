import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type LandmarkProps } from '../api';
import { Bins, GROUND_Y, MAP_TILE, box, chunk, post, roundedRect, strut, useKit, v3, type Kit } from './kit';

/*
 * Each stage's landmark is a sector facility on its own raised pad behind the column, every one a place
 * where people build, check or move things: a weather station for brainstorming (ideas in the air), a map
 * room for planning, an engineer yard with a crane for building, a proving ground for QA, an inspection bay
 * for review, a bridge checkpoint for merging (the boom lifts when the gate is clear) and an airstrip for
 * deploy, with a crate floating down under a parachute. The pad's front edge is a dark ops-board strip
 * carrying the phase accent. Parts move gently while something live sits in the district.
 */

/** Landmark origin height in the world (SKY_Y - 0.7) and the scale the skin asks for. */
const ORIGIN_Y = 4.8;
export const LANDMARK_SCALE = 2.0;
/** The map in landmark-local units. */
const FLOOR = (GROUND_Y - ORIGIN_Y) / LANDMARK_SCALE - 0.02;
const PAD_W = 6.3;
const PAD_D = 5.8;

/** Turns its children about an axis while `on`. */
function Turn({ on, speed = 0.4, axis = 'y', children, position, rotation }: { on: boolean; speed?: number; axis?: 'x' | 'y' | 'z'; children: ReactNode; position?: [number, number, number]; rotation?: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g || !on || reducedMotion()) return;
    g.rotation[axis] += dt * speed;
  });
  return (
    <group position={position} rotation={rotation}>
      <group ref={ref}>{children}</group>
    </group>
  );
}

/** Rocks its children about an axis (a sway or a swing) while `on`. */
function Sway({ on, amp, speed, axis = 'z', base = 0, children, position }: { on: boolean; amp: number; speed: number; axis?: 'x' | 'y' | 'z'; base?: number; children: ReactNode; position?: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.rotation[axis] = base + (on && !reducedMotion() ? Math.sin(clock.elapsedTime * speed) * amp : 0);
  });
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

/** The raised pad every facility stands on: a plateau down to the map, the map on top, a dark front strip with the accent. */
function Pad({ kit, accent, active }: { kit: Kit; accent: string; active: boolean }) {
  const geo = useMemo(() => {
    const drop = -FLOOR;
    const g = new THREE.ExtrudeGeometry(roundedRect(PAD_W, PAD_D, 1.0), { depth: drop, steps: 2, bevelEnabled: false, curveSegments: 5 });
    g.rotateX(Math.PI / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const a = new THREE.Color(kit.p.terrainAlt);
    const k = new THREE.Color(kit.p.khaki);
    for (let i = 0; i < pos.count; i++) {
      const t = 1 + pos.getY(i) / drop;
      const c = (t > 0.5 ? k.clone().lerp(a, 0.35) : a.clone().lerp(k, 0.08)).multiplyScalar(kit.light ? 0.92 : 1.2);
      col.set([c.r, c.g, c.b], i * 3);
      uv.setXY(i, (pos.getX(i) * LANDMARK_SCALE) / MAP_TILE, (-pos.getZ(i) * LANDMARK_SCALE) / MAP_TILE);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return {
      body: g,
      strip: box(PAD_W - 1.6, 0.06, 0.7, 0, 0.03, PAD_D / 2 - 0.45),
      line: box(PAD_W - 2.0, 0.03, 0.12, 0, 0.075, PAD_D / 2 - 0.45),
    };
  }, [kit]);
  const mats = useMemo(() => [kit.mapTop, kit.vcol], [kit]);
  return (
    <group>
      <mesh geometry={geo.body} material={mats} castShadow receiveShadow />
      <mesh geometry={geo.strip} material={kit.opsBoard} receiveShadow />
      <mesh geometry={geo.line} material={kit.glow(accent, active ? 3 : kit.light ? 1.3 : 2)} />
    </group>
  );
}

/** Builds a vertex-coloured static geometry once per kit. */
function useStatic(kit: Kit, build: (b: Bins, kit: Kit) => void) {
  return useMemo(() => {
    const b = new Bins();
    build(b, kit);
    return b.merged();
  }, [kit]);
}

/* ---------- A: weather station ---------- */

function WeatherStation({ kit, lit }: { kit: Kit; lit: boolean }) {
  const s = useStatic(kit, (b, k) => {
    // a hut with a pitched roof
    b.paint('v', chunk(1.8, 1.3, 1.4, 0.06).translate(-1.2, 0, 0.2), k.p.khaki);
    const roof = new THREE.CylinderGeometry(0.01, 1.35, 0.6, 4, 1).rotateY(Math.PI / 4).scale(1.0, 1, 0.78).translate(-1.2, 1.6, 0.2);
    b.paint('v', roof, k.p.oliveDark);
    b.paint('v', box(0.4, 0.75, 0.04, -1.2, 0.38, 0.92), k.p.oliveDark);
    b.paint('v', box(0.5, 0.35, 0.04, -0.62, 0.8, 0.92), k.p.bezel);
    // the anemometer mast and a rain gauge on a stand
    b.paint('v', post(1.2, 0.6, 0, 2.6, 0.05, 6), k.p.steel);
    b.paint('v', post(0.4, 1.2, 0, 0.6, 0.03, 5), k.p.steel);
    b.paint('v', new THREE.CylinderGeometry(0.14, 0.12, 0.35, 10).translate(0.4, 0.78, 1.2), k.p.steel);
    // the balloon's winch
    b.paint('v', chunk(0.6, 0.4, 0.5, 0.04).translate(0.4, 0, -1.4), k.p.olive);
    b.paint('v', new THREE.CylinderGeometry(0.16, 0.16, 0.5, 10).rotateX(Math.PI / 2).translate(0.4, 0.5, -1.4), k.p.steel);
  });
  return (
    <group>
      <mesh geometry={s.v} material={kit.vcol} castShadow receiveShadow />
      <Turn on={lit} speed={3} position={[1.2, 2.62, 0.6]}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation={[0, (i * Math.PI * 2) / 3, 0]}>
            <mesh position={[0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={kit.steel}>
              <cylinderGeometry args={[0.015, 0.015, 0.5, 4]} />
            </mesh>
            <mesh position={[0.5, 0, 0]} material={kit.painted(kit.p.stencil, 0.6)}>
              <sphereGeometry args={[0.09, 8, 6, 0, Math.PI]} />
            </mesh>
          </group>
        ))}
      </Turn>
      <Sway on amp={0.08} speed={0.5} position={[0.4, 0.55, -1.4]}>
        <mesh position={[0, 2.0, 0]} material={kit.khaki}>
          <cylinderGeometry args={[0.012, 0.012, 4.0, 3]} />
        </mesh>
        <mesh position={[0, 4.4, 0]} material={kit.painted(kit.p.stencil, 0.45)} castShadow>
          <sphereGeometry args={[0.62, 18, 12]} />
        </mesh>
      </Sway>
    </group>
  );
}

/* ---------- B: map room ---------- */

function MapRoom({ kit, lit, accent }: { kit: Kit; lit: boolean; accent: string }) {
  const s = useStatic(kit, (b, k) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.paint('v', post(sx * 2.0, sz * 1.5, 0, 2.2, 0.07, 6), k.p.timber);
    // the canopy: a shallow pitched roof
    for (const s of [-1, 1]) b.paint('v', box(4.6, 0.08, 1.85, 0, 2.38, s * 0.86).rotateX(0), k.p.olive);
    b.paint('v', box(4.6, 0.08, 0.2, 0, 2.5, 0), k.p.oliveDark);
    // the plotting table on trestles
    for (const sx of [-1, 1]) b.paint('v', box(0.1, 0.8, 1.6, sx * 1.2, 0.4, 0), k.p.timber);
    b.paint('v', box(3.0, 0.1, 2.0, 0, 0.85, 0), k.p.timber);
    // stools
    for (const x of [-0.8, 0.8]) b.paint('v', post(x, 1.3, 0, 0.45, 0.14, 8), k.p.oliveDark);
  });
  const pins = useMemo(() => {
    const b = new Bins();
    const pts: [number, number][] = [[-1.0, -0.5], [-0.3, 0.3], [0.5, -0.4], [1.1, 0.5]];
    pts.forEach(([x, z]) => b.add('p', new THREE.SphereGeometry(0.07, 8, 6).translate(x, 1.0, z)));
    for (let i = 0; i < pts.length - 1; i++) b.add('s', strut(v3(pts[i][0], 0.97, pts[i][1]), v3(pts[i + 1][0], 0.97, pts[i + 1][1]), 0.012, 3));
    return b.merged();
  }, []);
  return (
    <group>
      <mesh geometry={s.v} material={kit.vcol} castShadow receiveShadow />
      <mesh position={[0, 0.91, 0]} rotation={[-Math.PI / 2, 0, 0]} material={kit.mapTop}>
        <planeGeometry args={[2.8, 1.8]} />
      </mesh>
      <mesh geometry={pins.p} material={kit.glow(accent, kit.light ? 1.2 : 2)} />
      <mesh geometry={pins.s} material={kit.painted('#d93a2b', 0.6)} />
      {/* the plotting arm sweeps across the map */}
      <Sway on={lit} amp={0.6} speed={0.7} axis="y" base={0.3} position={[-1.35, 0.95, -0.85]}>
        <mesh position={[0.9, 0, 0]} material={kit.steel}>
          <boxGeometry args={[1.8, 0.04, 0.08]} />
        </mesh>
      </Sway>
    </group>
  );
}

/* ---------- C: engineer yard ---------- */

function EngineerYard({ kit, lit }: { kit: Kit; lit: boolean }) {
  const s = useStatic(kit, (b, k) => {
    // the crane's tower: four legs and bracing
    const legs = [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]];
    for (const [x, z] of legs) b.paint('v', post(-1.6 + x, -0.6 + z, 0, 4.2, 0.05, 4), k.p.olive);
    for (let y = 0.4; y < 4.2; y += 0.8)
      for (let i = 0; i < 4; i++) {
        const [ax, az] = legs[i];
        const [bx, bz] = legs[(i + 1) % 4];
        b.paint('v', strut(v3(-1.6 + ax, y, -0.6 + az), v3(-1.6 + bx, y + 0.8, -0.6 + bz), 0.025, 3), k.p.olive);
      }
    b.paint('v', chunk(1.0, 0.25, 1.0, 0.04).translate(-1.6, 0, -0.6), k.p.concrete);
    // stacked girders
    for (let i = 0; i < 3; i++) b.paint('v', box(2.2, 0.18, 0.28, 1.0, 0.09 + i * 0.2, 1.3 - i * 0.02), k.p.steel);
    for (let i = 0; i < 2; i++) b.paint('v', box(2.0, 0.18, 0.28, 1.0, 0.09 + i * 0.2, 1.75), k.p.steel);
    // the bulldozer: tracks, body, cab and blade
    for (const s of [-1, 1]) b.paint('v', chunk(1.3, 0.32, 0.26, 0.08).translate(1.0, 0, -0.9 + s * 0.42), k.p.tyre);
    b.paint('v', chunk(1.0, 0.45, 0.66, 0.06).translate(0.95, 0.28, -0.9), k.p.olive);
    b.paint('v', chunk(0.5, 0.45, 0.5, 0.05).translate(0.75, 0.73, -0.9), k.p.oliveDark);
    b.paint('v', box(0.08, 0.38, 1.1, 1.7, 0.22, -0.9), k.p.steel);
  });
  return (
    <group>
      <mesh geometry={s.v} material={kit.vcol} castShadow receiveShadow />
      <Turn on={lit} speed={0.25} position={[-1.6, 4.25, -0.6]}>
        <mesh position={[0.9, 0, 0]} material={kit.olive} castShadow>
          <boxGeometry args={[3.6, 0.22, 0.26]} />
        </mesh>
        <mesh position={[-0.9, -0.15, 0]} material={kit.concrete}>
          <boxGeometry args={[0.6, 0.4, 0.5]} />
        </mesh>
        <mesh position={[2.3, -0.9, 0]} material={kit.steel}>
          <cylinderGeometry args={[0.012, 0.012, 1.6, 3]} />
        </mesh>
        {/* a bridge panel on the hook */}
        <mesh position={[2.3, -1.75, 0]} material={kit.oliveDark} castShadow>
          <boxGeometry args={[1.2, 0.18, 0.5]} />
        </mesh>
      </Turn>
    </group>
  );
}

/* ---------- D: proving ground ---------- */

function ProvingGround({ kit, lit }: { kit: Kit; lit: boolean }) {
  const s = useStatic(kit, (b, k) => {
    // the test track: a flat oval of road
    const ring = new THREE.RingGeometry(1.5, 2.1, 36, 1).rotateX(-Math.PI / 2).scale(1.25, 1, 0.95).translate(0, 0.03, 0.1);
    b.paint('v', ring, k.p.road, 1.0);
    // cones: cream with a dark band (no hazard yellow)
    for (const [x, z] of [[-0.9, 0.7], [-0.3, 0.75], [0.3, 0.75], [0.9, 0.7]]) {
      b.paint('v', new THREE.ConeGeometry(0.12, 0.34, 8).translate(x, 0.17, z), k.p.stencil);
      b.paint('v', new THREE.CylinderGeometry(0.075, 0.09, 0.07, 8).translate(x, 0.15, z), k.p.bezel);
    }
    // the ramp
    const ramp = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.6, 0), new THREE.Vector2(1.6, 0.7)]);
    const rg = new THREE.ExtrudeGeometry(ramp, { depth: 0.9, bevelEnabled: false });
    b.paint('v', rg.translate(-1.0, 0, -1.6), k.p.concrete);
    // the finish line: a checker board across the track
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) b.paint('v', box(0.2, 0.02, 0.2, 2.25 + j * 0.2, 0.05, -0.2 + i * 0.2 - 0.3), (i + j) % 2 ? '#1c1c1c' : '#f2efe6');
    // the timing hut
    b.paint('v', chunk(0.9, 0.8, 0.7, 0.04).translate(2.3, 0, -1.8), k.p.khaki);
    b.paint('v', box(0.6, 0.22, 0.04, 2.3, 0.55, -1.44), k.p.bezel);
  });
  return (
    <group>
      <mesh geometry={s.v} material={kit.vcol} castShadow receiveShadow />
      {/* a small truck rocking at the top of the ramp */}
      <Sway on={lit} amp={0.12} speed={1.6} base={-0.3} position={[0.45, 0.62, -1.15]}>
        <mesh position={[0, 0.25, 0]} material={kit.olive} castShadow>
          <boxGeometry args={[0.9, 0.38, 0.5]} />
        </mesh>
        <mesh position={[0.25, 0.55, 0]} material={kit.oliveDark}>
          <boxGeometry args={[0.32, 0.26, 0.46]} />
        </mesh>
      </Sway>
    </group>
  );
}

/* ---------- E: inspection bay ---------- */

function InspectionBay({ kit, lit }: { kit: Kit; lit: boolean }) {
  const s = useStatic(kit, (b, k) => {
    // a drive-through shed: portal frames, a curved roof, open ends
    for (const z of [-1.2, 0, 1.2]) {
      for (const sx of [-1, 1]) b.paint('v', box(0.14, 2.0, 0.14, sx * 1.55, 1.0, z), k.p.olive);
    }
    const roof = new THREE.CylinderGeometry(1.7, 1.7, 2.7, 16, 1, true, -Math.PI / 2.6, (Math.PI * 2) / 2.6).rotateX(-Math.PI / 2).scale(1, 0.45, 1).translate(0, 2.0, 0);
    b.paint('v', roof, k.p.oliveDark);
    // the inspection pit and a clipboard stand
    b.paint('v', box(0.7, 0.03, 2.4, 0, 0.03, 0), k.p.bezel);
    b.paint('v', post(2.2, 1.3, 0, 1.0, 0.03, 5), k.p.steel);
    b.paint('v', box(0.36, 0.46, 0.04, 2.2, 1.15, 1.32), k.p.timber);
    b.paint('v', box(0.28, 0.34, 0.02, 2.2, 1.14, 1.35), k.p.stencil);
    // the mirror-on-a-stick trolley
    b.paint('v', box(0.5, 0.06, 0.3, -2.25, 0.18, 1.3), k.p.steel);
    b.paint('v', strut(v3(-2.25, 0.2, 1.3), v3(-1.95, 0.9, 1.3), 0.02, 4), k.p.steel);
    b.paint('v', new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12).rotateZ(0.6).translate(-1.92, 0.95, 1.3), k.p.concrete);
    // floodlight housings on the front frame
    for (const sx of [-1, 1]) b.paint('v', box(0.34, 0.24, 0.24, sx * 1.55, 2.15, 1.35), k.p.bezel);
  });
  const lamps = useRef<THREE.MeshBasicMaterial>(null);
  const base = useMemo(() => new THREE.Color(kit.p.floodLamp), [kit]);
  useFrame(({ clock }) => {
    const m = lamps.current;
    if (!m) return;
    const k = (lit ? 2.4 : 1.2) * (lit && !reducedMotion() ? 0.8 + 0.2 * Math.sin(clock.elapsedTime * 1.4) : 1);
    m.color.copy(base).multiplyScalar(kit.light ? k * 0.6 : k);
  });
  return (
    <group>
      <mesh geometry={s.v} material={kit.vcol} castShadow receiveShadow />
      {/* a vehicle in the bay */}
      <mesh position={[0, 0.35, -0.2]} material={kit.olive} castShadow>
        <boxGeometry args={[0.9, 0.6, 1.6]} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * 1.55, 2.12, 1.48]}>
          <boxGeometry args={[0.26, 0.16, 0.02]} />
          <meshBasicMaterial ref={sx < 0 ? lamps : undefined} color={base} toneMapped={false} />
        </mesh>
      ))}
      {!kit.light && (
        <mesh position={[0, 0.05, 1.6]} rotation={[-Math.PI / 2, 0, 0]} material={kit.pool(kit.p.floodLamp, lit ? 0.35 : 0.18)}>
          <planeGeometry args={[4.5, 3]} />
        </mesh>
      )}
    </group>
  );
}

/* ---------- F: bridge checkpoint ---------- */

function BridgeCheckpoint({ kit, lit }: { kit: Kit; lit: boolean }) {
  const s = useStatic(kit, (b, k) => {
    // a dry gully across the pad, its banks stepping down
    b.paint('v', box(1.6, 0.04, PAD_D - 1.4, 0.4, 0.0, 0), k.p.terrainAlt, 0.7);
    // the Bailey bridge: two truss sides and a deck over the gully
    b.paint('v', box(3.2, 0.12, 1.1, 0.4, 0.32, -0.3), k.p.steel);
    for (const s of [-1, 1]) {
      const z = -0.3 + s * 0.6;
      b.paint('v', box(3.2, 0.08, 0.08, 0.4, 0.95, z), k.p.olive);
      b.paint('v', box(3.2, 0.08, 0.08, 0.4, 0.36, z), k.p.olive);
      for (let i = 0; i <= 6; i++) {
        const x = -1.2 + i * 0.533;
        b.paint('v', box(0.06, 0.6, 0.06, x, 0.66, z), k.p.olive);
        if (i < 6) b.paint('v', strut(v3(x, 0.38, z), v3(x + 0.533, 0.94, z), 0.03, 3), k.p.olive);
      }
    }
    // the gate hut and the boom's post
    b.paint('v', chunk(0.8, 1.1, 0.8, 0.05).translate(-2.0, 0, 1.3), k.p.khaki);
    b.paint('v', box(0.5, 0.3, 0.04, -2.0, 0.75, 1.71), k.p.bezel);
    b.paint('v', new THREE.CylinderGeometry(0.01, 0.62, 0.3, 4).rotateY(Math.PI / 4).translate(-2.0, 1.25, 1.3), k.p.oliveDark);
    b.paint('v', chunk(0.3, 0.75, 0.3, 0.04).translate(-1.5, 0, 0.55), k.p.bezel);
    // bridge lamps on short posts
    for (const x of [-1.25, 2.05]) b.paint('v', post(x, 0.45, 0.3, 1.25, 0.03, 4), k.p.steel);
  });
  const boom = useRef<THREE.Group>(null);
  const st = useRef(lit ? 1 : 0);
  // a black and white boom (red is kept for "your move")
  const boomGeo = useMemo(() => {
    const b = new Bins();
    for (let i = 0; i < 8; i++) b.paint('b', box(0.3, 0.1, 0.1, 0.15 + i * 0.3, 0, 0), i % 2 ? '#1c1c1c' : '#f2efe6');
    return b.merged().b;
  }, []);
  useFrame((_, dt) => {
    const g = boom.current;
    if (!g) return;
    const want = lit ? 1 : 0;
    st.current = reducedMotion() ? want : st.current + Math.sign(want - st.current) * Math.min(Math.abs(want - st.current), dt / 1.2);
    g.rotation.z = st.current * 1.25;
  });
  return (
    <group>
      <mesh geometry={s.v} material={kit.vcol} castShadow receiveShadow />
      <group ref={boom} position={[-1.5, 0.72, 0.55]}>
        <mesh geometry={boomGeo} material={kit.vcol} castShadow />
      </group>
      {[-1.25, 2.05].map((x) => (
        <mesh key={x} position={[x, 1.32, 0.45]} material={lit ? kit.glow(kit.p.floodLamp, 2.4) : kit.bezel}>
          <sphereGeometry args={[0.09, 8, 6]} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- G: airstrip ---------- */

function Airstrip({ kit, lit }: { kit: Kit; lit: boolean }) {
  const s = useStatic(kit, (b, k) => {
    b.paint('v', box(5.4, 0.05, 1.3, 0, 0.03, 0.9), k.p.concrete);
    for (let i = 0; i < 6; i++) b.paint('v', box(0.45, 0.02, 0.08, -2.2 + i * 0.85, 0.065, 0.9), k.p.roadLine);
    // the control tower: a column, a glazed cab and a roof
    b.paint('v', chunk(0.7, 2.4, 0.7, 0.05).translate(-1.6, 0, -1.4), k.p.khaki);
    b.paint('v', chunk(1.2, 0.6, 1.2, 0.05).translate(-1.6, 2.4, -1.4), k.p.bezel);
    b.paint('v', chunk(1.36, 0.12, 1.36, 0.03).translate(-1.6, 3.0, -1.4), k.p.oliveDark);
    // the windsock mast
    b.paint('v', post(1.9, -1.4, 0, 2.2, 0.04, 5), k.p.steel);
    // a parachute landing cross painted on the pad
    b.paint('v', box(1.2, 0.02, 0.22, 1.0, 0.05, -0.9), k.p.stencil);
    b.paint('v', box(0.22, 0.02, 1.2, 1.0, 0.05, -0.9), k.p.stencil);
  });
  return (
    <group>
      <mesh geometry={s.v} material={kit.vcol} castShadow receiveShadow />
      <mesh position={[-1.6, 2.7, -1.4]} material={kit.glow(kit.p.screen, kit.light ? 0.8 : 1.6)}>
        <boxGeometry args={[1.22, 0.3, 1.22]} />
      </mesh>
      <Sway on amp={0.25} speed={1.1} axis="y" base={0.4} position={[1.9, 2.1, -1.4]}>
        <mesh position={[0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={kit.painted(kit.p.stencil, 0.7)}>
          <coneGeometry args={[0.13, 0.6, 8, 1, true]} />
        </mesh>
      </Sway>
      <Parachute kit={kit} lit={lit} />
    </group>
  );
}

/** A supply crate drifting down under a parachute toward the landing cross, then starting again. */
function Parachute({ kit, lit }: { kit: Kit; lit: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const lines = useMemo(() => {
    const b = new Bins();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.add('l', strut(v3(Math.cos(a) * 0.62, 1.15, Math.sin(a) * 0.62), v3(Math.cos(a) * 0.12, 0.32, Math.sin(a) * 0.12), 0.01, 3));
    }
    return b.merged().l;
  }, []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (reducedMotion()) {
      g.position.set(1.0, 2.6, -0.9);
      g.rotation.set(0, 0, 0);
      return;
    }
    const period = lit ? 9 : 14;
    const t = (clock.elapsedTime % period) / period;
    g.position.set(1.0 + Math.sin(t * 6) * 0.25, 4.6 - t * 4.4, -0.9);
    g.rotation.z = Math.sin(clock.elapsedTime * 1.3) * 0.08;
    g.visible = t < 0.97;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 1.1, 0]} material={kit.painted(kit.p.stencil, 0.7)} castShadow>
        <sphereGeometry args={[0.72, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
      </mesh>
      <mesh geometry={lines} material={kit.khaki} />
      <mesh position={[0, 0.15, 0]} material={kit.olive} castShadow>
        <boxGeometry args={[0.34, 0.3, 0.34]} />
      </mesh>
    </group>
  );
}

export function Landmark({ phase, accent, active, lit }: LandmarkProps) {
  const kit = useKit();
  const piece = (() => {
    switch (phase) {
      case 'brainstorm':
        return <WeatherStation kit={kit} lit={lit} />;
      case 'plan':
        return <MapRoom kit={kit} lit={lit} accent={accent} />;
      case 'qa':
        return <ProvingGround kit={kit} lit={lit} />;
      case 'review':
        return <InspectionBay kit={kit} lit={lit} />;
      case 'merge':
        return <BridgeCheckpoint kit={kit} lit={lit} />;
      case 'deploy':
        return <Airstrip kit={kit} lit={lit} />;
      default:
        return <EngineerYard kit={kit} lit={lit} />;
    }
  })();
  return (
    <group>
      <Pad kit={kit} accent={accent} active={active} />
      {piece}
    </group>
  );
}

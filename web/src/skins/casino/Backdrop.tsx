import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { reducedMotion, rng, useResolvedTheme } from '../api';
// the backdrop is not told how long the tables run; the live stage count is (as Theme Park's track does)
import { BAND_W, PHASES } from '../../lib/domains';
import { ASSET_BASE, Bins, FLOOR_Y, LOWER_Y, box, canvas, canvasTexture, spaced, useKit, type Kit } from './kit';

/*
 * The room: a carpeted gaming floor under the tables, a step down past the end of the tables to the hall
 * where the cashier's cage stands, panelled walls far out with banks of slot machines glowing along them,
 * and soft out-of-focus lights in the haze. Dark mode is the floor after hours; light mode is a daytime
 * salon with tall windows. A sign in front of the tables says what every casino means.
 */

/** Rough centre of a 12-row board. */
const BOARD_CENTRE = new THREE.Vector3(45, 0, -42);
/** Keep scenery out of this box (the board, its daises, landmarks and the cashier's cage). */
const CLEAR = { x0: -50, x1: 150, z0: -140, z1: 26 };
const ROOM = { x0: -170, x1: 290, z0: -250, z1: 140, h: 70 };
/** Carpet tile size in world units. */
const TILE = 14;

/** End of the tables in x: the gaming floor stops just past it and steps down to the hall. */
const tablesEnd = () => (PHASES.length - 0.5) * BAND_W + 1;

/** A flat floor rectangle at height y whose UVs count carpet tiles. */
function floorRect(x0: number, x1: number, z0: number, z1: number, y: number) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / TILE, pos.getZ(i) / TILE);
  return g;
}

function Floors({ kit }: { kit: Kit }) {
  const end = tablesEnd();
  const g = useMemo(() => {
    const bins = new Bins();
    bins.add('step', box(0.6, FLOOR_Y - LOWER_Y, ROOM.z1 - ROOM.z0, end + 0.3, (FLOOR_Y + LOWER_Y) / 2, (ROOM.z0 + ROOM.z1) / 2, 0.3));
    bins.add('brass', box(0.7, 0.12, ROOM.z1 - ROOM.z0, end + 0.3, FLOOR_Y + 0.02, (ROOM.z0 + ROOM.z1) / 2));
    return { upper: floorRect(ROOM.x0, end, ROOM.z0, ROOM.z1, FLOOR_Y), lower: floorRect(end, ROOM.x1, ROOM.z0, ROOM.z1, LOWER_Y), m: bins.merged() };
  }, [end]);
  return (
    <group>
      <mesh geometry={g.upper} material={kit.carpet} receiveShadow />
      <mesh geometry={g.lower} material={kit.lowerCarpet} receiveShadow />
      <mesh geometry={g.m.step} material={kit.woodDark} receiveShadow />
      <mesh geometry={g.m.brass} material={kit.brass} />
    </group>
  );
}

/** Panelled walls with pilasters; sconces glow between them at night, tall windows let the day in. */
function Walls({ kit, light }: { kit: Kit; light: boolean }) {
  const g = useMemo(() => {
    const bins = new Bins();
    const { x0, x1, z0, z1, h } = ROOM;
    const lit: THREE.BufferGeometry[] = [];
    const wall = (ax: number, az: number, bx: number, bz: number, y0: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const rot = -Math.atan2(bz - az, bx - ax);
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      // normal pointing into the room
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      bins.add('wall', box(len, h, 1.0, cx, y0 + h / 2, cz, 0.05, rot));
      bins.add('brass', box(len, 0.6, 1.6, cx, y0 + 6, cz, 0.1, rot));
      bins.add('brass', box(len, 1.0, 2.0, cx, y0 + h - 4, cz, 0.1, rot));
      const bays = Math.round(len / 24);
      for (let i = 0; i <= bays; i++) {
        const t = i / bays;
        const px = ax + (bx - ax) * t + nx * 0.8;
        const pz = az + (bz - az) * t + nz * 0.8;
        bins.add('pilaster', box(3, h - 4, 2, px, y0 + (h - 4) / 2, pz, 0.1, rot));
        if (i === bays) continue;
        // between pilasters: an arched panel (a window by day, a sconce-lit recess at night)
        const mx = ax + (bx - ax) * (t + 0.5 / bays) + nx * 0.6;
        const mz = az + (bz - az) * (t + 0.5 / bays) + nz * 0.6;
        const pw = len / bays - 7;
        bins.add('panel', box(pw, 30, 0.6, mx, y0 + 26, mz, 0.1, rot));
        const arch = new THREE.CircleGeometry(pw / 2, 24, 0, Math.PI).rotateY(rot).translate(mx + nx * 0.05, y0 + 41, mz + nz * 0.05);
        const pane = new THREE.PlaneGeometry(pw - 1.4, 28).rotateY(rot).translate(mx + nx * 0.4, y0 + 26, mz + nz * 0.4);
        const archPane = new THREE.CircleGeometry(pw / 2 - 0.7, 24, 0, Math.PI).rotateY(rot).translate(mx + nx * 0.4, y0 + 40, mz + nz * 0.4);
        bins.add('panel', arch);
        lit.push(pane, archPane);
        // sconces either side of each pilaster
        for (const s of [-1, 1]) {
          const sx = ax + (bx - ax) * t + nx * 1.6 + ((bx - ax) / len) * s * 3;
          const sz = az + (bz - az) * t + nz * 1.6 + ((bz - az) / len) * s * 3;
          bins.add('sconce', new THREE.SphereGeometry(0.9, 12, 8).translate(sx, y0 + 20, sz));
        }
      }
    };
    // back wall, side walls; the near side stays open toward the camera
    wall(x0, z0, x1, z0, LOWER_Y);
    wall(x0, z1, x0, z0, LOWER_Y);
    wall(x1, z0, x1, z1, LOWER_Y);
    return { m: bins.merged(), lit: lit.length ? mergeLit(lit) : null };
  }, []);
  return (
    <group>
      <mesh geometry={g.m.wall} material={kit.wall} receiveShadow />
      <mesh geometry={g.m.pilaster} material={kit.pilaster} />
      <mesh geometry={g.m.panel} material={kit.wallPanel} />
      <mesh geometry={g.m.brass} material={kit.brass} />
      {g.lit && <mesh geometry={g.lit} material={light ? kit.glow('#fff6e4', 1.15) : kit.painted('#1a0f0b', 0.4)} />}
      <mesh geometry={g.m.sconce} material={kit.glow(kit.p.bokeh, light ? 1.0 : 2.4)} />
    </group>
  );
}

function mergeLit(list: THREE.BufferGeometry[]) {
  const b = new Bins();
  for (const g of list) {
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    b.add('lit', g);
  }
  return b.merged().lit;
}

const cabinetGeo = new THREE.BoxGeometry(2.2, 4.2, 2.0).translate(0, 2.1, 0);
const screenGeo = new THREE.PlaneGeometry(1.6, 1.3).translate(0, 3.0, 1.01);
const topperGeo = new THREE.BoxGeometry(2.3, 0.5, 2.1).translate(0, 4.45, 0);

/** Banks of slot machines along the walls and in islands round the floor, outside the board. */
function SlotBanks({ kit, light }: { kit: Kit; light: boolean }) {
  const refs = [useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null)];
  const end = tablesEnd();
  const placed = useMemo(() => {
    const out: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const r = rng(0xca5e);
    const glows = [kit.p.slotGlowA, kit.p.slotGlowB, kit.p.slotGlowC, kit.p.slotScreen];
    const add = (x: number, z: number, rotY: number) => {
      const y = x > end ? LOWER_Y : FLOOR_Y;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      out.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)), c: new THREE.Color(glows[Math.floor(r() * glows.length)]) });
    };
    // along the back wall, facing the room
    for (let x = ROOM.x0 + 12; x < ROOM.x1 - 12; x += 2.5) if (r() > 0.12) add(x, ROOM.z0 + 4, 0);
    // along the side walls
    for (let z = ROOM.z0 + 12; z < ROOM.z1 - 20; z += 2.5) {
      if (r() > 0.15) add(ROOM.x0 + 4, z, Math.PI / 2);
      if (r() > 0.15) add(ROOM.x1 - 4, z, -Math.PI / 2);
    }
    // back-to-back islands of machines on the floor, outside the board
    for (let k = 0; k < 26; k++) {
      const cx = ROOM.x0 + 25 + r() * (ROOM.x1 - ROOM.x0 - 50);
      const cz = ROOM.z0 + 25 + r() * (ROOM.z1 - ROOM.z0 - 50);
      if (cx > CLEAR.x0 - 12 && cx < CLEAR.x1 + 12 && cz > CLEAR.z0 - 12 && cz < CLEAR.z1 + 10) continue;
      for (let i = 0; i < 6; i++) {
        add(cx - 6.25 + i * 2.5, cz - 1.1, Math.PI);
        add(cx - 6.25 + i * 2.5, cz + 1.1, 0);
      }
    }
    return out;
  }, [kit, end]);
  useLayoutEffect(() => {
    const [body, screen, top] = refs.map((r) => r.current);
    if (!body || !screen || !top) return;
    const dim = new THREE.Color(kit.p.slotBody);
    placed.forEach((s, i) => {
      body.setMatrixAt(i, s.m);
      screen.setMatrixAt(i, s.m);
      top.setMatrixAt(i, s.m);
      screen.setColorAt(i, s.c.clone().multiplyScalar(light ? 0.9 : 1.7));
      top.setColorAt(i, light ? dim.clone().lerp(s.c, 0.4) : s.c.clone().multiplyScalar(1.2));
    });
    for (const m of [body, screen, top]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [placed, light, kit]);
  const screenMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  return (
    <group>
      <instancedMesh ref={refs[0]} args={[cabinetGeo, kit.slotBody, placed.length]} castShadow={false} />
      <instancedMesh ref={refs[1]} args={[screenGeo, screenMat, placed.length]} />
      <instancedMesh ref={refs[2]} args={[topperGeo, screenMat, placed.length]} />
    </group>
  );
}

/** Soft, out-of-focus lights in the haze round the room: the chandeliers and machines beyond the depth of field. */
function Bokeh({ kit, light }: { kit: Kit; light: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const r = rng(0xb0e);
    const pos: number[] = [];
    const col: number[] = [];
    const a = new THREE.Color(kit.p.bokeh);
    const b = new THREE.Color(kit.p.bokehAlt);
    const n = light ? 70 : 150;
    for (let i = 0; i < n; i++) {
      // a ring round the room, high and far, so nothing drifts over the board
      const t = r() * Math.PI * 2;
      const rad = 210 + r() * 120;
      const x = BOARD_CENTRE.x + Math.cos(t) * rad * 1.3;
      const z = BOARD_CENTRE.z - Math.abs(Math.sin(t)) * rad;
      pos.push(x, 18 + r() * 55, z);
      const c = a.clone().lerp(b, r());
      col.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [kit, light]);
  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: light ? 16 : 22,
        map: kit.bokehMap,
        vertexColors: true,
        transparent: true,
        opacity: light ? 0.35 : 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        sizeAttenuation: true,
        fog: false,
      }),
    [kit, light],
  );
  useFrame(({ clock }) => {
    if (!ref.current || reducedMotion()) return;
    mat.opacity = (light ? 0.35 : 0.55) * (0.9 + 0.1 * Math.sin(clock.elapsedTime * 0.5));
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}

/** The sign in front of the tables: the house name small, its one rule large, in gold on black lacquer. */
function HouseSign({ kit, light }: { kit: Kit; light: boolean }) {
  const W = 38;
  const H = 6.75;
  const texture = useMemo(() => {
    const made = canvas(1600, 284);
    if (!made) return null;
    const [c, g] = made;
    g.fillStyle = kit.p.signPanel;
    g.fillRect(0, 0, 1600, 284);
    g.strokeStyle = kit.p.signGold;
    g.lineWidth = 8;
    g.strokeRect(18, 18, 1564, 248);
    g.lineWidth = 2;
    g.strokeRect(34, 34, 1532, 216);
    // art deco fans in the corners
    for (const [x, y, a] of [[34, 34, 0], [1566, 34, Math.PI / 2], [1566, 250, Math.PI], [34, 250, -Math.PI / 2]] as [number, number, number][]) {
      for (let k = 1; k <= 3; k++) {
        g.beginPath();
        g.arc(x, y, 14 * k, a, a + Math.PI / 2);
        g.stroke();
      }
    }
    g.fillStyle = kit.p.signGold;
    g.textBaseline = 'middle';
    g.font = '600 34px Georgia, "Times New Roman", serif';
    spaced(g, 'SHUFLER  CASINO', 800, 78, 14);
    g.fillRect(560, 104, 480, 2);
    g.font = '700 86px Georgia, "Times New Roman", serif';
    spaced(g, 'THE HOUSE ALWAYS SHIPS', 800, 182, 6);
    return canvasTexture(c);
  }, [kit.p.signPanel, kit.p.signGold]);
  const built = useMemo(() => {
    const bins = new Bins();
    for (const sx of [-1, 1]) {
      bins.add('brass', new THREE.CylinderGeometry(0.3, 0.38, H + 1.6, 16).translate((sx * (W + 1.4)) / 2, (H + 1.6) / 2, 0));
      bins.add('brass', new THREE.SphereGeometry(0.5, 14, 10).translate((sx * (W + 1.4)) / 2, H + 2.0, 0));
    }
    const n = 72;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      let d = t * 2 * (W + H);
      let x: number, y: number;
      if (d < W) (x = -W / 2 + d), (y = H / 2 + 0.25);
      else if ((d -= W) < H) (x = W / 2 + 0.25), (y = H / 2 - d);
      else if ((d -= H) < W) (x = W / 2 - d), (y = -H / 2 - 0.25);
      else (d -= W), (x = -W / 2 - 0.25), (y = -H / 2 + d);
      bins.add('bulbs', new THREE.SphereGeometry(0.16, 8, 6).translate(x, y, 0.2));
    }
    return bins.merged();
  }, []);
  return (
    <group position={[40, FLOOR_Y, 18]}>
      <mesh geometry={built.brass} material={kit.brass} castShadow />
      <group position={[0, H / 2 + 1.0, 0]} rotation={[-0.6, 0, 0]}>
        <mesh material={kit.brass} castShadow>
          <boxGeometry args={[W + 0.9, H + 0.9, 0.3]} />
        </mesh>
        {texture && (
          <mesh position={[0, 0, 0.16]}>
            <planeGeometry args={[W, H]} />
            <meshStandardMaterial map={texture} roughness={0.45} metalness={0.1} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={light ? 0.12 : 0.55} />
          </mesh>
        )}
        <mesh geometry={built.bulbs} material={kit.glow(kit.p.bokeh, light ? 1.3 : 2.6)} />
      </group>
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
  // the key light: high and a little in front, like the lamps over the tables
  const dir = light ? new THREE.Vector3(-0.45, 0.85, 0.38) : new THREE.Vector3(0.2, 0.92, 0.32);
  const pos = dir.normalize().multiplyScalar(260).add(BOARD_CENTRE);
  return (
    <>
      <hemisphereLight args={[p.hemiSky, p.hemiGround, light ? 1.25 : 0.9]} />
      <directionalLight position={[BOARD_CENTRE.x - 30, 60, 260]} intensity={light ? 0.55 : 0.9} color={p.fillLight} />
      <directionalLight
        ref={keyRef}
        position={pos.toArray()}
        intensity={light ? 2.6 : 2.2}
        color={p.keyLight}
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

/** Night reflections without a download: warm lamp panels overhead and the glow of the machines low around. */
function NightEnvironment() {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.6}>
      <Lightformer form="rect" intensity={1.4} color="#ffcf96" scale={[50, 50, 1]} position={[0, 30, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <Lightformer form="rect" intensity={1.6} color="#ff9a5c" scale={[60, 4, 1]} position={[0, 3, 30]} />
      <Lightformer form="rect" intensity={1.0} color="#ff6f61" scale={[60, 4, 1]} position={[-30, 3, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Lightformer form="rect" intensity={0.9} color="#5ad1c9" scale={[60, 4, 1]} position={[30, 3, -10]} rotation={[0, -Math.PI / 2, 0]} />
      <Lightformer form="ring" intensity={2.0} color="#ffe2b0" scale={6} position={[10, 22, -30]} />
    </Environment>
  );
}

/** Casino backdrop: floors and the step down to the cage, walls, slot banks, bokeh, the house sign, lights. */
export function Backdrop() {
  const kit = useKit();
  const light = useResolvedTheme() === 'light';
  return (
    <>
      <Floors kit={kit} />
      <Walls kit={kit} light={light} />
      <SlotBanks kit={kit} light={light} />
      <Bokeh kit={kit} light={light} />
      <HouseSign kit={kit} light={light} />
      <Lights kit={kit} light={light} />
      {light ? (
        <Suspense fallback={null}>
          <Environment files={ASSET_BASE + 'ballroom_1k.hdr'} environmentIntensity={0.7} environmentRotation={[0, 1.2, 0]} />
        </Suspense>
      ) : (
        <NightEnvironment />
      )}
    </>
  );
}

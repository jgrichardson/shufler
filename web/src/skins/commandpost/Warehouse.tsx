import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RACK_DEPTH, RACK_LEN, SHELF_Y, reducedMotion, type DockProps, type RackProps, type WarehouseShellProps } from '../api';
import { Bins, LOWER_Y, box, chunk, lettered, monogram, post, stencilText, strut, useKit, v3, type Kit } from './kit';

/*
 * Shipped work lands at the supply depot, down on the flat past the escarpment: a concrete apron, open
 * pallet racks (one per row, a band in the row's colour along the top), a row of corrugated Quonset huts
 * behind them, floodlight masts that come on when something deployed this week, and a windsock that lifts.
 * The shipping dock is the helipad: a painted H apron with a parked utility helicopter and a raised
 * loading stage where close-outs wait in a cargo net for pickup.
 */

const signs = new Map<string, THREE.Texture | null>();
function sign(kit: Kit, top: string, bottom: string, w = 1024, h = 256): THREE.Texture | null {
  const key = `${top}|${bottom}|${kit.p.olive}|${kit.p.stencil}`;
  if (signs.has(key)) return signs.get(key)!;
  const t = lettered(w, h, (g) => {
    const bg = kit.p.olive;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = kit.p.stencil;
    g.lineWidth = 6;
    g.strokeRect(12, 12, w - 24, h - 24);
    monogram(g, h * 0.5, h * 0.5, h * 0.56, kit.p.stencil, bg);
    stencilText(g, top, w / 2 + h * 0.25, bottom ? h * 0.4 : h * 0.52, h * 0.36, kit.p.stencil, { bg, spacing: h * 0.05 });
    if (bottom) stencilText(g, bottom, w / 2 + h * 0.25, h * 0.76, h * 0.15, kit.p.stencil, { bg, spacing: h * 0.04 });
  });
  signs.set(key, t);
  return t;
}

function Sign({ map, w, h, light }: { map: THREE.Texture | null; w: number; h: number; light: boolean }) {
  const kit = useKit();
  return (
    <group>
      <mesh material={kit.oliveDark} castShadow>
        <boxGeometry args={[w + 0.3, h + 0.3, 0.2]} />
      </mesh>
      <mesh position={[0, 0, 0.11]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={map} roughness={0.7} emissive="#ffffff" emissiveMap={map} emissiveIntensity={light ? 0.04 : 0.35} />
      </mesh>
    </group>
  );
}

export function WarehouseShell({ g, deployed, ramp }: WarehouseShellProps) {
  const kit = useKit();
  const lit = deployed > 0;
  const built = useMemo(() => {
    const bins = new Bins();
    const { p } = kit;
    const x0 = g.island.cx - g.island.radius * g.island.stretch;
    const x1 = g.backX + 4;
    const z0 = g.zMin - 4;
    const z1 = g.zMax + 4;
    // the concrete apron, up from the flat to the depot floor
    const slab = g.floor - LOWER_Y;
    bins.paint('v', chunk(x1 - x0, slab, z1 - z0, 0.2).translate((x0 + x1) / 2, LOWER_Y, (z0 + z1) / 2), p.concrete);
    // painted bay lines on the apron in front of the racks
    for (let z = g.zMin; z < g.zMax; z += 6) bins.paint('v', box(g.backX - g.frontX - 6, 0.02, 0.12, g.frontX + (g.backX - g.frontX - 6) / 2, g.floor + 0.01, z), p.roadLine, kit.light ? 0.9 : 0.6);
    // Quonset huts behind the racks, end to end with gaps, their ends toward the camera
    const qx = (g.roofFromX + g.backX) / 2 + 0.5;
    const qr = Math.min(3.6, (g.backX - g.roofFromX) / 2 + 0.4);
    const span = 16;
    const n = Math.max(1, Math.round(g.length / (span + 2)));
    const step = g.length / n;
    const huts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const cz = g.zMin + (i + 0.5) * step;
      const len = step - 2;
      const q = new THREE.CylinderGeometry(qr, qr, len, 20, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
      // CylinderGeometry's u runs round the arc: the corrugation map ribs run along the hut
      huts.push(q.translate(qx, g.floor, cz));
      // end walls: half discs, the near one with a door
      for (const s of [-1, 1]) {
        const end = new THREE.CircleGeometry(qr, 20, 0, Math.PI);
        if (s < 0) end.rotateY(Math.PI);
        bins.paint('v', end.translate(qx, g.floor, cz + (s * len) / 2), p.khaki, 0.9);
      }
      bins.paint('v', box(1.6, 2.0, 0.06, qx, g.floor + 1.0, cz + len / 2 + 0.04), p.oliveDark);
      bins.paint('v', box(0.9, 0.5, 0.06, qx - 1.6, g.floor + 1.8, cz + len / 2 + 0.04), p.bezel);
    }
    // floodlight masts along the front of the racks
    const lamps: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= Math.max(2, Math.round(g.length / 24)); i++) {
      const z = g.zMin + 1 + (i * (g.length - 2)) / Math.max(2, Math.round(g.length / 24));
      bins.paint('v', post(g.frontX - 1.2, z, g.floor, g.floor + 7.5, 0.1, 6), p.steel);
      bins.paint('v', box(0.5, 0.4, 1.2, g.frontX - 1.0, g.floor + 7.6, z), p.bezel);
      lamps.push(box(0.06, 0.3, 1.0, g.frontX - 0.73, g.floor + 7.55, z));
    }
    // the windsock mast at the near end
    bins.paint('v', post(g.frontX - 1.5, g.zMax + 2.5, g.floor, g.floor + 6, 0.06, 6), p.steel);
    // the sign's posts
    for (const s of [-1, 1]) bins.paint('v', post(g.cx + s * 4.5, g.zMax + 1.4, g.floor, g.floor + 6.6, 0.12, 8), p.oliveDark);
    const lb = new Bins();
    for (const l of lamps) lb.add('l', l);
    const hb = new Bins();
    for (const h of huts) hb.add('h', h);
    return { m: bins.merged(), lamps: lb.merged().l, huts: hb.merged().h, signZ: g.zMax + 1.4 };
  }, [g, kit]);
  const road = useMemo(() => {
    const bins = new Bins();
    const [len, h, depth] = ramp.size;
    bins.add('road', box(len, Math.min(0.3, h), depth, 0, 0, 0, 0.4));
    for (const s of [-1, 1]) bins.paint('v', box(len, 0.16, 0.18, 0, 0.18, (s * depth) / 2), kit.p.concrete, kit.light ? 1.1 : 1.4);
    for (let i = 0; i < Math.round(len / 2.6); i++) bins.paint('v', box(1.2, 0.02, 0.12, -len / 2 + 1.3 + i * 2.6, Math.min(0.3, h) / 2 + 0.01, 0), kit.p.roadLine, kit.light ? 1 : 0.85);
    return bins.merged();
  }, [ramp.size, kit]);
  const sock = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const s = sock.current;
    if (!s) return;
    // the windsock lifts when something deployed this week, and hangs when not
    const want = lit ? -0.15 : -1.2;
    s.rotation.z += (want + (lit && !reducedMotion() ? Math.sin(clock.elapsedTime * 2.3) * 0.08 : 0) - s.rotation.z) * 0.05;
  });
  const signY = g.floor + 6.6;
  return (
    <group>
      <mesh geometry={built.m.v} material={kit.vcol} castShadow receiveShadow />
      <mesh geometry={built.huts} material={kit.corrugated} castShadow receiveShadow />
      <mesh geometry={built.lamps} material={lit ? kit.glow(kit.p.floodLamp, kit.light ? 1.4 : 3) : kit.bezel} />
      {lit && !kit.light && (
        <mesh position={[g.frontX + 4, g.floor + 0.04, g.cz]} rotation={[-Math.PI / 2, 0, 0]} material={kit.pool(kit.p.floodLamp, 0.2)}>
          <planeGeometry args={[14, g.length + 6]} />
        </mesh>
      )}
      <group position={ramp.position} rotation={[0, 0, ramp.rotationZ]}>
        <mesh geometry={road.road} material={kit.road} castShadow receiveShadow />
        <mesh geometry={road.v} material={kit.vcol} />
      </group>
      <group ref={sock} position={[g.frontX - 1.5, g.floor + 5.8, g.zMax + 2.5]} rotation={[0, 0.5, -1.2]}>
        <mesh position={[0.5, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={kit.painted(kit.p.stencil, 0.8)}>
          <coneGeometry args={[0.25, 1.1, 8, 1, true]} />
        </mesh>
      </group>
      <group position={[g.cx, signY, built.signZ + 0.15]} rotation={[-0.35, 0, 0]}>
        <Sign map={sign(kit, 'SUPPLY DEPOT', 'SHIPPED WORK STORED HERE')} w={9} h={2.25} light={kit.light} />
      </group>
    </group>
  );
}

/** An open pallet rack: steel uprights, timber pallet decks, a band in the row's colour along the top. */
export function Rack({ color }: RackProps) {
  const kit = useKit();
  const height = SHELF_Y[SHELF_Y.length - 1] + 1.4;
  const geo = useMemo(() => {
    const b = new Bins();
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) b.paint('v', box(0.12, height, 0.12, (i * RACK_LEN) / 3, height / 2, (side * RACK_DEPTH) / 2, 0.6), kit.p.olive);
    for (const y of SHELF_Y) {
      for (const side of [-1, 1]) b.paint('v', box(RACK_LEN + 0.2, 0.1, 0.08, RACK_LEN / 2, y - 0.04, (side * RACK_DEPTH) / 2), kit.p.steel);
      // pallet slats
      for (let k = 0; k < 12; k++) b.paint('v', box(0.6, 0.05, RACK_DEPTH - 0.1, 0.4 + k * 0.75, y + 0.02, 0), kit.p.timber);
    }
    // diagonal bracing at the ends
    for (const x of [0, RACK_LEN]) b.paint('v', strut(v3(x, 0.1, -RACK_DEPTH / 2), v3(x, height - 0.2, RACK_DEPTH / 2), 0.03, 4), kit.p.olive);
    return b.merged();
  }, [height, kit]);
  return (
    <group>
      <mesh geometry={geo.v} material={kit.vcol} castShadow receiveShadow />
      <mesh position={[RACK_LEN / 2, height, 0]} material={kit.painted(color, 0.6)} castShadow>
        <boxGeometry args={[RACK_LEN + 0.3, 0.16, RACK_DEPTH + 0.1]} />
      </mesh>
    </group>
  );
}

/** A utility helicopter: cabin, tail boom, skids, rotors. Olive, stencilled, unarmed. */
function helicopter(kit: Kit) {
  const b = new Bins();
  const { p } = kit;
  const body = new THREE.SphereGeometry(1, 18, 12).scale(2.1, 1.15, 1.05).translate(0, 1.55, 0);
  b.paint('v', body, p.olive);
  b.paint('v', new THREE.CylinderGeometry(0.22, 0.4, 3.6, 10).rotateZ(Math.PI / 2).translate(-3.4, 1.85, 0), p.olive);
  b.paint('v', box(0.9, 1.1, 0.12, -5.1, 2.3, 0), p.oliveDark);
  b.paint('v', box(0.8, 0.08, 1.2, -4.9, 1.85, 0), p.oliveDark);
  // the cabin glazing and a side door
  b.paint('v', new THREE.SphereGeometry(1, 14, 10, -Math.PI / 2.6, Math.PI / 1.3, 0.5, 1.2).scale(2.13, 1.17, 1.07).translate(0, 1.55, 0), p.bezel);
  b.paint('v', box(1.0, 0.9, 0.05, -0.4, 1.4, 1.05), p.oliveDark);
  // the rotor mast and the skids
  b.paint('v', post(0, 0, 2.6, 3.15, 0.12, 8), p.steel);
  for (const s of [-1, 1]) {
    b.paint('v', new THREE.CylinderGeometry(0.06, 0.06, 4.0, 6).rotateZ(Math.PI / 2).translate(0.1, 0.08, s * 1.05), p.steel);
    for (const x of [-0.9, 1.0]) b.paint('v', strut(v3(x, 0.08, s * 1.05), v3(x * 0.8, 0.7, s * 0.7), 0.05, 4), p.steel);
  }
  return b.merged().v;
}

const markings = new Map<string, THREE.Texture | null>();
/** The helipad's painted apron: a circle and the H, and the word CLOSE-OUTS along the edge. */
function padTexture(kit: Kit): THREE.Texture | null {
  const key = `${kit.p.concrete}|${kit.p.stencil}`;
  if (markings.has(key)) return markings.get(key)!;
  const t = lettered(512, 512, (g, w, h) => {
    const bg = kit.p.concrete;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = kit.p.stencil;
    g.lineWidth = 14;
    g.beginPath();
    g.arc(w / 2, h / 2, 200, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([26, 18]);
    g.lineWidth = 6;
    g.beginPath();
    g.arc(w / 2, h / 2, 230, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    stencilText(g, 'H', w / 2, h / 2 + 8, 250, kit.p.stencil, { bg, spacing: 0 });
  });
  markings.set(key, t);
  return t;
}

/** The helipad dock: a raised loading stage under the waiting crates (the core's belt height), the pad beside it with the helicopter. */
export function Dock({ g, bay: b }: DockProps) {
  const kit = useKit();
  const padZ = b.z + 7.2;
  const padR = 4.6;
  const padX = b.cx + 0.5;
  const geo = useMemo(() => {
    const bins = new Bins();
    // the loading stage: a timber deck on steel legs at the belt's height
    bins.paint('v', box(b.len + 0.4, 0.16, 2.4, b.cx, b.beltY - 0.1, b.z), kit.p.timber);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) bins.paint('v', post(b.x0 + 0.3 + (i * (b.len - 0.6)) / 3, b.z + s * 1.0, LOWER_Y, b.beltY - 0.15, 0.08, 6), kit.p.steel);
    // rope edging, and a cargo net rolled at the back of the stage
    for (const s of [-1, 1]) bins.paint('v', box(b.len + 0.2, 0.05, 0.05, b.cx, b.beltY + 0.35, b.z + s * 1.18), kit.p.khaki);
    for (let i = 0; i <= 5; i++) for (const s of [-1, 1]) bins.paint('v', post(b.x0 + 0.1 + (i * b.len) / 5, b.z + s * 1.18, b.beltY - 0.1, b.beltY + 0.38, 0.03, 4), kit.p.timber);
    // the pad: a low octagonal plinth up from the flat
    bins.paint('v', new THREE.CylinderGeometry(padR + 0.3, padR + 0.5, g.floor - LOWER_Y + 0.1, 8).rotateY(Math.PI / 8).translate(padX, (g.floor + LOWER_Y) / 2 + 0.05, padZ), kit.p.concrete, 0.85);
    // edge lights round the pad
    const lights: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      lights.push(new THREE.SphereGeometry(0.12, 6, 4).translate(padX + Math.cos(a) * (padR + 0.05), g.floor + 0.2, padZ + Math.sin(a) * (padR + 0.05)));
    }
    const lb = new Bins();
    for (const l of lights) lb.add('l', l);
    return { m: bins.merged(), lights: lb.merged().l, heli: helicopter(kit) };
  }, [g, b, kit, padX, padZ]);
  const tex = padTexture(kit);
  const rotor = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (reducedMotion()) return;
    // a slow idle turn: the aircraft is parked, waiting for its load
    if (rotor.current) rotor.current.rotation.y += dt * 0.6;
    if (tail.current) tail.current.rotation.z += dt * 1.6;
  });
  return (
    <group>
      <mesh geometry={geo.m.v} material={kit.vcol} castShadow receiveShadow />
      <mesh position={[padX, g.floor + 0.12, padZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[padR, 32]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      <mesh geometry={geo.lights} material={kit.glow(kit.p.runwayLight, kit.light ? 1.2 : 2.6)} />
      <group position={[padX, g.floor + 0.12, padZ]} rotation={[0, -0.5, 0]}>
        <mesh geometry={geo.heli} material={kit.vcol} castShadow />
        <group ref={rotor} position={[0, 3.2, 0]}>
          {[0, 1].map((i) => (
            <mesh key={i} rotation={[0, (i * Math.PI) / 2, 0]} material={kit.oliveDark} castShadow>
              <boxGeometry args={[8.4, 0.05, 0.3]} />
            </mesh>
          ))}
        </group>
        <group ref={tail} position={[-5.1, 2.4, 0.12]}>
          <mesh material={kit.oliveDark}>
            <boxGeometry args={[1.4, 0.12, 0.04]} />
          </mesh>
        </group>
      </group>
      <group position={[b.x0 - 0.2, b.beltY + 2.6, b.z - 1.4]} rotation={[0, Math.PI / 2, 0]}>
        <Sign map={sign(kit, 'HELIPAD', 'CLOSE-OUTS', 512, 160)} w={3.6} h={1.12} light={kit.light} />
      </group>
    </group>
  );
}

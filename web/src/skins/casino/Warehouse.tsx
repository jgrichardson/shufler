import { useMemo } from 'react';
import * as THREE from 'three';
import { Beam, RACK_DEPTH, RACK_LEN, SHELF_Y, WAREHOUSE_WALL_H, type DockProps, type RackProps, type WarehouseShellProps } from '../api';
import { Bins, box, canvas, canvasTexture, post, roundRect, spaced, useKit } from './kit';

/*
 * The warehouse is the cashier's cage, down in the hall past the end of the tables, where shipped work is
 * cashed out as stacks of chips: a marble floor, a panelled back wall, brass cage bars along the front with
 * teller windows, chip cabinets per row colour, and a polished chute from the tables down to the window.
 */

function signTexture(lines: [string, number, number][], w: number, h: number, frame = true) {
  const made = canvas(w, h);
  if (!made) return null;
  const [c, g] = made;
  g.fillStyle = '#120b09';
  g.fillRect(0, 0, w, h);
  if (frame) {
    g.strokeStyle = '#d6b86e';
    g.lineWidth = 6;
    roundRect(g, 10, 10, w - 20, h - 20, 12);
    g.stroke();
    g.lineWidth = 2;
    roundRect(g, 22, 22, w - 44, h - 44, 8);
    g.stroke();
  }
  g.fillStyle = '#f0d48c';
  g.textBaseline = 'middle';
  for (const [text, size, y] of lines) {
    g.font = `700 ${size}px Georgia, "Times New Roman", serif`;
    spaced(g, text, w / 2, y, size * 0.18);
  }
  return canvasTexture(c);
}

const CASHIER = signTexture([['CASHIER', 110, 112], ['· CHIPS CASHED HERE ·', 30, 196]], 1024, 256);

/** A sign panel with a brass frame, lit from within at night. */
function Sign({ map, w, h, light }: { map: THREE.Texture | null; w: number; h: number; light: boolean }) {
  const kit = useKit();
  return (
    <group>
      <mesh material={kit.brass} castShadow>
        <boxGeometry args={[w + 0.3, h + 0.3, 0.2]} />
      </mesh>
      <mesh position={[0, 0, 0.11]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={map} roughness={0.5} emissive="#ffffff" emissiveMap={map} emissiveIntensity={light ? 0.12 : 0.6} />
      </mesh>
    </group>
  );
}

/** Cage bars from y0 to y1 along x = const between z0 and z1, leaving gaps (teller windows, the bay). */
function bars(bins: Bins, x: number, z0: number, z1: number, y0: number, y1: number, gaps: [number, number][]) {
  for (let z = z0 + 0.2; z < z1 - 0.1; z += 0.42) {
    if (gaps.some(([a, b]) => z > a && z < b)) continue;
    bins.add('brass', post(x, z, y0, y1, 0.035, 6));
  }
  bins.add('brass', box(0.12, 0.12, z1 - z0, x, y1, (z0 + z1) / 2));
  bins.add('brass', box(0.1, 0.1, z1 - z0, x, y0 + 0.9, (z0 + z1) / 2));
}

export function WarehouseShell({ g, deployed, ramp }: WarehouseShellProps) {
  const kit = useKit();
  const H = WAREHOUSE_WALL_H;
  const built = useMemo(() => {
    const bins = new Bins();
    const x0 = g.island.cx - g.island.radius * g.island.stretch;
    const x1 = g.backX + 3;
    const z0 = g.zMin - 3;
    const z1 = g.zMax + 3;
    // marble floor slab with a brass edge
    bins.add('marble', box(x1 - x0, 0.5, z1 - z0, (x0 + x1) / 2, g.floor - 0.25, (z0 + z1) / 2, 0.15));
    bins.add('brass', box(x1 - x0 + 0.2, 0.08, 0.2, (x0 + x1) / 2, g.floor + 0.02, z1));
    // back and far walls: dark panelling with a brass cornice and a dado rail
    bins.add('wall', box(0.5, H, g.length, g.backX, g.floor + H / 2, g.cz, 0.4));
    bins.add('wall', box(g.backX - g.frontX, H, 0.5, g.cx, g.floor + H / 2, g.zMin, 0.4));
    bins.add('brass', box(0.7, 0.25, g.length + 0.5, g.backX - 0.05, g.floor + H, g.cz));
    bins.add('brass', box(g.backX - g.frontX + 0.5, 0.25, 0.7, g.cx, g.floor + H, g.zMin - 0.05));
    bins.add('brass', box(0.1, 0.1, g.length, g.backX - 0.3, g.floor + 1.2, g.cz));
    const panels = Math.max(2, Math.round(g.length / 4));
    for (let i = 0; i < panels; i++) {
      const z = g.zMin + ((i + 0.5) * g.length) / panels;
      bins.add('panel', box(0.08, H - 2.2, g.length / panels - 0.8, g.backX - 0.29, g.floor + 1.5 + (H - 2.2) / 2, z, 0.4));
    }
    // the counter and cage along the front, open at the bay and at teller windows
    const gaps: [number, number][] = [[g.cz - 2.3, g.cz + 2.3]];
    const windows = Math.max(2, Math.round(g.length / 14));
    for (let i = 0; i < windows; i++) {
      const z = g.zMin + ((i + 0.5) * g.length) / windows;
      if (Math.abs(z - g.cz) > 4) gaps.push([z - 0.9, z + 0.9]);
    }
    for (const [a, b] of [[g.zMin, g.cz - 2.3], [g.cz + 2.3, g.zMax]] as [number, number][]) {
      bins.add('woodDark', box(0.9, 1.2, b - a, g.frontX, g.floor + 0.6, (a + b) / 2, 0.5));
      bins.add('marbleTop', box(1.1, 0.1, b - a + 0.1, g.frontX, g.floor + 1.25, (a + b) / 2, 0.3));
    }
    bars(bins, g.frontX, g.zMin, g.cz - 2.3, g.floor + 1.3, g.floor + H - 0.6, gaps);
    bars(bins, g.frontX, g.cz + 2.3, g.zMax, g.floor + 1.3, g.floor + H - 0.6, gaps);
    // the near end of the cage, so the camera sees it from the front
    for (let x = g.frontX + 0.3; x < g.backX; x += 0.42) bins.add('brass', post(x, g.zMax, g.floor + 1.3, g.floor + H - 0.6, 0.035, 6));
    bins.add('woodDark', box(g.backX - g.frontX, 1.2, 0.6, g.cx, g.floor + 0.6, g.zMax, 0.5));
    bins.add('marbleTop', box(g.backX - g.frontX + 0.2, 0.1, 0.8, g.cx, g.floor + 1.25, g.zMax, 0.3));
    bins.add('brass', box(g.backX - g.frontX, 0.12, 0.12, g.cx, g.floor + H - 0.6, g.zMax));
    // the sign's posts at the near end
    for (const s of [-1, 1]) bins.add('brass', post(g.cx + s * 4.5, g.zMax + 0.6, g.floor + 1.3, g.floor + H + 0.6, 0.08, 10));
    return bins.merged();
  }, [g, H]);
  const chute = useMemo(() => {
    const bins = new Bins();
    const [len, h, depth] = ramp.size;
    bins.add('wood', box(len, Math.min(0.25, h), depth, 0, 0, 0, 0.4));
    bins.add('felt', box(len, 0.02, depth - 0.6, 0, Math.min(0.25, h) / 2 + 0.01, 0));
    for (const s of [-1, 1]) bins.add('brass', box(len, 0.25, 0.12, 0, 0.2, (s * depth) / 2));
    return bins.merged();
  }, [ramp.size]);
  const signY = g.floor + H + 1.6;
  return (
    <group>
      <mesh geometry={built.marble} material={kit.marble} receiveShadow />
      <mesh geometry={built.wall} material={kit.woodDark} castShadow receiveShadow />
      <mesh geometry={built.panel} material={kit.wood} receiveShadow />
      <mesh geometry={built.brass} material={kit.brass} castShadow />
      <mesh geometry={built.woodDark} material={kit.woodDark} castShadow receiveShadow />
      <mesh geometry={built.marbleTop} material={kit.marble} castShadow receiveShadow />
      <group position={ramp.position} rotation={[0, 0, ramp.rotationZ]}>
        <mesh geometry={chute.wood} material={kit.wood} castShadow receiveShadow />
        <mesh geometry={chute.felt} material={kit.felt} receiveShadow />
        <mesh geometry={chute.brass} material={kit.brass} castShadow />
      </group>
      <group position={[g.cx, signY, g.zMax + 0.75]} rotation={[-0.35, 0, 0]}>
        <Sign map={CASHIER} w={9} h={2.25} light={kit.light} />
      </group>
      {/* warm light along the inside of the back wall */}
      <mesh position={[g.backX - 0.32, g.floor + H - 0.5, g.cz]} material={kit.glow(kit.p.bokeh, kit.light ? 1.0 : 1.8)}>
        <boxGeometry args={[0.06, 0.14, g.length - 1]} />
      </mesh>
      {deployed > 0 && (
        <group position={[g.cx, signY + 1.4, g.zMax + 0.75]}>
          <Beam color={kit.p.deployBeam} height={110} radius={0.6} intensity={0.5} />
        </group>
      )}
    </group>
  );
}

/** A chip cabinet: walnut uprights, felt-lined shelves, a leather top rail in the row's colour. */
export function Rack({ color }: RackProps) {
  const kit = useKit();
  const height = SHELF_Y[SHELF_Y.length - 1] + 1.3;
  const geo = useMemo(() => {
    const b = new Bins();
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) b.add('wood', box(0.14, height, 0.14, (i * RACK_LEN) / 3, height / 2, (side * RACK_DEPTH) / 2, 0.6));
    for (const y of SHELF_Y) {
      b.add('wood', box(RACK_LEN + 0.2, 0.1, RACK_DEPTH + 0.1, RACK_LEN / 2, y - 0.02, 0, 0.6));
      b.add('felt', box(RACK_LEN, 0.02, RACK_DEPTH - 0.1, RACK_LEN / 2, y + 0.04, 0));
      b.add('brass', box(RACK_LEN + 0.2, 0.05, 0.05, RACK_LEN / 2, y + 0.03, RACK_DEPTH / 2 + 0.06));
    }
    return b.merged();
  }, [height]);
  return (
    <group>
      <mesh geometry={geo.wood} material={kit.woodDark} castShadow receiveShadow />
      <mesh geometry={geo.felt} material={kit.felt} receiveShadow />
      <mesh geometry={geo.brass} material={kit.brass} />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[RACK_LEN / 2, height, (s * RACK_DEPTH) / 2]} rotation={[0, 0, Math.PI / 2]} material={kit.leather(color)} castShadow>
          <cylinderGeometry args={[0.13, 0.13, RACK_LEN + 0.3, 10]} />
        </mesh>
      ))}
    </group>
  );
}

const PAY = signTexture([['PAY WINDOW', 60, 64]], 512, 128, false);

/** The pay window: a felt-lined chute on brass legs into an arched window in the cage. */
export function Dock({ g, bay: b }: DockProps) {
  const kit = useKit();
  const geo = useMemo(() => {
    const bins = new Bins();
    bins.add('wood', box(b.len + 0.6, 0.5, 6, b.cx, g.floor + 0.05, b.z, 0.5));
    bins.add('woodDark', box(b.len, 0.16, 2.3, b.cx, b.beltY - 0.12, b.z, 0.5));
    bins.add('felt', box(b.len, 0.02, 2.0, b.cx, b.beltY - 0.03, b.z));
    for (const side of [-1, 1]) bins.add('brass', box(b.len, 0.18, 0.08, b.cx, b.beltY + 0.0, b.z + side * 1.12));
    for (let i = 0; i < 4; i++) bins.add('brass', post(b.x0 + 0.4 + (i * (b.len - 0.8)) / 3, b.z, g.floor + 0.3, b.beltY - 0.2, 0.08, 8));
    // the window: brass piers and an arch, with a sign above
    for (const s of [-1, 1]) bins.add('brass', box(0.4, 4.0, 0.4, g.frontX, g.floor + 2.0, b.z + s * 2.1, 0.6));
    bins.add('brass', new THREE.TorusGeometry(2.1, 0.16, 8, 24, Math.PI).rotateY(Math.PI / 2).translate(g.frontX, g.floor + 4.0, b.z));
    return bins.merged();
  }, [g, b]);
  return (
    <group>
      <mesh geometry={geo.wood} material={kit.wood} castShadow receiveShadow />
      <mesh geometry={geo.woodDark} material={kit.woodDark} castShadow />
      <mesh geometry={geo.felt} material={kit.felt} receiveShadow />
      <mesh geometry={geo.brass} material={kit.brass} castShadow />
      <group position={[g.frontX - 0.25, g.floor + 6.6, b.z]} rotation={[0, -Math.PI / 2, 0]}>
        <Sign map={PAY} w={3.6} h={0.9} light={kit.light} />
      </group>
    </group>
  );
}

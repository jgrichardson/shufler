import { useMemo } from 'react';
import * as THREE from 'three';
import type { DistrictBandProps, LaneProps, RampProps } from '../api';
import { chipEdgeTexture, chipTopTexture } from './cards';
import { Bins, FLOOR_Y, box, canvas, canvasTexture, flatShape, post, roundedRect, useKit, type Kit } from './kit';

/*
 * The board as card tables: each row is a long green-felt table on a wooden apron, with a padded leather
 * rail in the row's colour and rounded ends. The felt is brighter in the middle of each column, as if a
 * lamp hung over every seat. Thin gold lines printed on the felt divide the columns and run a betting line
 * along the front. Each column's station is a small brass stand behind the back table carrying a stack of
 * chips in the phase colour and the dealer button.
 */

/** Lane-local height of the gaming floor (lanes sit at SKY_Y = 5.5). */
const FLOOR = FLOOR_Y - 5.5;
/** Half depth of the felt across the row. */
export const FH = 1.85;
const FELT_Y = -0.03;
const RAIL_R = 0.23;
const RAIL_Z = FH + 0.2;
const RAIL_Y = 0.06;
const APRON_H = 0.5;

/** The felt's warm pools of light: brighter in each column's middle and toward the table's centre line. */
function feltGeometry(kit: Kit, x0: number, x1: number, centres: number[]) {
  const len = x1 - x0;
  const segX = Math.max(8, Math.round(len / 0.9));
  const g = new THREE.PlaneGeometry(len, FH * 2, segX, 8);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, FELT_Y, 0);
  // felt texture coordinates in metres so the nap keeps its scale on any length
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const felt = new THREE.Color(kit.p.felt);
  const c = new THREE.Color();
  const [base, amp, edge] = kit.light ? [0.86, 0.2, 0.12] : [0.5, 0.62, 0.3];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    uv.setXY(i, x * 0.12, z * 0.12);
    let near = Infinity;
    for (const s of centres) near = Math.min(near, Math.abs(x - s));
    const pool = Math.exp(-((near / 5.2) ** 2));
    const across = 1 - edge * (z / FH) ** 2;
    c.copy(felt).multiplyScalar((base + amp * pool) * across);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A semicircular rail end, the felt cap and the apron under it, on the +x side (mirrored for -x). */
function endParts(bins: Bins, x: number, side: 1 | -1) {
  // turned, not mirrored, for the -x end so faces keep their winding
  const turn = side > 0 ? 0 : Math.PI;
  const rail = new THREE.TorusGeometry(RAIL_Z, RAIL_R, 10, 24, Math.PI).rotateZ(-Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.75, 1).rotateY(turn);
  bins.add('rail', rail.translate(x, RAIL_Y, 0));
  const cap = new THREE.CircleGeometry(FH + 0.02, 24, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).rotateY(turn);
  bins.add('feltCap', cap.translate(x, FELT_Y, 0));
  bins.add('apron', new THREE.CylinderGeometry(RAIL_Z + 0.1, RAIL_Z + 0.1, APRON_H, 24, 1, false, side > 0 ? 0 : Math.PI, Math.PI).translate(x, FELT_Y - APRON_H / 2 - 0.05, 0));
  bins.add('base', new THREE.CylinderGeometry(FH - 0.4, FH - 0.25, -FLOOR - APRON_H - 0.1, 20, 1, false, side > 0 ? 0 : Math.PI, Math.PI).translate(x, (FLOOR + FELT_Y - APRON_H) / 2, 0));
}

export function Lane({ x0, x1, color, supports }: LaneProps) {
  const kit = useKit();
  const built = useMemo(() => {
    const xs = [...supports].sort((a, b) => a - b);
    const len = x1 - x0;
    const mid = (x0 + x1) / 2;
    const bins = new Bins();
    // apron under the felt, and the dark cabinet down to the floor with a brass kick strip
    bins.add('apron', box(len, APRON_H, (RAIL_Z + 0.1) * 2, mid, FELT_Y - APRON_H / 2 - 0.05, 0, 0.5));
    const baseH = -FLOOR - APRON_H - 0.1;
    bins.add('base', box(len, baseH, (FH - 0.3) * 2, mid, FLOOR + baseH / 2, 0, 0.4));
    bins.add('brass', box(len, 0.12, (FH - 0.25) * 2, mid, FLOOR + 0.06, 0));
    // padded rails along both long sides
    for (const s of [-1, 1]) {
      const r = new THREE.CylinderGeometry(RAIL_R, RAIL_R, len, 12, 1).rotateZ(Math.PI / 2).scale(1, 0.75, 1);
      bins.add('rail', r.translate(mid, RAIL_Y, s * RAIL_Z));
      // a brass bead where the rail meets the apron
      bins.add('brass', box(len, 0.05, 0.05, mid, FELT_Y - 0.08, s * (RAIL_Z + 0.27)));
    }
    endParts(bins, x1, 1);
    endParts(bins, x0, -1);
    // printed gold lines: column dividers and a double betting line along the front
    for (let i = 1; i < xs.length; i++) bins.add('print', box(0.05, 0.006, FH * 2 - 0.5, (xs[i - 1] + xs[i]) / 2, FELT_Y + 0.004, 0));
    for (const dz of [FH - 0.32, FH - 0.42]) bins.add('print', box(len - 0.6, 0.006, 0.03, mid, FELT_Y + 0.004, dz));
    return { g: bins.merged(), felt: feltGeometry(kit, x0, x1, xs) };
  }, [x0, x1, supports, kit]);
  const feltCap = useMemo(() => {
    const m = kit.felt.clone();
    m.color.multiplyScalar(kit.light ? 0.9 : 0.6);
    return m;
  }, [kit]);
  return (
    <group>
      <mesh geometry={built.felt} material={kit.feltPool} receiveShadow />
      <mesh geometry={built.g.feltCap} material={feltCap} receiveShadow />
      <mesh geometry={built.g.rail} material={kit.leather(color)} castShadow receiveShadow />
      <mesh geometry={built.g.apron} material={kit.wood} castShadow receiveShadow />
      <mesh geometry={built.g.base} material={kit.woodDark} receiveShadow />
      <mesh geometry={built.g.brass} material={kit.brass} />
      {built.g.print && <mesh geometry={built.g.print} material={kit.feltPrint} />}
    </group>
  );
}

/**
 * The gangway from the row's dais up to its table: a wooden walk with a runner in the row's colour and
 * brass handrails.
 */
export function Ramp({ length, color }: RampProps) {
  const kit = useKit();
  const geo = useMemo(() => {
    const bins = new Bins();
    bins.add('wood', box(length, 0.22, 1.9, 0, 0, 0, 0.5));
    bins.add('runner', box(length, 0.03, 1.2, 0, 0.125, 0));
    const n = Math.max(2, Math.round(length / 1.8));
    for (const s of [-1, 1]) {
      for (let i = 0; i <= n; i++) bins.add('brass', post(-length / 2 + 0.2 + (i * (length - 0.4)) / n, s * 0.88, 0.1, 0.75, 0.03, 6));
      bins.add('brass', new THREE.CylinderGeometry(0.045, 0.045, length - 0.3, 8).rotateZ(Math.PI / 2).translate(0, 0.78, s * 0.88));
    }
    return bins.merged();
  }, [length]);
  return (
    <group>
      <mesh geometry={geo.wood} material={kit.wood} castShadow receiveShadow />
      <mesh geometry={geo.runner} material={kit.leather(color)} receiveShadow />
      <mesh geometry={geo.brass} material={kit.brass} castShadow />
    </group>
  );
}

/* ---------- column stations ---------- */

const DEALER_TEX = (() => {
  const made = canvas(256, 256);
  if (!made) return null;
  const [c, g] = made;
  g.fillStyle = '#f8f3e6';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#1b1a20';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#1b1a20';
  g.font = '700 44px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('DEALER', 128, 132);
  return canvasTexture(c);
})();
const dealerTop = new THREE.MeshStandardMaterial({ map: DEALER_TEX, roughness: 0.4 });
const dealerSide = new THREE.MeshStandardMaterial({ color: '#efe8d8', roughness: 0.5 });

const STAND_TOP = -0.2;
const standGeo = new THREE.CylinderGeometry(0.75, 0.95, STAND_TOP - FLOOR, 24).translate(0, (STAND_TOP + FLOOR) / 2, 0);
const standCapGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.12, 28).translate(0, STAND_TOP + 0.06, 0);
const standRingGeo = new THREE.TorusGeometry(1.0, 0.05, 6, 32).rotateX(Math.PI / 2).translate(0, STAND_TOP + 0.12, 0);
const chipStack = (n: number, x: number, z: number) => ({ n, geo: new THREE.CylinderGeometry(0.34, 0.34, n * 0.085, 24).translate(x, STAND_TOP + 0.12 + (n * 0.085) / 2, z) });
const stacks = [chipStack(6, -0.3, -0.1), chipStack(4, 0.36, -0.25), chipStack(2, 0.05, 0.42)];
const buttonGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 24).translate(0.55, STAND_TOP + 0.17, 0.4);

const stationMats = new Map<string, THREE.Material[]>();
/** Side, top and bottom materials for a stack of n chips in the phase colour. */
export function accentChips(accent: string, n: number): THREE.Material[] {
  const key = `${accent}|${n}`;
  let m = stationMats.get(key);
  if (!m) {
    const top = new THREE.MeshStandardMaterial({ map: chipTopTexture(accent), roughness: 0.4 });
    const edge = chipEdgeTexture(accent)?.clone() ?? null;
    if (edge) {
      edge.wrapS = edge.wrapT = THREE.RepeatWrapping;
      edge.repeat.set(1, n);
      edge.needsUpdate = true;
    }
    m = [new THREE.MeshStandardMaterial({ map: edge, roughness: 0.45 }), top, top];
    stationMats.set(key, m);
  }
  return m;
}

/** A gold inlay in the floor at the column's edge, and the column's station behind the back table. */
export function DistrictBand({ accent, depth, edgeX, active }: DistrictBandProps) {
  const kit = useKit();
  const inlay = useMemo(() => box(0.14, 0.02, depth, edgeX, FLOOR + 0.012, 0), [depth, edgeX]);
  const back = -depth / 2 + 0.5;
  const lip = useMemo(() => flatShape(roundedRect(1.8, 1.8, 0.9), 1.8, 1.8).translate(0, STAND_TOP + 0.125, 0), []);
  return (
    <group>
      <mesh geometry={inlay} material={kit.feltPrint} receiveShadow />
      <group position={[0, 0, back]}>
        <mesh geometry={standGeo} material={kit.woodDark} castShadow receiveShadow />
        <mesh geometry={standCapGeo} material={kit.wood} castShadow receiveShadow />
        <mesh geometry={standRingGeo} material={kit.glow(accent, active ? 3 : kit.light ? 1.2 : 1.8)} />
        <mesh geometry={lip} material={kit.felt} />
        {stacks.map((st, i) => (
          <mesh key={i} geometry={st.geo} material={accentChips(accent, st.n)} castShadow />
        ))}
        <mesh geometry={buttonGeo} material={[dealerSide, dealerTop, dealerSide]} castShadow />
      </group>
    </group>
  );
}

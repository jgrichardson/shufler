import { useMemo } from 'react';
import * as THREE from 'three';
import { rng, type IslandProps, type PlatformProps } from '../api';
import { Bins, bare, box, mergeGeometries, paint, post, useKit } from './kit';
import { PARK } from './palette';

/* ---------- trees ---------- */

/** A rounded park tree: trunk under two or three soft foliage clumps, darker underneath (vertex coloured). */
function treeGeometry(seed: number, tall = false): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunkH = tall ? 1.1 : 0.55;
  parts.push(paint(new THREE.CylinderGeometry(0.06, 0.1, trunkH, 6).translate(0, trunkH / 2, 0), PARK.trunk));
  const dark = new THREE.Color('#2f5a2c');
  const lit = new THREE.Color('#79a24a');
  const blobs = tall ? 3 : 2 + Math.floor(r() * 2);
  for (let b = 0; b < blobs; b++) {
    const rad = (tall ? 0.36 : 0.42) + r() * 0.12;
    const g = new THREE.IcosahedronGeometry(rad, 2);
    const y = trunkH + 0.2 + b * (tall ? 0.42 : 0.18);
    const ox = b === 0 ? 0 : (r() - 0.5) * 0.4;
    const oz = b === 0 ? 0 : (r() - 0.5) * 0.4;
    g.scale(1, tall ? 1.15 : 0.9, 1).translate(ox, y, oz);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const up = Math.max(0, n.getY(i)) * 0.7 + 0.3 * Math.max(0, -n.getX(i));
      c.copy(dark).lerp(lit, up * 0.85);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts);
}

export const TREE_GEOS = [treeGeometry(3), treeGeometry(17), treeGeometry(29, true)];

/** A cast-iron lamp post with a warm globe; returns [post, globe] geometries. */
function lampPost(x: number, z: number, h = 1.6): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const p = mergeGeometries([post(x, z, 0, h, 0.04, 6), new THREE.CylinderGeometry(0.1, 0.12, 0.12, 8).translate(x, 0.06, z)]);
  const globe = bare(new THREE.SphereGeometry(0.13, 10, 8).translate(x, h + 0.1, z));
  return [p, globe];
}

/* ---------- platforms ---------- */

/** A disc with its cap UVs repeating with size, so the paving keeps its scale on any radius. */
function pavedDisc(r: number, h: number) {
  const g = new THREE.CylinderGeometry(r, r, h, 48, 1);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) if (Math.abs(Math.abs(pos.getY(i)) - h / 2) < 1e-4) uv.setXY(i, pos.getX(i) * 0.3, pos.getZ(i) * 0.3);
  return g.translate(0, -h / 2, 0);
}

/**
 * A raised plaza: herringbone paving on a stucco terrace whose wall drops to the park floor, a curb ring, and
 * a painted band in the domain colour under the lip.
 */
export function Platform({ radius, rim, stretch = 1, detail, children }: PlatformProps) {
  const kit = useKit();
  const geo = useMemo(
    () => ({
      top: pavedDisc(1, 0.3),
      curb: new THREE.TorusGeometry(1, 0.035, 6, 64).rotateX(Math.PI / 2),
      wall: new THREE.CylinderGeometry(1.02, 1.06, 14, 48, 1, true).translate(0, -7.2, 0),
      band: new THREE.CylinderGeometry(1.025, 1.025, 0.16, 48, 1, true).translate(0, -0.42, 0),
    }),
    [],
  );
  return (
    <group>
      <group scale={[radius * stretch, 1, radius]}>
        <mesh geometry={geo.top} material={kit.paving} receiveShadow castShadow />
        <mesh geometry={geo.wall} material={kit.stucco} receiveShadow />
        {rim && <mesh geometry={geo.band} material={kit.painted(rim, 0.5)} />}
      </group>
      <mesh geometry={geo.curb} material={kit.curb} position={[0, 0.01, 0]} scale={[radius * stretch - 0.05, 1, radius - 0.05]} visible={!!detail || radius > 2} />
      {children}
    </group>
  );
}

/* ---------- row islands: a themed land ---------- */

/** The land's entrance arch over the start of its lift hill: two pillars and a hoop in the land's colour, ringed with bulbs. */
function entranceArch(bins: Bins, x: number, span: number, h: number) {
  const z = span / 2;
  for (const s of [-1, 1]) {
    bins.add('stucco', box(0.34, h, 0.34, x, h / 2, s * z, 0.8));
    bins.add('trim', box(0.46, 0.14, 0.46, x, h + 0.07, s * z));
    bins.add('trim', box(0.46, 0.18, 0.46, x, 0.09, s * z));
    bins.add('gold', new THREE.SphereGeometry(0.11, 10, 8).translate(x, h + 0.25, s * z));
  }
  // the hoop: a half torus in the land colour across the top, rising over the track
  const hoopR = z;
  const hoop = new THREE.TorusGeometry(hoopR, 0.14, 8, 28, Math.PI).rotateY(Math.PI / 2).scale(1, 0.55, 1).translate(x, h, 0);
  bins.add('land', hoop);
  // marquee bulbs along the hoop
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    bins.add('bulbs', bare(new THREE.SphereGeometry(0.06, 6, 4).translate(x + 0.16, h + Math.sin(a) * hoopR * 0.55, Math.cos(a) * hoopR)));
  }
  // a pennant pole at the crown
  bins.add('trim', post(x, 0, h + hoopR * 0.55, h + hoopR * 0.55 + 0.7, 0.025, 5));
  const flag = new THREE.BufferGeometry();
  const fy = h + hoopR * 0.55 + 0.68;
  flag.setAttribute('position', new THREE.Float32BufferAttribute([x, fy, 0, x, fy - 0.26, 0, x, fy - 0.13, 0.42], 3));
  flag.computeVertexNormals();
  bins.add('flag', flag);
}

/**
 * A row's land: a paved plaza with a band in the land's colour, a few trees and lamp posts, and an entrance
 * arch where the lift hill leaves for the track.
 */
export function Island({ island, buildingLocal, detail }: IslandProps) {
  const kit = useKit();
  const R = island.radius * 1.22;
  const built = useMemo(() => {
    const bins = new Bins();
    const archX = island.radius * island.stretch * 0.86;
    const span = Math.min(2.6, R * 0.95);
    entranceArch(bins, archX, span, 1.9);
    // trees and lamps round the rim, clear of the sessions, the parked-item shoulder and the arch
    const r = rng(island.seed);
    const keep: [number, number, number][] = buildingLocal.map(([x, z]) => [x, z, 1.6]);
    keep.push([island.radius * 0.55, 0, 1.5], [archX, 0, 1.6]);
    const trees: { x: number; z: number; s: number; k: number }[] = [];
    const want = Math.round(2 + R * 0.8);
    for (let guard = 0; trees.length < want && guard < 80; guard++) {
      const a = r() * Math.PI * 2;
      const d = 0.72 + r() * 0.18;
      const x = Math.cos(a) * R * island.stretch * d;
      const z = Math.sin(a) * R * d;
      if (keep.some(([kx, kz, kr]) => (kx - x) ** 2 + (kz - z) ** 2 < kr * kr)) continue;
      if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 0.8)) continue;
      trees.push({ x, z, s: 0.5 + r() * 0.2, k: Math.floor(r() * TREE_GEOS.length) });
    }
    trees.forEach((t, i) => {
      if (i % 3 === 2) {
        const [p, g] = lampPost(t.x, t.z);
        bins.add('lamp', p);
        bins.add('globe', g);
      } else {
        const g = TREE_GEOS[t.k].clone().scale(t.s, t.s, t.s).translate(t.x, 0, t.z);
        bins.add('tree', g);
      }
    });
    return bins.merged();
  }, [island.radius, island.stretch, island.seed, R, buildingLocal]);
  const bulbs = kit.glow(kit.p.bulb, kit.light ? 1.1 : 2.6);
  return (
    <Platform radius={R} seed={island.seed} rim={island.color} stretch={island.stretch} detail={detail}>
      <mesh geometry={built.stucco} material={kit.stucco} castShadow />
      <mesh geometry={built.trim} material={kit.trim} castShadow />
      <mesh geometry={built.gold} material={kit.gold} />
      <mesh geometry={built.land} material={kit.painted(island.color, 0.35)} castShadow />
      <mesh geometry={built.bulbs} material={bulbs} />
      <mesh geometry={built.flag} material={kit.painted(island.color, 0.6)} />
      {built.tree && <mesh geometry={built.tree} material={kit.vcol} castShadow />}
      {built.lamp && <mesh geometry={built.lamp} material={kit.steelDark} />}
      {built.globe && <mesh geometry={built.globe} material={bulbs} />}
    </Platform>
  );
}

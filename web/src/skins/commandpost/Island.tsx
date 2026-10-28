import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import type { IslandProps, PlatformProps } from '../api';
import { Bins, GROUND_Y, MAP_TILE, box, chunk, lettered, post, roundedRect, stencilText, stencilWidth, useKit, type Kit } from './kit';

/*
 * Each row is a compound: a raised sandstone plateau on the map, its top printed with the same grid and
 * contours, a kerb painted in the row's colour, jersey barriers along the back, rope posts at the sides, a
 * camo net over one back corner, a stencilled row plate at the front and a timber loading stage on the east
 * shoulder where parked work waits. At night a sodium floodlight pools on each compound.
 */

/** Plateau strata, bottom to top, as fractions of the palette's terrain colours. */
function strataColour(kit: Kit, t: number): THREE.Color {
  const a = new THREE.Color(kit.p.terrainAlt);
  const k = new THREE.Color(kit.p.khaki);
  const band = Math.min(2, Math.floor(t * 3));
  const c = band === 1 ? k.clone().lerp(a, 0.35) : a.clone().lerp(k, band === 2 ? 0.2 : 0.05);
  return c.multiplyScalar(kit.light ? 0.92 : 1.15 + band * 0.08);
}

/**
 * A plateau of half-width hw (x) and half-depth hd (z), top at y = 0 and dropping `drop`, with three
 * strata bands on its sides (vertex colours) and the map on its top (UVs in world units).
 */
function plateau(kit: Kit, hw: number, hd: number, drop: number) {
  const r = Math.min(hw, hd) * 0.38;
  const shape = roundedRect(hw * 2, hd * 2, r);
  const g = new THREE.ExtrudeGeometry(shape, { depth: drop, steps: 3, bevelEnabled: false, curveSegments: 5 });
  // extrude runs along +z; stand it up so the top is at y = 0 and the shape's y runs along -z
  g.rotateX(Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const c = strataColour(kit, 1 + y / drop);
    col.set([c.r, c.g, c.b], i * 3);
    uv.setXY(i, pos.getX(i) / MAP_TILE, -pos.getZ(i) / MAP_TILE);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return { g, shape, r };
}

/** The kerb stripe in the row colour: a thin band just outside the plateau's top edge. */
function kerb(hw: number, hd: number, r: number) {
  const k = 0.06;
  const g = new THREE.ExtrudeGeometry(roundedRect((hw + k) * 2, (hd + k) * 2, r + k), { depth: 0.16, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(Math.PI / 2);
  return g.translate(0, -0.035, 0);
}

/** A compound plateau. The top is at y = 0; the sides fall to the map (or `drop`). */
export function Compound({ hw, hd, drop, rim, children }: { hw: number; hd: number; drop: number; rim?: string; children?: ReactNode }) {
  const kit = useKit();
  const geo = useMemo(() => {
    const p = plateau(kit, hw, hd, drop);
    return { body: p.g, kerb: rim ? kerb(hw, hd, p.r) : null };
  }, [kit, hw, hd, drop, rim]);
  const mats = useMemo(() => [kit.mapTop, kit.vcol], [kit]);
  return (
    <group>
      <mesh geometry={geo.body} material={mats} receiveShadow castShadow />
      {geo.kerb && rim && <mesh geometry={geo.kerb} material={kit.painted(rim, 0.55)} />}
      {children}
    </group>
  );
}

/** A floating base for anything that stands on one: a plateau down to the map. */
export function Platform({ radius, rim, stretch = 1, detail, children }: PlatformProps) {
  const kit = useKit();
  const hw = radius * stretch;
  const hd = radius;
  // big islands get rope posts round the rim when close enough to see them
  const posts = useMemo(() => {
    if (!detail || radius < 6) return null;
    const bins = new Bins();
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * (hw - 0.7);
      const z = Math.sin(a) * (hd - 0.7);
      // keep the front open for the name tag and the loop
      if (z > hd * 0.55) continue;
      bins.paint('p', post(x, z, 0, 0.9, 0.08, 6), kit.p.timber);
      bins.paint('p', new THREE.SphereGeometry(0.11, 6, 4).translate(x, 0.92, z), kit.p.stencil);
    }
    return bins.merged().p ?? null;
  }, [detail, radius, hw, hd, kit]);
  return (
    <Compound hw={hw} hd={hd} drop={0.7} rim={rim}>
      {posts && <mesh geometry={posts} material={kit.vcol} castShadow />}
      {children}
    </Compound>
  );
}

const plates = new Map<string, THREE.Texture | null>();
/** The row plate: the row's code in stencil on an olive board, edged in the row's colour. */
function plate(kit: Kit, code: string, color: string): THREE.Texture | null {
  const key = `${code}|${color}|${kit.p.olive}|${kit.p.stencil}`;
  if (plates.has(key)) return plates.get(key)!;
  const t = lettered(256, 160, (g, w, h) => {
    const bg = kit.p.olive;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.fillRect(0, 0, w, 18);
    g.fillRect(0, h - 10, w, 10);
    g.strokeStyle = kit.p.stencil;
    g.lineWidth = 3;
    g.strokeRect(10, 26, w - 20, h - 46);
    const size = Math.min(84, (84 * 196) / Math.max(1, stencilWidth(g, code, 84, 8)));
    stencilText(g, code, w / 2, 88, size, kit.p.stencil, { bg, spacing: 8 });
  });
  plates.set(key, t);
  return t;
}

/** A sagging camo net on four poles, over the back corner. */
function netGeometry(w: number, d: number, h: number) {
  const g = new THREE.PlaneGeometry(w, d, 6, 6).rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2);
    const z = pos.getZ(i) / (d / 2);
    const sag = (1 - x * x) * (1 - z * z) * 0.35 + Math.sin(x * 5 + z * 3) * 0.04;
    pos.setY(i, h - sag);
  }
  g.computeVertexNormals();
  return g;
}

export function Island({ island, buildingLocal, detail }: IslandProps) {
  const kit = useKit();
  const R = island.radius * 1.12;
  const hw = R * island.stretch;
  const hd = R;
  const drop = Math.max(0.3, island.top - GROUND_Y);
  const clear = (x: number, z: number, r: number) => !buildingLocal.some(([bx, bz]) => (bx * island.stretch - x) ** 2 + (bz - z) ** 2 < r * r);
  const built = useMemo(() => {
    const bins = new Bins();
    const { p } = kit;
    // jersey barriers along the back edge
    const nb = Math.max(2, Math.round((hw * 1.3) / 0.9));
    for (let i = 0; i < nb; i++) {
      const x = -hw * 0.62 + (i * hw * 1.24) / Math.max(1, nb - 1);
      const z = -hd + 0.32;
      if (!clear(x, z, 0.9)) continue;
      const b = new THREE.CylinderGeometry(0.1, 0.24, 0.42, 4, 1).rotateY(Math.PI / 4).scale(3.2, 1, 1).translate(x, 0.21, z);
      bins.paint('v', b, p.concrete, kit.light ? 1.05 : 1.25);
    }
    // rope posts down both sides, with the rope between
    for (const s of [-1, 1]) {
      const x = s * (hw - 0.28);
      const zs = [-hd * 0.45, 0, hd * 0.45];
      for (const z of zs) {
        if (!clear(x, z, 0.6)) continue;
        bins.paint('v', post(x, z, 0, 0.55, 0.045, 5), p.timber);
      }
      bins.paint('v', box(0.03, 0.03, hd * 0.9, x, 0.48, 0), p.khaki);
    }
    // the loading stage on the east shoulder, where the core parks waiting work (0.9 above the top):
    // a slatted timber deck on four posts
    const lx = island.radius * 0.55;
    const ld = Math.min(1.5, hd * 0.8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bins.paint('v', post(lx + sx * 0.36, sz * (ld / 2 - 0.08), 0, 0.84, 0.05, 5), p.timber);
    for (let i = 0; i < 4; i++) bins.paint('v', box(0.86, 0.05, ld / 4 - 0.04, lx, 0.86, -ld / 2 + (i + 0.5) * (ld / 4)), p.timber, 1.1);
    // supply crates stacked by the barriers
    if (clear(-hw * 0.55, -hd * 0.35, 0.8)) {
      bins.paint('v', chunk(0.5, 0.42, 0.5, 0.04).translate(-hw * 0.55, 0, -hd * 0.35), p.olive);
      bins.paint('v', chunk(0.42, 0.36, 0.42, 0.04).translate(-hw * 0.55 + 0.05, 0.42, -hd * 0.35 + 0.02), p.oliveDark);
    }
    // the camo net's poles over the back-left corner
    const nx = -hw * 0.55;
    const nz = -hd * 0.55;
    const nw = Math.min(1.2, hw * 0.5);
    const nd = Math.min(1.0, hd * 0.45);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bins.paint('v', post(nx + (sx * nw) / 2, nz + (sz * nd) / 2, 0, 1.0, 0.03, 5), p.timber);
    // the plate's easel, front-left
    const ex = -hw * 0.55;
    const ez = hd * 0.72;
    for (const s of [-1, 1]) bins.paint('v', post(ex + s * 0.26, ez, 0, 0.42, 0.03, 5), p.oliveDark);
    return { m: bins.merged(), net: { x: nx, z: nz, g: netGeometry(nw + 0.2, nd + 0.2, 1.0) }, easel: [ex, ez] as [number, number] };
  }, [kit, hw, hd, island.radius, buildingLocal]);
  const map = plate(kit, island.code, island.color);
  return (
    <Compound hw={hw} hd={hd} drop={drop} rim={island.color}>
      <mesh geometry={built.m.v} material={kit.vcol} castShadow receiveShadow />
      {detail && <mesh geometry={built.net.g} position={[built.net.x, 0, built.net.z]} material={kit.netting} castShadow />}
      <group position={[built.easel[0], 0.44, built.easel[1] + 0.02]} rotation={[-0.6, 0, 0]}>
        <mesh material={kit.bezel}>
          <boxGeometry args={[0.8, 0.52, 0.04]} />
        </mesh>
        <mesh position={[0, 0, 0.025]}>
          <planeGeometry args={[0.74, 0.46]} />
          <meshStandardMaterial map={map} roughness={0.7} emissive="#ffffff" emissiveMap={map} emissiveIntensity={kit.light ? 0.03 : 0.25} />
        </mesh>
      </group>
      {!kit.light && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={kit.pool(kit.p.floodLamp, 0.16)}>
          <planeGeometry args={[hw * 2.2, hd * 2.2]} />
        </mesh>
      )}
    </Compound>
  );
}

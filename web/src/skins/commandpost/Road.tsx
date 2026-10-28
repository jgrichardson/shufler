import { useMemo } from 'react';
import * as THREE from 'three';
import type { DistrictBandProps, LaneProps, RampProps } from '../api';
import { Bins, GROUND_Y, box, lettered, post, stencilText, useKit, type Kit } from './kit';

/*
 * The board as supply roads: each row is a packed-earth road on a low causeway across the map, with a
 * dashed cream centre line, chevron edge markers in the row's colour pointing the way the work flows, and
 * kilometre stones at each sector. Each stage column is a sector: a dark ops-board strip painted on the map
 * along its leading edge with the phase accent down the middle, a checkpoint marker at the front carrying
 * the sector letter, and the same letter on a board at the back.
 */

/** Lane-local height of the map (lanes sit at SKY_Y = 5.5). */
const MAP = GROUND_Y - 5.5;
/** Half width of the road surface. */
const RW = 1.3;
const ROAD_TOP = -0.04;

/** A causeway of length len centred on x = mid: a trapezoid of earth from the map up to the road. */
function causeway(bins: Bins, kit: Kit, x0: number, x1: number) {
  const h = ROAD_TOP - MAP;
  const top = RW + 0.12;
  const bottom = RW + 0.6;
  const shape = new THREE.Shape([new THREE.Vector2(-bottom, 0), new THREE.Vector2(bottom, 0), new THREE.Vector2(top, h - 0.05), new THREE.Vector2(-top, h - 0.05)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false });
  // the extrusion runs along +z: turn it to run along +x from x0, with the profile across z
  g.rotateY(Math.PI / 2);
  g.translate(x0, MAP, 0);
  g.computeVertexNormals();
  bins.paint('v', g, new THREE.Color(kit.p.terrainAlt).lerp(new THREE.Color(kit.p.khaki), 0.3), kit.light ? 0.78 : 1.2);
}

/** Flat chevrons pointing +x, as one geometry. */
function chevron(x: number, z: number, s: number, y: number) {
  const sh = new THREE.Shape([
    new THREE.Vector2(-0.5 * s, 0.45 * s),
    new THREE.Vector2(0, 0.45 * s),
    new THREE.Vector2(0.45 * s, 0),
    new THREE.Vector2(0, -0.45 * s),
    new THREE.Vector2(-0.5 * s, -0.45 * s),
    new THREE.Vector2(-0.05 * s, 0),
  ]);
  return new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2).translate(x, y, z);
}

export function Lane({ x0, x1, color, supports }: LaneProps) {
  const kit = useKit();
  const built = useMemo(() => {
    const bins = new Bins();
    const len = x1 - x0;
    const mid = (x0 + x1) / 2;
    causeway(bins, kit, x0 - 0.6, x1 + 0.4);
    bins.add('road', box(len + 1.0, 0.12, RW * 2, mid - 0.1, ROAD_TOP - 0.06, 0, 0.5));
    // dashed centre line
    for (let x = x0 + 1; x < x1 - 1; x += 2.6) bins.paint('v', box(1.3, 0.02, 0.1, x + 0.65, ROAD_TOP + 0.005, 0), kit.p.roadLine, kit.light ? 1 : 0.85);
    // chevron markers along both shoulders, every few metres
    for (let x = x0 + 2; x < x1 - 1; x += 3.5) for (const s of [-1, 1]) bins.add('chev', chevron(x, s * (RW - 0.22), 0.36, ROAD_TOP + 0.008));
    // kilometre stones at each sector: a pale block with a row-coloured cap
    for (const x of supports)
      for (const s of [-1, 1]) {
        bins.paint('v', box(0.22, 0.34, 0.22, x, ROAD_TOP + 0.17, s * (RW + 0.12)), kit.p.concrete, kit.light ? 1.25 : 1.6);
        bins.add('chev', box(0.24, 0.08, 0.24, x, ROAD_TOP + 0.37, s * (RW + 0.12)));
      }
    return bins.merged();
  }, [x0, x1, supports, kit]);
  return (
    <group>
      <mesh geometry={built.v} material={kit.vcol} castShadow receiveShadow />
      <mesh geometry={built.road} material={kit.road} receiveShadow />
      <mesh geometry={built.chev} material={kit.painted(color, 0.6)} />
    </group>
  );
}

/**
 * A graded road ramp from the compound up to its causeway: road surface with a dashed centre line and
 * kerbs. On big islands the core repeats it round the loop, so it also reads as a short straight piece of
 * ring road.
 */
export function Ramp({ length, color }: RampProps) {
  const kit = useKit();
  const geo = useMemo(() => {
    const bins = new Bins();
    bins.add('road', box(length, 0.26, RW * 2, 0, 0, 0, 0.5));
    // the centre line: one dash per short piece, a dashed run on a long ramp
    const n = Math.max(1, Math.round(length / 2.6));
    for (let i = 0; i < n; i++) bins.paint('v', box(Math.min(1.2, (length / n) * 0.5), 0.02, 0.1, -length / 2 + ((i + 0.5) * length) / n, 0.135, 0), kit.p.roadLine, kit.light ? 1 : 0.85);
    for (const s of [-1, 1]) bins.paint('v', box(length, 0.12, 0.16, 0, 0.16, s * (RW - 0.02)), kit.p.concrete, kit.light ? 1.1 : 1.4);
    bins.add('edge', box(length, 0.02, 0.12, 0, 0.135, RW - 0.3));
    bins.add('edge', box(length, 0.02, 0.12, 0, 0.135, -RW + 0.3));
    return bins.merged();
  }, [length, kit]);
  return (
    <group>
      <mesh geometry={geo.road} material={kit.road} castShadow receiveShadow />
      <mesh geometry={geo.v} material={kit.vcol} />
      <mesh geometry={geo.edge} material={kit.painted(color, 0.6)} />
    </group>
  );
}

const SECTOR = (i: number) => String.fromCharCode(65 + (i % 26));

const boards = new Map<string, THREE.Texture | null>();
/** A sector board: the letter in the phase accent on the dark ops-board. */
function sectorBoard(kit: Kit, letter: string, accent: string): THREE.Texture | null {
  const key = `${letter}|${accent}|${kit.p.opsBoard}`;
  if (boards.has(key)) return boards.get(key)!;
  const t = lettered(128, 128, (g, w, h) => {
    const bg = kit.p.opsBoard;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = accent;
    g.fillRect(0, h - 14, w, 14);
    g.strokeStyle = accent;
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
    stencilText(g, letter, w / 2, 60, 82, accent, { bg, spacing: 0 });
  });
  boards.set(key, t);
  return t;
}

/**
 * A sector: a dark ops-board strip on the map along the column's leading edge with the accent down its
 * middle, a faint shade over every other column, and the sector letter on a checkpoint marker at the
 * front and a board at the back.
 */
export function DistrictBand({ index, accent, width, depth, edgeX, active }: DistrictBandProps) {
  const kit = useKit();
  const letter = SECTOR(index);
  const tex = sectorBoard(kit, letter, accent);
  const geo = useMemo(() => {
    const bins = new Bins();
    bins.add('strip', box(1.1, 0.04, depth, edgeX, MAP + 0.03, 0));
    bins.add('line', box(0.16, 0.02, depth - 0.4, edgeX, MAP + 0.06, 0));
    // the checkpoint marker at the front: a post and a board facing the camera
    bins.add('post', post(edgeX, depth / 2 - 0.8, MAP, MAP + 3.2, 0.09, 6));
    bins.add('post', post(edgeX, -depth / 2 + 0.8, MAP, MAP + 3.8, 0.09, 6));
    return bins.merged();
  }, [depth, edgeX]);
  const shade = useMemo(() => new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: kit.light ? 0.05 : 0.12, depthWrite: false }), [kit.light]);
  const face = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: active ? 0.9 : kit.light ? 0.15 : 0.45 }), [tex, active, kit.light]);
  return (
    <group>
      {index % 2 === 1 && (
        <mesh position={[0, MAP + 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} material={shade}>
          <planeGeometry args={[width, depth]} />
        </mesh>
      )}
      <mesh geometry={geo.strip} material={kit.opsBoard} receiveShadow />
      <mesh geometry={geo.line} material={kit.glow(accent, active ? 2.6 : kit.light ? 1.0 : 1.5)} />
      <mesh geometry={geo.post} material={kit.steel} castShadow />
      {[depth / 2 - 0.8, -depth / 2 + 0.8].map((z, i) => (
        <group key={i} position={[edgeX, MAP + (i ? 3.8 : 3.2), z]} rotation={[i ? 0 : -0.35, 0, 0]}>
          <mesh material={kit.bezel}>
            <boxGeometry args={[1.5, 1.5, 0.08]} />
          </mesh>
          <mesh position={[0, 0, 0.045]} material={face}>
            <planeGeometry args={[1.4, 1.4]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

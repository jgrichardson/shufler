import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { PHASE_ACCENT, type DistrictBandProps, type LaneProps, type RampProps } from '../api';
// the Lane slot is not told which phase each support is; the live stage order is (as Sky Islands does)
import { PHASES } from '../../lib/domains';
import { Bins, bare, box, post, useKit, type Kit } from './kit';

/*
 * The board as a steel coaster: each row is a run of twin tubular rails on a box spine painted in the
 * row's domain colour, carried on cream columns over the park. Each phase column is a ride station: a
 * plank platform behind the track whose edge glows in the phase accent.
 */

/** Ground under the board, in the Lane's local frame (the lane sits at SKY_Y = 5.5; the park is at y = -0.55). */
export const GROUND = -6.05;
const RAIL_Y = -0.2;
const RAIL_Z = 0.45;
const RAIL_R = 0.065;
const SPINE_Y = -0.56;
const SPINE_H = 0.36;
const SPINE_W = 0.58;
/** Station platform: behind the track (toward -z, away from the camera) so it never hides a car. */
const PLAT_Z0 = -1.0;
const PLAT_Z1 = -2.05;
const PLAT_Y = -0.32;
const SIGNAL_Y = 1.25;
/** Half length of a station along the track; a column is 14 wide and three cars span about ±5.9. */
const STATION_HALF = 6.1;

const railGeo = (len: number) => {
  const g = new THREE.CylinderGeometry(RAIL_R, RAIL_R, len, 8, 1);
  g.rotateZ(Math.PI / 2);
  return g;
};

/** Rails, ties and spine for a straight run from xa to xb in the local frame, y offset dy. */
export function trackParts(bins: Bins, xa: number, xb: number, dy = 0) {
  const len = xb - xa;
  if (len <= 0.05) return;
  const mid = (xa + xb) / 2;
  for (const z of [-RAIL_Z, RAIL_Z]) bins.add('steel', railGeo(len).translate(mid, RAIL_Y + dy, z));
  bins.add('spine', box(len, SPINE_H, SPINE_W, mid, SPINE_Y + dy, 0));
  // ties: a cross bar under the rails and a short web down to the spine
  const n = Math.max(1, Math.floor(len / 0.85));
  for (let i = 0; i <= n; i++) {
    const x = xa + (i * len) / n;
    bins.add('tie', box(0.1, 0.08, RAIL_Z * 2 + 0.1, x, RAIL_Y - 0.08 + dy, 0));
    bins.add('tie', box(0.08, 0.22, 0.1, x, RAIL_Y - 0.2 + dy, 0));
  }
}

/**
 * A station: a plank platform behind the track with a glowing edge in the phase accent, a low back railing
 * hung with warm bulbs, and a signal lamp in the accent on a post at each end. Everything stays low (no
 * roof): from the board's camera anything tall behind the track would hide the cars.
 */
function stationParts(bins: Bins, x: number) {
  const L = STATION_HALF * 2;
  const pz = (PLAT_Z0 + PLAT_Z1) / 2;
  const depth = PLAT_Z0 - PLAT_Z1;
  bins.add('plank', box(L, 0.16, depth, x, PLAT_Y, pz, 0.7));
  bins.add('accent', bare(box(L, 0.05, 0.1, x, PLAT_Y + 0.1, PLAT_Z0 - 0.06)));
  // back railing
  const posts = 7;
  const railY = PLAT_Y + 0.7;
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i < posts; i++) {
    const px = x - STATION_HALF + 0.15 + (i * (L - 0.3)) / (posts - 1);
    bins.add('trim', post(px, PLAT_Z1 + 0.08, PLAT_Y, railY, 0.035, 5));
    tops.push(new THREE.Vector3(px, railY + 0.02, PLAT_Z1 + 0.08));
  }
  bins.add('trim', box(L - 0.2, 0.06, 0.06, x, railY, PLAT_Z1 + 0.08));
  // festoon bulbs dipping between the railing posts
  for (let s = 0; s < tops.length - 1; s++)
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const p = tops[s].clone().lerp(tops[s + 1], t);
      p.y -= Math.sin(Math.PI * t) * 0.16;
      bins.add('bulbs', bare(new THREE.SphereGeometry(0.06, 6, 4).translate(p.x, p.y, p.z + 0.04)));
    }
  // signal posts at each end of the platform
  for (const dx of [-STATION_HALF + 0.3, STATION_HALF - 0.3]) {
    bins.add('trim', post(x + dx, PLAT_Z1 + 0.35, PLAT_Y, SIGNAL_Y, 0.06, 8));
    bins.add('trim', box(0.26, 0.1, 0.26, x + dx, SIGNAL_Y + 0.02, PLAT_Z1 + 0.35));
    bins.add('accentLamp', bare(new THREE.SphereGeometry(0.15, 10, 8).translate(x + dx, SIGNAL_Y + 0.2, PLAT_Z1 + 0.35)));
  }
}

/** A column from the spine to the ground with a footing and a Y-fork under the spine. */
function columnParts(bins: Bins, x: number, top = SPINE_Y - SPINE_H / 2, ground = GROUND) {
  bins.add('support', post(x, 0, ground, top - 0.35, 0.15, 10));
  bins.add('support', box(0.5, 0.12, 0.5, x, top - 0.3, 0, 0.6));
  bins.add('support', box(0.36, 0.3, SPINE_W + 0.06, x, top - 0.12, 0));
  bins.add('footing', box(0.7, 0.3, 0.7, x, ground + 0.15, 0, 0.6));
}

const spines = new Map<string, THREE.MeshStandardMaterial>();
/** The painted spine; at night it carries a faint glow of its own colour so each row still reads under the moon. */
function spineMat(kit: Kit, color: string) {
  const key = `${color}|${kit.light}`;
  let m = spines.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15 });
    if (!kit.light) {
      m.emissive.set(color);
      m.emissiveIntensity = 0.35;
    }
    spines.set(key, m);
  }
  return m;
}

function useLaneMaterials(kit: Kit, color: string) {
  return useMemo(
    () => ({
      spine: spineMat(kit, color),
      steel: kit.steel,
      tie: kit.tie,
      support: kit.support,
      footing: kit.curb,
      plank: kit.plank,
      // station railings and signal posts in dark steel, so they recede behind the cars
      trim: kit.steelDark,
    }),
    [kit, color],
  );
}

/**
 * A row's coaster: rails and domain-coloured spine from x0 to x1, a column every half district, a station
 * at each phase, and a buffer stop at the end.
 */
export function Lane({ x0, x1, color, supports }: LaneProps) {
  const kit = useKit();
  const mats = useLaneMaterials(kit, color);
  const built = useMemo(() => {
    const bins = new Bins();
    const xs = [...supports].sort((a, b) => a - b);
    trackParts(bins, x0, x1);
    // stations, one per phase, coloured by the phase accent
    const accents: { geo: THREE.BufferGeometry; lamp: THREE.BufferGeometry; color: string }[] = [];
    xs.forEach((x, i) => {
      const accent = PHASE_ACCENT[PHASES[i]] ?? '#ffd29a';
      const sb = new Bins();
      stationParts(sb, x);
      const m = sb.merged();
      for (const k of ['plank', 'trim', 'support', 'bulbs']) if (m[k]) bins.add(k, m[k]);
      accents.push({ geo: m.accent, lamp: m.accentLamp, color: accent });
    });
    // columns between the stations (half a district apart), skipping where a station post stands
    for (let x = x0 + 3.5; x < x1 - 0.5; x += 7) columnParts(bins, x);
    // buffer stop at the end of the run
    bins.add('support', box(0.3, 0.9, 1.3, x1 + 0.1, -0.15, 0, 0.6));
    return { g: bins.merged(), accents };
  }, [x0, x1, supports, kit]);
  const bulbs = kit.light ? kit.glow(kit.p.bulb, 0.9) : kit.glow(kit.p.bulb, 2.4);
  return (
    <group>
      <mesh geometry={built.g.spine} material={mats.spine} castShadow receiveShadow />
      <mesh geometry={built.g.steel} material={mats.steel} castShadow />
      <mesh geometry={built.g.tie} material={mats.tie} />
      <mesh geometry={built.g.support} material={mats.support} castShadow receiveShadow />
      <mesh geometry={built.g.footing} material={mats.footing} receiveShadow />
      {built.g.plank && <mesh geometry={built.g.plank} material={mats.plank} castShadow receiveShadow />}
      {built.g.trim && <mesh geometry={built.g.trim} material={mats.trim} castShadow />}
      {built.g.bulbs && <mesh geometry={built.g.bulbs} material={bulbs} />}
      {built.accents.map((a) => (
        <group key={a.color}>
          <mesh geometry={a.geo} material={kit.glow(a.color, kit.light ? 1.15 : 1.6)} />
          <mesh geometry={a.lamp} material={kit.glow(a.color, 2.6)} />
        </group>
      ))}
    </group>
  );
}

/**
 * The lift hill from the row's plaza up to its track: rails and spine at the lane's height, a chain up the
 * middle, and columns that stand plumb whatever the core's slope.
 */
export function Ramp({ length, color }: RampProps) {
  const kit = useKit();
  const mats = useLaneMaterials(kit, color);
  const ref = useRef<THREE.Group>(null);
  // the core rotates the ramp about z; read the slope and height once so the columns can stand upright
  const [frame, setFrame] = useState<{ angle: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const parent = ref.current?.parent;
    if (parent) setFrame({ angle: parent.rotation.z, y: parent.position.y });
  }, [length]);
  const built = useMemo(() => {
    const bins = new Bins();
    // rails sit 0.26 above the ramp's centre line so they meet the lane's rails
    trackParts(bins, -length / 2, length / 2, 0.26);
    const chain = box(length, 0.05, 0.12, 0, RAIL_Y + 0.2, 0);
    bins.add('chain', chain);
    return bins.merged();
  }, [length]);
  const columns = useMemo(() => {
    if (!frame) return null;
    const bins = new Bins();
    const n = Math.max(1, Math.floor(length / 3.2));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const lx = t * length;
      // local point under the spine, then straight down in world terms to the park
      const wx = lx * Math.cos(frame.angle);
      const wy = frame.y + lx * Math.sin(frame.angle) + SPINE_Y + 0.26 - SPINE_H / 2;
      const ground = -0.55;
      if (wy - ground < 0.6) continue;
      bins.add('support', post(wx, 0, ground - frame.y, wy - frame.y, 0.13, 8));
      bins.add('footing', box(0.6, 0.3, 0.6, wx, ground - frame.y + 0.15, 0));
    }
    return bins.merged();
  }, [frame, length]);
  return (
    <group ref={ref}>
      <mesh geometry={built.spine} material={mats.spine} castShadow />
      <mesh geometry={built.steel} material={mats.steel} castShadow />
      <mesh geometry={built.tie} material={mats.tie} />
      <mesh geometry={built.chain} material={kit.steelDark} />
      {columns?.support && (
        <group rotation={[0, 0, -(frame?.angle ?? 0)]}>
          <mesh geometry={columns.support} material={mats.support} castShadow />
          <mesh geometry={columns.footing} material={mats.footing} />
        </group>
      )}
    </group>
  );
}

/**
 * The park floor under a column, alternating two pavings so the columns read, with a marquee bar across the
 * rows at the column's leading edge: a slim beam lit in the phase accent, as Factory's bridge.
 */
export function DistrictBand({ index, accent, width, depth, edgeX, active }: DistrictBandProps) {
  const kit = useKit();
  const geo = useMemo(() => {
    const floor = box(width - 0.4, 0.3, depth, 0, GROUND + 0.05, 0, 0.18);
    const beam = box(0.28, 0.2, depth, 0, 0.5, 0);
    const posts = [-1, 1].map((s) => post(0, (s * depth) / 2, GROUND, 0.5, 0.14, 8));
    const strip = box(0.3, 0.06, depth, 0, 0.63, 0);
    // a gentle path edge at the column boundary on the ground
    const curb = box(0.5, 0.36, depth, 0, GROUND + 0.05, 0);
    return { floor, beam, posts: [...posts], strip, curb };
  }, [width, depth]);
  return (
    <group>
      <mesh geometry={geo.floor} material={index % 2 ? kit.floorDark : kit.floor} receiveShadow />
      <group position={[edgeX, 0, 0]}>
        <mesh geometry={geo.curb} material={kit.curb} receiveShadow />
        <mesh geometry={geo.beam} material={kit.steelDark} castShadow />
        {geo.posts.map((g, i) => (
          <mesh key={i} geometry={g} material={kit.support} castShadow />
        ))}
        <mesh geometry={geo.strip} material={kit.glow(accent, active ? 2.6 : kit.light ? 1.3 : 1.6)} />
      </group>
    </group>
  );
}

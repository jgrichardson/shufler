import { useId, useMemo } from 'react';
import * as THREE from 'three';
import { PHASE_ACCENT, useResolvedTheme, type DistrictBandProps, type LaneProps, type RampProps } from '../api';
// prototype: the Lane slot is not told which phase each support is; the live stage order is
import { PHASES } from '../../lib/domains';
import { pyramidRoof } from './Session';
import { islandVariant, mergeIslands, placeIsland, texturedBox, useKit, mergeGeometries } from './kit';
import { Scatter, scatterProps, type Prop } from './Island';

const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

/** Phase island half-size: wide enough for three pods along the track, shallow enough for tight rows. */
const RX = 4.4;
const RZ = 2.25;
const DECK_Y = -0.25;
const TRACK = 0.42;

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function box(w: number, h: number, d: number, x: number, y: number, z: number, density = 0.8, rotZ = 0) {
  const g = texturedBox(w, h, d, density);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return g;
}

/** Plank deck, rope-rail posts and handrails for a bridge from xa to xb along +x. */
function bridgeParts(xa: number, xb: number, deck: THREE.BufferGeometry[], dark: THREE.BufferGeometry[]) {
  const len = xb - xa;
  if (len <= 0.05) return;
  const mid = (xa + xb) / 2;
  deck.push(box(len, 0.14, 1.55, mid, DECK_Y - 0.1, 0, 0.9));
  // stringers under the deck
  for (const z of [-0.62, 0.62]) dark.push(box(len, 0.22, 0.14, mid, DECK_Y - 0.26, z));
  const posts = Math.max(2, Math.round(len / 1.3) + 1);
  for (let i = 0; i < posts; i++) {
    const x = xa + (i * len) / (posts - 1);
    for (const z of [-0.78, 0.78]) dark.push(box(0.1, 0.62, 0.1, x, DECK_Y + 0.2, z));
  }
  for (const z of [-0.78, 0.78]) dark.push(box(len, 0.06, 0.06, mid, DECK_Y + 0.47, z));
}

/**
 * A row's board: one floating island per phase column, joined by plank bridges, with a rail track running
 * the whole way so pods read as little cars travelling from island to island.
 */
export function Lane({ x0, x1, supports }: LaneProps) {
  const kit = useKit();
  const id = useId();
  const seed = useMemo(() => hashStr(id), [id]);
  const built = useMemo(() => {
    const xs = [...supports].sort((a, b) => a - b);
    const islands = xs.map((x, i) => {
      const g = islandVariant(seed + i * 13, 1.5);
      return placeIsland(g, x, DECK_Y, 0, RX, 1.25 + ((seed >> i) & 3) * 0.12, RZ, (seed >> (i + 3)) & 1 ? Math.PI : 0);
    });
    const merged = islands.length ? mergeIslands(islands) : null;
    const deck: THREE.BufferGeometry[] = [];
    const dark: THREE.BufferGeometry[] = [];
    const iron: THREE.BufferGeometry[] = [];
    const edge = RX * 0.9;
    let from = x0;
    for (const x of xs) {
      bridgeParts(from, x - edge, deck, dark);
      from = x + edge;
    }
    bridgeParts(from, x1, deck, dark);
    // sleepers and two rails the whole length
    const len = x1 - x0;
    const n = Math.floor(len / 0.62);
    for (let i = 0; i <= n; i++) dark.push(box(0.2, 0.08, 1.15, x0 + i * 0.62, DECK_Y + 0.02, 0, 1.5));
    for (const z of [-TRACK, TRACK]) iron.push(box(len, 0.07, 0.07, (x0 + x1) / 2, DECK_Y + 0.09, z));
    const props: Prop[] = [];
    // a small stone station house at the back of each phase island, its lamp and window in the phase accent
    const stone: THREE.BufferGeometry[] = [];
    const slate: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[] = [];
    xs.forEach((x, i) => {
      const hx = x + ((seed >> i) & 1 ? 1.6 : -1.6);
      const hz = -RZ * 0.62;
      for (const p of scatterProps(seed + i * 101, RX, RZ, 3, [[hx - x, hz, 1.2]], 1.0, 0.35)) props.push({ ...p, x: p.x + x, y: DECK_Y + 0.02, s: p.s * 0.85 });
      stone.push(box(1.3, 0.95, 0.95, hx, DECK_Y + 0.47, hz, 0.8));
      const roof = pyramidRoof(1.45, 0.75);
      roof.translate(hx, DECK_Y + 0.95 + 0.37, hz);
      slate.push(roof);
      const accent = new THREE.Color(PHASE_ACCENT[PHASES[i]] ?? '#ffd29a').multiplyScalar(2.2);
      const win = new THREE.PlaneGeometry(0.34, 0.42);
      win.translate(hx, DECK_Y + 0.5, hz + 0.48);
      const lamp = new THREE.OctahedronGeometry(0.13, 0);
      lamp.scale(1, 1.5, 1);
      lamp.translate(hx, DECK_Y + 1.95, hz);
      for (const g of [win, lamp]) {
        g.deleteAttribute('uv');
        g.deleteAttribute('normal');
        const n = g.getAttribute('position').count;
        const c = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) c.set([accent.r, accent.g, accent.b], k * 3);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        lamps.push(g);
      }
    });
    return {
      top: merged?.top,
      under: merged?.under,
      deck: deck.length ? mergeGeometries(deck) : null,
      dark: dark.length ? mergeGeometries(dark) : null,
      iron: mergeGeometries(iron),
      stone: stone.length ? mergeGeometries(stone) : null,
      slate: slate.length ? mergeGeometries(slate) : null,
      lamps: lamps.length ? mergeGeometries(lamps) : null,
      props,
    };
  }, [x0, x1, supports, seed]);
  return (
    <group>
      {built.top && <mesh geometry={built.top} material={kit.grass} receiveShadow />}
      {built.under && <mesh geometry={built.under} material={[kit.lip, kit.rock]} castShadow receiveShadow />}
      {built.deck && <mesh geometry={built.deck} material={kit.plank} castShadow receiveShadow />}
      {built.dark && <mesh geometry={built.dark} material={kit.plankDark} castShadow receiveShadow />}
      <mesh geometry={built.iron} material={kit.iron} />
      {built.stone && <mesh geometry={built.stone} material={kit.stone} castShadow receiveShadow />}
      {built.slate && <mesh geometry={built.slate} material={kit.slate} castShadow />}
      {built.lamps && <mesh geometry={built.lamps} material={lampMat} />}
      <Scatter props={built.props} />
    </group>
  );
}

/** A sloping plank bridge from the home island up to the first phase island. */
export function Ramp({ length }: RampProps) {
  const kit = useKit();
  const geo = useMemo(() => {
    const dark: THREE.BufferGeometry[] = [];
    const posts = Math.max(2, Math.round(length / 1.3) + 1);
    for (let i = 0; i < posts; i++) {
      const x = -length / 2 + (i * length) / (posts - 1);
      for (const z of [-0.78, 0.78]) dark.push(box(0.1, 0.62, 0.1, x, 0.3, z));
    }
    for (const z of [-0.78, 0.78]) dark.push(box(length, 0.06, 0.06, 0, 0.58, z));
    for (const z of [-0.62, 0.62]) dark.push(box(length, 0.22, 0.14, 0, -0.16, z));
    return { deck: texturedBox(length, 0.14, 1.55, 0.9), dark: mergeGeometries(dark) };
  }, [length]);
  return (
    <group>
      <mesh geometry={geo.deck} material={kit.plank} castShadow receiveShadow />
      <mesh geometry={geo.dark} material={kit.plankDark} castShadow />
    </group>
  );
}

const washes = new Map<string, THREE.MeshBasicMaterial>();
const wash = (accent: string, light: boolean) => {
  const key = accent + light;
  let m = washes.get(key);
  if (!m)
    washes.set(
      key,
      (m = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: light ? 0.18 : 0.1, depthWrite: false, blending: light ? THREE.NormalBlending : THREE.AdditiveBlending, toneMapped: false })),
    );
  return m;
};

/** No floor under the columns (the islands are the floor); a selected column gets a soft light wash. */
export function DistrictBand({ accent, width, depth, active }: DistrictBandProps) {
  const light = useResolvedTheme() === 'light';
  if (!active) return null;
  return (
    <mesh position={[0, -3.2, 0]} rotation={[-Math.PI / 2, 0, 0]} material={wash(accent, light)}>
      <planeGeometry args={[width - 1, depth]} />
    </mesh>
  );
}

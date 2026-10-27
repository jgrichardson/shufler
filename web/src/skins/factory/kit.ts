import * as THREE from 'three';
import { useResolvedTheme, useSkinPalette } from '../api';
import { FACTORY, type FactoryPalette } from './palette';

/*
 * Factory material kit, built once per palette and shared by every mesh. Sharing is safe: the core's
 * fade and focus treatments swap in derived materials and never touch these.
 */

const std = (color: THREE.ColorRepresentation, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });

/** Self-lit colour pushed past 1.0 (linear RGB) so bloom catches it. */
export const glowMat = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });

function makeKit(p: FactoryPalette, light: boolean) {
  // light mode: a more solid board floor, so the bright sky below does not show through
  const stds = new Map<string, THREE.MeshStandardMaterial>();
  const basics = new Map<string, THREE.MeshBasicMaterial>();
  return {
    p,
    // islands
    grass: std(p.grass, 0.95, { flatShading: true }),
    rock: std(p.rock, 1, { flatShading: true }),
    rockDark: std(p.rockDark, 1, { flatShading: true }),
    road: std(p.road, 0.8),
    roadLine: new THREE.MeshBasicMaterial({ color: p.roadLine }),
    plaza: std(p.plaza, 0.9),
    lampPost: std(p.lampPost, 1),
    tree: std('#ffffff', 0.85, { flatShading: true }),
    trunk: std(p.trunk, 0.9),
    house: std('#ffffff', 0.85),
    houseRoof: std('#ffffff', 0.75, { flatShading: true }),
    tower: std(p.tower, 0.6),
    towerMast: std(p.towerMast, 1),
    // sessions
    plate: std(p.sessionPlate, 0.95),
    shutter: std(p.shutter, 0.9),
    roofBox: std(p.roofBox, 0.8),
    mast: std(p.mast, 1),
    // landmarks
    stone: std(p.stone, 0.6),
    stoneDark: std(p.stoneDark, 0.7),
    roofRed: std(p.roofRed, 0.7, { flatShading: true }),
    roofSlate: std(p.roofSlate, 0.7, { flatShading: true }),
    steel: std(p.steel, 0.45, { metalness: 0.4 }),
    steelDark: std(p.steelDark, 0.5, { metalness: 0.5 }),
    wood: std(p.wood, 0.8),
    glass: std(p.glass, 0.1, { metalness: 0.2, transparent: true, opacity: 0.55 }),
    // skyway
    deck: std(p.deck, 0.6, { metalness: 0.05 }),
    rail: std(p.rail, 0.35, { metalness: 0.6 }),
    bands: [
      std(p.bandLight, 0.9, { transparent: true, opacity: light ? 0.86 : 0.55, depthWrite: false }),
      std(p.bandDark, 0.9, { transparent: true, opacity: light ? 0.86 : 0.55, depthWrite: false }),
    ],
    bridge: std(p.bridge, 0.5, { metalness: 0.3 }),
    // pods and crates
    podGlass: std(p.podGlass, 0.15, { metalness: 0.5 }),
    podSpine: std(p.podSpine, 0.7),
    podHoop: std(p.podHoop, 0.4),
    podPole: std(p.podPole, 1),
    podRing: std(p.podRing, 1),
    kraft: std(p.kraft, 0.8),
    // warehouse
    whSlab: std(p.whSlab, 0.8),
    whWall: std(p.whWall, 0.75),
    whTrim: std(p.whTrim, 0.6),
    whRoof: std(p.whRoof, 0.7, { side: THREE.DoubleSide }),
    whGlazing: std(p.whGlazing, 0.3, { emissive: p.whGlazingGlow, emissiveIntensity: 0.6, side: THREE.DoubleSide }),
    whGlow: new THREE.MeshBasicMaterial({ color: p.whGlow, toneMapped: false }),
    whShelf: std(p.whShelf, 0.8),
    whSteel: std(p.whSteel, 0.45, { metalness: 0.5 }),
    whRoller: std(p.whRoller, 0.3, { metalness: 0.7 }),
    whDoor: std(p.whDoor, 0.55),
    whDoorPanel: std(p.whDoorPanel, 0.6, { metalness: 0.2 }),
    whRamp: std(p.whRamp, 0.55),
    /** Shared standard material for a per-item colour (domain, wall, roof). */
    tint: (color: string, roughness: number, metalness = 0, flatShading = false) => {
      const key = `${color}|${roughness}|${metalness}|${flatShading}`;
      let m = stds.get(key);
      if (!m) stds.set(key, (m = std(color, roughness, { metalness, flatShading })));
      return m;
    },
    /** Shared self-lit material: `color` times `k`, not tone mapped. */
    light: (color: string, k = 1) => {
      const key = `${color}|${k}`;
      let m = basics.get(key);
      if (!m) basics.set(key, (m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false })));
      return m;
    },
  };
}

export type Kit = ReturnType<typeof makeKit>;

const kits = new WeakMap<FactoryPalette, Kit>();

/** The kit for the active palette (Factory, or a recolour of it) and theme; each theme has its own palette object. */
export function useKit(): Kit {
  const p = useSkinPalette(FACTORY);
  const light = useResolvedTheme() === 'light';
  let kit = kits.get(p);
  if (!kit) kits.set(p, (kit = makeKit(p, light)));
  return kit;
}

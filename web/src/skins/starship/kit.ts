import * as THREE from 'three';
import { useSkinPalette } from '../api';
import { STARSHIP, type StarshipPalette } from './palette';

/*
 * Starship material kit, built once per palette and shared by every mesh. Sharing is safe: the core's
 * fade and focus treatments swap in derived materials and never touch these.
 */

/** Fine panel seams, used as a bump map so large hull faces read as plated, not plastic. */
const panelTexture = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#5a5a5a';
  g.lineWidth = 2;
  for (const p of [0, 128]) {
    g.beginPath();
    g.moveTo(p + 1, 0);
    g.lineTo(p + 1, 256);
    g.moveTo(0, p + 1);
    g.lineTo(256, p + 1);
    g.stroke();
  }
  g.strokeStyle = '#6c6c6c';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(64, 0);
  g.lineTo(64, 128);
  g.moveTo(192, 128);
  g.lineTo(192, 256);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

/** Ceramic-white hull with a clear lacquer: the main surface of modules and landmarks. */
export const hullMat = (color: string, plated = false) =>
  new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.25,
    roughness: 0.38,
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
    ...(plated && panelTexture ? { bumpMap: panelTexture, bumpScale: 0.6 } : {}),
  });

/** Dark structural metal: decks, undersides, frames. */
export const graphiteMat = (color: string) => new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.42 });

/** Brushed titanium: rails, struts, trim. */
export const titaniumMat = (color: string) => new THREE.MeshStandardMaterial({ color, metalness: 0.92, roughness: 0.26 });

/** Smoked glass: reflects the studio lights, reads near-black face-on. */
export const glassMat = (color: string) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.4, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05 });

/** Self-lit strip in `color`, pushed past 1.0 so bloom catches it. */
export const lightMat = (color: string, k = 1.8) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });

export interface Kit {
  p: StarshipPalette;
  hull: THREE.Material;
  plated: THREE.Material;
  pale: THREE.Material;
  graphite: THREE.Material;
  deep: THREE.Material;
  ti: THREE.Material;
  glass: THREE.Material;
  /** Shared self-lit material for a colour and strength. */
  light: (color: string, k?: number) => THREE.MeshBasicMaterial;
}

const kits = new WeakMap<StarshipPalette, Kit>();

function makeKit(p: StarshipPalette): Kit {
  const lights = new Map<string, THREE.MeshBasicMaterial>();
  return {
    p,
    hull: hullMat(p.hull),
    plated: hullMat(p.hull, true),
    pale: hullMat(p.hullPale),
    graphite: graphiteMat(p.graphite),
    deep: graphiteMat(p.graphiteDeep),
    ti: titaniumMat(p.titanium),
    glass: glassMat(p.glass),
    light: (color, k = 1.8) => {
      const key = `${color}|${k}`;
      let m = lights.get(key);
      if (!m) lights.set(key, (m = lightMat(color, k)));
      return m;
    },
  };
}

/** The kit for the active palette (Starship, or a recolour of it). */
export function useKit(): Kit {
  const p = useSkinPalette(STARSHIP);
  let kit = kits.get(p);
  if (!kit) kits.set(p, (kit = makeKit(p)));
  return kit;
}

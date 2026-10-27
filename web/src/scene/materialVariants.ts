import * as THREE from 'three';
import { PIPE_FADE } from './morph';

/*
 * Derived materials for the two scene-wide treatments: the Pipeline fade (MorphFade) and the focus grey-out
 * (Dimmable). Both write a flag on the mesh and call applyVariant(), which swaps in a derived material and
 * restores the original when both flags clear. Originals are never mutated, so skins can share one material
 * across as many meshes as they like.
 */

export interface DimStyle {
  /** Colour everything out of focus drifts toward. */
  tint: string;
  /** 0..1, how far surface colours move toward the grey. */
  amount: number;
  /** Multiplier on the grey, so out-of-focus parts also step back in brightness. */
  darken: number;
  /** Brightness kept by self-lit strips and lamps (toneMapped: false materials). */
  glow: number;
}

export const DEFAULT_DIM: DimStyle = { tint: '#4a5260', amount: 0.82, darken: 0.6, glow: 0.22 };

let dim: DimStyle = DEFAULT_DIM;
let generation = 0;

/** Called by the active skin; derived materials built under the old style are dropped. */
export function setDimStyle(style: DimStyle) {
  dim = style;
  generation++;
}

const variants = new WeakSet<THREE.Material>();
const dimCache = new WeakMap<THREE.Material, { gen: number; mat: THREE.Material }>();

/** Additive glows and shader effects (beams) are hidden rather than greyed. */
const isEffect = (m: THREE.Material) => m instanceof THREE.ShaderMaterial || m.blending === THREE.AdditiveBlending;

function greyed(base: THREE.Material): THREE.Material {
  const hit = dimCache.get(base);
  if (hit && hit.gen === generation) return hit.mat;
  const m = base.clone();
  if (isEffect(base)) m.visible = false;
  else {
    const tint = new THREE.Color(dim.tint);
    const anyM = m as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number };
    if (anyM.color) {
      if (base.toneMapped === false) {
        // self-lit strips keep a faint glow so the shape still reads
        anyM.color.copy(tint).multiplyScalar(dim.glow * 2);
      } else {
        const c = anyM.color;
        const lum = Math.min(1, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
        const grey = new THREE.Color(lum, lum, lum).lerp(tint, 0.5).multiplyScalar(dim.darken);
        c.lerp(grey, dim.amount);
      }
    }
    if (anyM.emissive) anyM.emissiveIntensity = (anyM.emissiveIntensity ?? 1) * 0.15;
  }
  variants.add(m);
  dimCache.set(base, { gen: generation, mat: m });
  return m;
}

function fadeInto(own: THREE.Material, src: THREE.Material, k: number) {
  if (src.transparent) {
    // already-transparent glows (beams, rings) hide instead of fading
    own.visible = src.visible && k < 0.3;
    return;
  }
  if (!own.transparent) {
    own.transparent = true;
    own.needsUpdate = true;
  }
  own.opacity = src.opacity * (1 - (1 - PIPE_FADE) * k);
  own.depthWrite = k < 0.5 ? src.depthWrite : false;
}

interface VariantData {
  vBase?: THREE.Material;
  vFade?: number;
  vDim?: boolean;
  vOwn?: THREE.Material;
  vOwnSrc?: THREE.Material;
}

/** Re-derives the material a mesh should show from its original and its fade/dim flags. */
export function applyVariant(mesh: THREE.Mesh) {
  const cur = mesh.material;
  if (Array.isArray(cur)) return;
  const ud = mesh.userData as VariantData;
  // a material we did not make means React attached a new original
  if (!variants.has(cur)) ud.vBase = cur;
  const base = ud.vBase ?? cur;
  const src = ud.vDim ? greyed(base) : base;
  const k = ud.vFade ?? 0;
  let next = src;
  if (k > 0) {
    if (!ud.vOwn || ud.vOwnSrc !== src) {
      ud.vOwn = src.clone();
      ud.vOwnSrc = src;
      variants.add(ud.vOwn);
    }
    fadeInto(ud.vOwn, src, k);
    next = ud.vOwn;
  }
  if (mesh.material !== next) mesh.material = next;
}

/** Sets one flag on every mesh under root and re-derives its material. */
export function flagTree(root: THREE.Object3D, flag: 'vFade' | 'vDim', value: number | boolean) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Line).isLine) return;
    (mesh.userData as Record<string, unknown>)[flag] = value;
    applyVariant(mesh);
  });
}

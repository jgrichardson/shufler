import * as THREE from 'three';
import { useResolvedTheme, useSkinPalette } from '../api';
import { CASINO, type CasinoPalette } from './palette';

/*
 * Casino kit: textures (Poly Haven, CC0; see ASSETS.md), canvas-drawn patterns, geometry helpers and the
 * shared materials. Textures load without suspending, so the board never blanks while assets stream.
 * Geometry is procedural and merged per material.
 */

export const ASSET_BASE = `${import.meta.env.BASE_URL}skins/casino/`;

/** World height of the gaming floor; the tables stand on it, the row daises rise from it. */
export const FLOOR_Y = 2.6;
/** World height of the lower hall where the cashier's cage stands (the warehouse floor is a little above). */
export const LOWER_Y = -0.55;

const loader = typeof document !== 'undefined' ? new THREE.TextureLoader() : null;
const sources = new Map<string, THREE.Texture>();

/** A repeating texture from the skin's asset folder; the image is shared between repeats. */
export function tex(file: string, srgb: boolean, repeat: [number, number] = [1, 1]): THREE.Texture | null {
  if (!loader) return null;
  let base = sources.get(file);
  if (!base) {
    base = loader.load(ASSET_BASE + file);
    base.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    base.anisotropy = 4;
    sources.set(file, base);
  }
  if (repeat[0] === 1 && repeat[1] === 1) return base;
  const t = base.clone();
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}

/** A canvas of the given size, or null outside a browser (tests). */
export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  return g ? [c, g] : null;
}

export function canvasTexture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Letter-spaced text, centred on x. */
export function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  const ws = [...text].map((ch) => g.measureText(ch).width + spacing);
  let cx = x - (ws.reduce((a, b) => a + b, 0) - spacing) / 2;
  const align = g.textAlign;
  g.textAlign = 'center';
  [...text].forEach((ch, i) => {
    g.fillText(ch, cx + (ws[i] - spacing) / 2, y);
    cx += ws[i];
  });
  g.textAlign = align;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * Merges geometries into one indexed geometry, keeping the attributes all of them share. A local helper:
 * importing three/examples pulls a second copy of three into the dev bundle.
 */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(list[0].attributes).filter((n) => list.every((g) => g.getAttribute(n)));
  const out = new THREE.BufferGeometry();
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.getAttribute('position').count;
    iCount += g.index ? g.index.count : g.getAttribute('position').count;
  }
  for (const name of names) {
    const size = list[0].getAttribute(name).itemSize;
    const arr = new Float32Array(vCount * size);
    let o = 0;
    for (const g of list) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[o + i * size + k] = a.getComponent(i, k);
      o += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const index = new Uint32Array(iCount);
  let base = 0;
  let io = 0;
  for (const g of list) {
    const n = g.getAttribute('position').count;
    if (g.index) for (let i = 0; i < g.index.count; i++) index[io++] = g.index.getX(i) + base;
    else for (let i = 0; i < n; i++) index[io++] = i + base;
    base += n;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/** Collects geometries by bucket name and merges each bucket once. */
export class Bins {
  private bins = new Map<string, THREE.BufferGeometry[]>();
  add(key: string, g: THREE.BufferGeometry) {
    const list = this.bins.get(key);
    if (list) list.push(g);
    else this.bins.set(key, [g]);
    return g;
  }
  merged(): Record<string, THREE.BufferGeometry> {
    const out: Record<string, THREE.BufferGeometry> = {};
    for (const [k, list] of this.bins) out[k] = mergeGeometries(list);
    return out;
  }
}

/** A box whose UVs repeat with its size (density = repeats per unit), so wood grain stays in scale. */
export function texturedBox(w: number, h: number, d: number, density = 0.6): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * faces[f][0] * density, uv.getY(k) * faces[f][1] * density);
    }
  return g;
}

/** A box placed at (x, y, z), optionally turned about y. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, density = 0.6, rotY = 0): THREE.BufferGeometry {
  const g = texturedBox(w, h, d, density);
  if (rotY) g.rotateY(rotY);
  return g.translate(x, y, z);
}

/** A vertical post from y0 to y1 at (x, z). */
export function post(x: number, z: number, y0: number, y1: number, r: number, seg = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, y1 - y0, seg).translate(x, (y0 + y1) / 2, z);
}

/** A cylinder (rod) from point a to point b. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}

/** Strips normals and UVs so a self-lit geometry merges with others of the same kind. */
export function bare(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

/** Gives a geometry a flat vertex colour, so differently coloured parts can share one vertex-coloured material. */
export function paint(g: THREE.BufferGeometry, color: string | THREE.Color, k = 1): THREE.BufferGeometry {
  const c = new THREE.Color(color).multiplyScalar(k);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A rounded rectangle shape centred on the origin. */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A flat shape lying in the xz plane, facing up, with 0..1 UVs (top of the shape toward -z). */
export function flatShape(shape: THREE.Shape, w: number, h: number, up = true): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shape, 6);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = (pos.getX(i) + w / 2) / w;
    uv.setXY(i, up ? u : 1 - u, (pos.getY(i) + h / 2) / h);
  }
  // up: the shape's +y runs to -z and the face looks up; down: it runs to +z and the face looks down
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  return g;
}

/* ---------- canvas patterns ---------- */

/** The gaming-floor carpet: an ornamental lattice of medallions and quatrefoils, tileable. */
function carpetCanvas(base: string, motif: string, accent: string, light: boolean): HTMLCanvasElement | null {
  const made = canvas(512, 512);
  if (!made) return null;
  const [c, g] = made;
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  // fine woven noise
  const img = g.getImageData(0, 0, 512, 512);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * (light ? 10 : 14);
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = light ? 0.35 : 0.5;
  g.strokeStyle = motif;
  g.lineWidth = 3;
  // diagonal lattice
  for (let k = -512; k <= 1024; k += 128) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 512, 512);
    g.moveTo(k, 512);
    g.lineTo(k + 512, 0);
    g.stroke();
  }
  // medallions at the lattice crossings and quatrefoils in the diamonds
  const medallion = (x: number, y: number) => {
    g.fillStyle = accent;
    g.beginPath();
    g.arc(x, y, 22, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = motif;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = motif;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath();
      g.arc(x + Math.cos(a) * 30, y + Math.sin(a) * 30, 4, 0, Math.PI * 2);
      g.fill();
    }
  };
  const quatrefoil = (x: number, y: number) => {
    g.strokeStyle = motif;
    g.lineWidth = 2.5;
    for (const [dx, dy] of [[0, -11], [11, 0], [0, 11], [-11, 0]]) {
      g.beginPath();
      g.arc(x + dx, y + dy, 10, 0, Math.PI * 2);
      g.stroke();
    }
  };
  for (let x = 0; x <= 512; x += 128)
    for (let y = 0; y <= 512; y += 128) {
      medallion(x, y);
      quatrefoil(x + 64, y + 64);
    }
  g.globalAlpha = 1;
  return c;
}

/** Soft round light for bokeh sprites. */
function bokehCanvas(): HTMLCanvasElement | null {
  const made = canvas(128, 128);
  if (!made) return null;
  const [c, g] = made;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/* ---------- materials ---------- */

export interface Kit {
  p: CasinoPalette;
  light: boolean;
  felt: THREE.MeshStandardMaterial;
  /** Felt for the warm pools of light: vertex-coloured so each table is brighter in its middle. */
  feltPool: THREE.MeshStandardMaterial;
  feltPrint: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  ivory: THREE.MeshStandardMaterial;
  cardEdge: THREE.MeshStandardMaterial;
  ink: THREE.MeshStandardMaterial;
  carpet: THREE.MeshStandardMaterial;
  lowerCarpet: THREE.MeshStandardMaterial;
  marble: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  wallPanel: THREE.MeshStandardMaterial;
  pilaster: THREE.MeshStandardMaterial;
  slotBody: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  /** Vertex-coloured standard material. */
  vcol: THREE.MeshStandardMaterial;
  /** Vertex-coloured self-lit material. */
  vglow: THREE.MeshBasicMaterial;
  bokehMap: THREE.Texture | null;
  /** Shared self-lit material for a colour and strength (bloom picks up k > 1). */
  glow: (color: string, k?: number) => THREE.MeshBasicMaterial;
  /** Padded leather in a colour: the table rails. */
  leather: (color: string) => THREE.MeshStandardMaterial;
  /** Lacquer or enamel in a colour. */
  painted: (color: string, rough?: number) => THREE.MeshStandardMaterial;
}

const kits = new WeakMap<CasinoPalette, Kit>();

function makeKit(p: CasinoPalette, light: boolean): Kit {
  const glows = new Map<string, THREE.MeshBasicMaterial>();
  const paints = new Map<string, THREE.MeshStandardMaterial>();
  const leathers = new Map<string, THREE.MeshStandardMaterial>();
  const std = (color: string, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const woodMap = tex('dark_wood_diff.jpg', true);
  const woodNor = tex('dark_wood_nor.jpg', false);
  const feltNor = tex('felt_nor.jpg', false);
  const leatherNor = tex('leather_nor.jpg', false);
  const carpetC = carpetCanvas(p.carpet, p.carpetMotif, p.carpetAccent, light);
  const carpetMap = carpetC ? canvasTexture(carpetC, true) : null;
  // the floor geometry carries its UVs in carpet tiles, so the map repeats once per tile
  const lowerMap = carpetMap;
  const bokehC = bokehCanvas();
  return {
    p,
    light,
    felt: std(p.felt, 0.95, { normalMap: feltNor, normalScale: new THREE.Vector2(0.6, 0.6) }),
    feltPool: std('#ffffff', 0.95, { vertexColors: true, normalMap: feltNor, normalScale: new THREE.Vector2(0.6, 0.6) }),
    feltPrint: std(p.feltPrint, 0.6, { metalness: 0.3, emissive: p.feltPrint, emissiveIntensity: light ? 0.05 : 0.18 }),
    wood: std(light ? '#d9b796' : '#c79a7a', 0.45, { map: woodMap, normalMap: woodNor }),
    woodDark: std(p.woodDark, 0.5, { map: woodMap, normalMap: woodNor }),
    brass: std(p.brass, 0.28, { metalness: 0.85 }),
    ivory: std(p.ivory, 0.5),
    cardEdge: std(p.cardEdge, 0.6),
    ink: std(p.ink, 0.5),
    carpet: std(light ? '#ffffff' : '#e6dcd2', 0.97, { map: carpetMap }),
    lowerCarpet: std(light ? '#e9dfcf' : '#a89a90', 0.97, { map: lowerMap }),
    marble: std(p.marble, 0.22, { metalness: 0.05 }),
    wall: std(p.wall, 0.85),
    wallPanel: std(p.wallPanel, 0.7),
    pilaster: std(p.pilaster, 0.6),
    slotBody: std(p.slotBody, 0.35, { metalness: 0.4 }),
    glass: std(light ? '#2a3640' : '#0e1216', 0.08, { metalness: 0.6 }),
    vcol: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
    vglow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    bokehMap: bokehC ? canvasTexture(bokehC) : null,
    glow: (color, k = 2) => {
      const key = `${color}|${k}`;
      let m = glows.get(key);
      if (!m) glows.set(key, (m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false })));
      return m;
    },
    leather: (color) => {
      let m = leathers.get(color);
      if (!m) leathers.set(color, (m = std(color, 0.55, { normalMap: leatherNor, normalScale: new THREE.Vector2(0.5, 0.5), metalness: 0.05 })));
      return m;
    },
    painted: (color, rough = 0.3) => {
      const key = `${color}|${rough}`;
      let m = paints.get(key);
      if (!m) paints.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.1 })));
      return m;
    },
  };
}

/** The kit for the active palette (Casino, or a recolour of it) and theme. */
export function useKit(): Kit {
  const p = useSkinPalette(CASINO);
  const light = useResolvedTheme() === 'light';
  let kit = kits.get(p);
  if (!kit) kits.set(p, (kit = makeKit(p, light)));
  return kit;
}

/** True when a colour is the needs-you red (the ball is with the user): hue near red, strongly saturated. */
export function isAlarm(color: string): boolean {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return (hsl.h < 0.03 || hsl.h > 0.97) && hsl.s > 0.6 && hsl.l > 0.3;
}

/** A small stable hash of a string. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

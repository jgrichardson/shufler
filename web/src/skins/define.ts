import type { Skin, SkinComponents, SkinJson, SkinMeta, SkinScene, ChromeTokens, SkinPalette } from './types';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Identity helper so a skin module gets full type checking: `export default defineSkin({ ... })`. */
export function defineSkin(skin: Skin): Skin {
  if (!ID.test(skin.id)) throw new Error(`Skin id "${skin.id}" must be lowercase letters, digits and dashes`);
  return skin;
}

export interface SkinPatch extends SkinMeta {
  scene?: Partial<SkinScene>;
  sceneLight?: Partial<SkinScene>;
  chrome?: ChromeTokens;
  chromeLight?: ChromeTokens;
  palette?: SkinPalette;
  paletteLight?: SkinPalette;
  components?: Partial<SkinComponents>;
}

/** `over` laid on `base`, with fx and dim merged one level deep. */
export function mergeScene<T extends Partial<SkinScene>>(base: T, over: Partial<SkinScene> | undefined): T {
  const fx = base.fx || over?.fx ? { fx: { ...base.fx, ...over?.fx } } : {};
  const dim = base.dim || over?.dim ? { dim: { ...base.dim, ...over?.dim } } : {};
  return { ...base, ...over, ...fx, ...dim };
}

/** A new skin that reuses `base` and overrides what the patch sets. Nested scene settings merge one level deep. */
export function extendSkin(base: Skin, patch: SkinPatch): Skin {
  const { scene, sceneLight, chrome, chromeLight, palette, paletteLight, components, ...meta } = patch;
  return defineSkin({
    ...base,
    author: undefined,
    version: undefined,
    ...meta,
    scene: mergeScene({ fx: {}, dim: {}, ...base.scene }, scene),
    ...(base.sceneLight || sceneLight ? { sceneLight: mergeScene(base.sceneLight ?? {}, sceneLight) } : {}),
    chrome: { ...base.chrome, ...chrome },
    ...(base.chromeLight || chromeLight ? { chromeLight: { ...base.chromeLight, ...chromeLight } } : {}),
    palette: { ...base.palette, ...palette },
    ...(base.paletteLight || paletteLight ? { paletteLight: { ...base.paletteLight, ...paletteLight } } : {}),
    components: { ...base.components, ...components },
  });
}

/** Values that could pull remote content or break out of a CSS declaration are refused in imported skins. */
const UNSAFE_CSS = /url\(|@import|expression\(|[<>{};]|\\/i;
const COLOR_ISH = /^[#a-z0-9(),.%\s-]{1,120}$/i;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function strings(v: unknown, what: string, key: (k: string) => boolean): Record<string, string> {
  if (v == null) return {};
  if (!isRecord(v)) throw new Error(`${what} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!key(k)) throw new Error(`${what}: "${k}" is not an allowed key`);
    if (typeof val !== 'string' || UNSAFE_CSS.test(val) || !COLOR_ISH.test(val)) throw new Error(`${what}.${k} must be a plain colour or number`);
    out[k] = val;
  }
  return out;
}

const colour = (v: string, what: string) => strings({ v }, what, () => true).v;

/** The scene settings a JSON skin may set; unknown keys are dropped and numbers clamped. */
function parseScene(scene: unknown, what: string): Partial<SkinScene> {
  if (!isRecord(scene)) throw new Error(`"${what}" must be an object`);
  const s: Partial<SkinScene> = {};
  if (typeof scene.background === 'string') s.background = colour(scene.background, what);
  if (typeof scene.exposure === 'number' && scene.exposure > 0 && scene.exposure < 4) s.exposure = scene.exposure;
  if (typeof scene.ring === 'string') s.ring = colour(scene.ring, what);
  if (isRecord(scene.fog)) {
    const { color, near, far } = scene.fog;
    if (typeof color === 'string' && typeof near === 'number' && typeof far === 'number') s.fog = { color: colour(color, `${what}.fog`), near, far };
  }
  if (isRecord(scene.dim)) {
    const d = scene.dim;
    s.dim = {
      ...(typeof d.tint === 'string' ? { tint: colour(d.tint, `${what}.dim`) } : {}),
      ...(typeof d.amount === 'number' ? { amount: Math.min(1, Math.max(0, d.amount)) } : {}),
      ...(typeof d.darken === 'number' ? { darken: Math.min(1.5, Math.max(0, d.darken)) } : {}),
      ...(typeof d.glow === 'number' ? { glow: Math.min(1, Math.max(0, d.glow)) } : {}),
    };
  }
  if (isRecord(scene.beams)) {
    const b = scene.beams;
    s.beams = {
      ...(typeof b.additive === 'boolean' ? { additive: b.additive } : {}),
      ...(typeof b.intensity === 'number' ? { intensity: Math.min(3, Math.max(0, b.intensity)) } : {}),
    };
  }
  return s;
}

/** Validates an imported JSON skin. Throws with a readable message on anything it will not accept. */
export function parseSkinJson(raw: unknown): SkinJson {
  if (!isRecord(raw)) throw new Error('A skin file is a JSON object');
  const { id, name, description, author, version, extends: ext, scene, sceneLight, chrome, chromeLight, palette, paletteLight } = raw;
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('"id" must be lowercase letters, digits and dashes');
  if (typeof name !== 'string' || !name.trim()) throw new Error('"name" is required');
  if (typeof ext !== 'string' || !ID.test(ext)) throw new Error('"extends" must name an installed skin, e.g. "starship"');
  const out: SkinJson = {
    id,
    name: name.slice(0, 60),
    description: typeof description === 'string' ? description.slice(0, 240) : '',
    extends: ext,
    chrome: strings(chrome, 'chrome', (k) => /^--[a-z0-9-]{1,40}$/.test(k)) as ChromeTokens,
    ...(chromeLight != null ? { chromeLight: strings(chromeLight, 'chromeLight', (k) => /^--[a-z0-9-]{1,40}$/.test(k)) as ChromeTokens } : {}),
    palette: strings(palette, 'palette', (k) => /^[a-zA-Z0-9_-]{1,40}$/.test(k)),
  };
  if (typeof author === 'string') out.author = author.slice(0, 60);
  if (typeof version === 'string') out.version = version.slice(0, 20);
  if (scene != null) out.scene = parseScene(scene, 'scene');
  if (sceneLight != null) out.sceneLight = parseScene(sceneLight, 'sceneLight');
  if (paletteLight != null) out.paletteLight = strings(paletteLight, 'paletteLight', (k) => /^[a-zA-Z0-9_-]{1,40}$/.test(k));
  return out;
}

/** Builds a runnable skin from a JSON recolour and the skin it extends. */
export function fromJson(json: SkinJson, base: Skin): Skin {
  return extendSkin(base, json);
}

/** The JSON-editable scene keys that are set. */
function sceneTemplate(s: Partial<SkinScene>): Partial<SkinScene> {
  const out: Partial<SkinScene> = {};
  if (s.background !== undefined) out.background = s.background;
  if (s.fog !== undefined) out.fog = s.fog ?? null;
  if (s.exposure !== undefined) out.exposure = s.exposure;
  if (s.dim !== undefined) out.dim = s.dim;
  if (s.ring !== undefined) out.ring = s.ring;
  if (s.beams !== undefined) out.beams = s.beams;
  return out;
}

/** The editable parts of a skin as a JSON template, for "Export as template". */
export function toJsonTemplate(skin: Skin, base = skin.id): SkinJson {
  return {
    id: `${skin.id}-custom`,
    name: `${skin.name} (custom)`,
    description: `My recolour of ${skin.name}`,
    extends: base,
    scene: sceneTemplate(skin.scene),
    ...(skin.sceneLight ? { sceneLight: sceneTemplate(skin.sceneLight) } : {}),
    chrome: skin.chrome,
    ...(skin.chromeLight ? { chromeLight: skin.chromeLight } : {}),
    palette: skin.palette,
    ...(skin.paletteLight ? { paletteLight: skin.paletteLight } : {}),
  };
}

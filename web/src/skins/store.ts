import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { DEFAULT_DIM, setDimStyle } from '../scene/materialVariants';
import { fromJson, mergeScene } from './define';
import type { ChromeTokens, Skin, SkinJson, SkinPalette, SkinScene } from './types';
import { LIGHT_CHROME } from './lightChrome';
import { usePrefs } from '../ui/prefs';
import { getStored, storageKey } from '../lib/storage';

export const DEFAULT_SKIN = 'starship';
const LS_ACTIVE = storageKey('skin');
const LS_IMPORTED = storageKey('skins.imported');

function load<T>(key: string, fallback: T): T {
  try {
    const raw = getStored(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or storage full: the choice lasts for this tab only
  }
}

const fromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('skin') : null;

interface SkinState {
  /** Code skins found under src/skins/ at build time. */
  builtins: Skin[];
  /** JSON recolours the user imported in Settings. */
  imported: SkinJson[];
  activeId: string;
  registerBuiltins: (skins: Skin[]) => void;
  setActive: (id: string) => void;
  addImported: (json: SkinJson) => void;
  removeImported: (id: string) => void;
}

export const useSkinStore = create<SkinState>()((set, get) => ({
  builtins: [],
  imported: load<SkinJson[]>(LS_IMPORTED, []),
  activeId: fromUrl ?? load<string>(LS_ACTIVE, DEFAULT_SKIN),
  registerBuiltins: (builtins) => set({ builtins }),
  setActive: (activeId) => {
    save(LS_ACTIVE, activeId);
    set({ activeId });
  },
  addImported: (json) => {
    if (get().builtins.some((s) => s.id === json.id)) throw new Error(`"${json.id}" is the id of an installed skin; pick another id`);
    const imported = [...get().imported.filter((s) => s.id !== json.id), json];
    save(LS_IMPORTED, imported);
    set({ imported });
  },
  removeImported: (id) => {
    const imported = get().imported.filter((s) => s.id !== id);
    save(LS_IMPORTED, imported);
    set({ imported, activeId: get().activeId === id ? DEFAULT_SKIN : get().activeId });
  },
}));

export interface SkinListing {
  id: string;
  name: string;
  description: string;
  author?: string;
  imported: boolean;
  /** For imported skins: the code skin it recolours, or null when that skin is not installed. */
  base?: string | null;
}

/** Every selectable skin: code skins first, then imported recolours. */
export function listSkins(s: Pick<SkinState, 'builtins' | 'imported'>): SkinListing[] {
  return [
    ...s.builtins.map((k) => ({ id: k.id, name: k.name, description: k.description, author: k.author, imported: false })),
    ...s.imported.map((j) => ({ id: j.id, name: j.name, description: j.description, author: j.author, imported: true, base: s.builtins.some((b) => b.id === j.extends) ? j.extends : null })),
  ];
}

let cache: { key: unknown[]; skin: Skin } | null = null;

/** The active skin, falling back to the default (then any installed skin) when the chosen one is gone. */
export function resolveSkin(s: Pick<SkinState, 'builtins' | 'imported' | 'activeId'>): Skin | null {
  const key = [s.builtins, s.imported, s.activeId];
  if (cache && cache.key.every((k, i) => k === key[i])) return cache.skin;
  const byId = (id: string) => s.builtins.find((k) => k.id === id);
  let skin = byId(s.activeId);
  if (!skin) {
    const json = s.imported.find((j) => j.id === s.activeId);
    const base = json && byId(json.extends);
    if (json && base) skin = fromJson(json, base);
  }
  skin ??= byId(DEFAULT_SKIN) ?? s.builtins[0];
  if (!skin) return null;
  cache = { key, skin };
  return skin;
}

/** The active skin. Components re-render when the user switches. */
export function useSkin(): Skin {
  const skin = useSkinStore((s) => resolveSkin(s));
  if (!skin) throw new Error('No skins registered: src/skins/registry.ts must be imported before rendering');
  return skin;
}

const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const onOsTheme = (cb: () => void) => {
  darkQuery?.addEventListener('change', cb);
  return () => darkQuery?.removeEventListener('change', cb);
};
const osDark = () => darkQuery?.matches ?? true;

/** The theme actually shown: 'system' follows the OS and updates when it changes. */
export function useResolvedTheme(): 'dark' | 'light' {
  const theme = usePrefs((s) => s.theme);
  const dark = useSyncExternalStore(onOsTheme, osDark, () => true);
  return theme === 'system' ? (dark ? 'dark' : 'light') : theme;
}

/** A light scene for skins that ship none: the dark scene lifted, with gentler glow and a paler grey-out. */
function autoLight(scene: SkinScene): Partial<SkinScene> {
  const bloom = scene.fx?.bloom;
  const vignette = scene.fx?.vignette;
  return {
    exposure: (scene.exposure ?? 1) * 1.15,
    fx: {
      ...(bloom ? { bloom: { ...bloom, intensity: bloom.intensity * 0.6 } } : {}),
      ...(vignette ? { vignette: { ...vignette, darkness: vignette.darkness * 0.5 } } : {}),
    },
    dim: { darken: Math.max(scene.dim?.darken ?? 0.6, 0.9) },
    beams: { additive: false },
  };
}

const scenes = new WeakMap<Skin, Partial<Record<'dark' | 'light', SkinScene>>>();

/** The skin's scene for a theme: light mode lays `sceneLight` (or the automatic lift) over the dark scene. */
export function sceneFor(skin: Skin, theme: 'dark' | 'light'): SkinScene {
  let byTheme = scenes.get(skin);
  if (!byTheme) scenes.set(skin, (byTheme = {}));
  return (byTheme[theme] ??= theme === 'dark' ? skin.scene : mergeScene(skin.scene, skin.sceneLight ?? autoLight(skin.scene)));
}

/** The active skin's scene for the theme shown. */
export function useSkinScene(): SkinScene {
  return sceneFor(useSkin(), useResolvedTheme());
}

const palettes = new WeakMap<SkinPalette, Map<SkinPalette, Partial<Record<'dark' | 'light', SkinPalette>>>>();

/** A skin's palette over a component's defaults, for a theme; the same object each time, so kits cache on it. */
export function paletteFor<T extends SkinPalette>(skin: Skin, defaults: T, theme: 'dark' | 'light'): T {
  let byDefaults = palettes.get(skin.palette);
  if (!byDefaults) palettes.set(skin.palette, (byDefaults = new Map()));
  let byTheme = byDefaults.get(defaults);
  if (!byTheme) byDefaults.set(defaults, (byTheme = {}));
  return (byTheme[theme] ??= { ...defaults, ...skin.palette, ...(theme === 'light' ? skin.paletteLight : undefined) }) as T;
}

/** The skin's palette over the component's defaults, for the theme shown: how JSON recolours and light mode reach a skin's meshes. */
export function useSkinPalette<T extends SkinPalette>(defaults: T): T {
  return paletteFor(useSkin(), defaults, useResolvedTheme());
}

/** The chrome tokens for a skin in a theme: light mode lays the skin's own light tokens over the shared light chrome. */
export function chromeFor(skin: Skin, theme: 'dark' | 'light'): ChromeTokens {
  return theme === 'light' ? { ...LIGHT_CHROME, ...skin.chromeLight } : skin.chrome;
}

/** Pushes the skin's chrome tokens (for the current theme) onto :root and its dim style into the scene. Mount once, in App. */
export function useApplySkin() {
  const skin = useSkin();
  const theme = useResolvedTheme();
  useEffect(() => {
    const root = document.documentElement;
    const chrome = chromeFor(skin, theme);
    const keys = Object.keys(chrome);
    for (const k of keys) root.style.setProperty(k, chrome[k as `--${string}`] ?? '');
    document.body.dataset.skin = skin.id;
    document.body.dataset.theme = theme;
    setDimStyle({ ...DEFAULT_DIM, ...sceneFor(skin, theme).dim });
    return () => {
      for (const k of keys) root.style.removeProperty(k);
    };
  }, [skin, theme]);
}

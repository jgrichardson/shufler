import { DEFAULT_SKIN, useSkinStore } from './store';
import type { Skin } from './types';
import { withConcept } from './concepts';

/*
 * Skin discovery. Any folder under src/skins/ with an index.tsx whose default export is a skin is
 * installed at build time; nothing to register by hand. Private skins go in src/skins/local/<id>/
 * (git-ignored). Import this module once, before the first render.
 */
const modules = import.meta.glob<{ default?: Skin }>(['./*/index.tsx', './local/*/index.tsx'], { eager: true });

const isSkin = (v: unknown): v is Skin => !!v && typeof v === 'object' && 'id' in v && 'components' in v && 'scene' in v;

const found: Skin[] = [];
for (const [path, mod] of Object.entries(modules)) {
  if (!isSkin(mod.default)) {
    console.warn(`[skins] ${path} has no default-exported skin; skipped`);
    continue;
  }
  if (found.some((s) => s.id === mod.default!.id)) {
    console.warn(`[skins] duplicate skin id "${mod.default.id}" in ${path}; skipped`);
    continue;
  }
  found.push(mod.default);
}

// the default first, then alphabetical
found.sort((a, b) => (a.id === DEFAULT_SKIN ? -1 : b.id === DEFAULT_SKIN ? 1 : a.name.localeCompare(b.name)));

// dev only: ?concept=<id> lays a backdrop concept over Factory and Starship
useSkinStore.getState().registerBuiltins(withConcept(found));

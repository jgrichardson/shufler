import { describe, expect, it } from 'vitest';
import { defineSkin, extendSkin, fromJson, parseSkinJson, toJsonTemplate } from '../src/skins/define';
import { listSkins, paletteFor, resolveSkin, sceneFor } from '../src/skins/store';
import type { Skin, SkinComponents } from '../src/skins/types';
import ember from '../../docs/examples/ember.skin.json';

const nothing = () => null;
const components = Object.fromEntries(
  ['Backdrop', 'Platform', 'Island', 'Session', 'Landmark', 'Lane', 'Ramp', 'DistrictBand', 'PodBody', 'Crate', 'WarehouseShell', 'Rack', 'Dock'].map((k) => [k, nothing]),
) as unknown as SkinComponents;

const base: Skin = defineSkin({
  id: 'starship',
  name: 'Starship',
  description: 'test base',
  author: 'Shufler',
  scene: { background: '#000000', fx: { ao: { radius: 3, intensity: 2 }, bloom: false }, dim: { tint: '#333333', amount: 0.8 } },
  chrome: { '--accent': '#8fd3ff', '--text': '#ffffff' },
  palette: { hull: '#dddddd', light: '#9fd8ff' },
  components,
});
const other: Skin = { ...base, id: 'factory', name: 'Factory' };
const lit: Skin = {
  ...base,
  id: 'lit',
  sceneLight: { background: '#eef4fb', fx: { bloom: { intensity: 0.3, threshold: 1, radius: 0.5 } }, dim: { tint: '#dddddd' }, beams: { additive: false } },
  paletteLight: { hull: '#ffffff' },
};

describe('skins: define and extend', () => {
  it('rejects ids that would not survive a URL or settings key', () => {
    expect(() => defineSkin({ ...base, id: 'My Skin' })).toThrow();
  });

  it('extendSkin merges fx and dim one level deep and drops the base author', () => {
    const s = extendSkin(base, { id: 'night', name: 'Night', description: '', scene: { dim: { glow: 0.5 }, fx: { bloom: { intensity: 1, threshold: 1, radius: 0.5 } } }, chrome: { '--accent': '#ff0000' } });
    expect(s.scene.dim).toEqual({ tint: '#333333', amount: 0.8, glow: 0.5 });
    expect(s.scene.fx?.ao).toEqual({ radius: 3, intensity: 2 });
    expect(s.scene.fx?.bloom).toEqual({ intensity: 1, threshold: 1, radius: 0.5 });
    expect(s.chrome).toEqual({ '--accent': '#ff0000', '--text': '#ffffff' });
    expect(s.components.Session).toBe(base.components.Session);
    expect(s.author).toBeUndefined();
  });
});

describe('skins: light mode', () => {
  it('lays sceneLight over the dark scene, merging fx and dim one level deep', () => {
    const s = sceneFor(lit, 'light');
    expect(s.background).toBe('#eef4fb');
    expect(s.fx?.ao).toEqual({ radius: 3, intensity: 2 });
    expect(s.fx?.bloom).toEqual({ intensity: 0.3, threshold: 1, radius: 0.5 });
    expect(s.dim).toEqual({ tint: '#dddddd', amount: 0.8 });
    expect(s.beams).toEqual({ additive: false });
    expect(sceneFor(lit, 'dark')).toBe(lit.scene);
    expect(sceneFor(lit, 'light')).toBe(s);
  });

  it('gives a skin without a light scene an automatic lift', () => {
    const s = sceneFor({ ...base, scene: { ...base.scene, exposure: 1, fx: { bloom: { intensity: 1, threshold: 1, radius: 0.5 }, vignette: { offset: 0.3, darkness: 0.6 } } } }, 'light');
    expect(s.background).toBe('#000000');
    expect(s.exposure).toBeCloseTo(1.15);
    expect(s.fx?.bloom).toMatchObject({ intensity: 0.6 });
    expect(s.fx?.vignette).toMatchObject({ darkness: 0.3 });
    expect(s.beams?.additive).toBe(false);
  });

  it('lays paletteLight over the palette in light mode, one stable object per theme', () => {
    const defaults = { hull: '#000000', glass: '#111111' };
    expect(paletteFor(lit, defaults, 'light')).toEqual({ hull: '#ffffff', glass: '#111111', light: '#9fd8ff' });
    expect(paletteFor(lit, defaults, 'dark')).toEqual({ hull: '#dddddd', glass: '#111111', light: '#9fd8ff' });
    expect(paletteFor(lit, defaults, 'light')).toBe(paletteFor(lit, defaults, 'light'));
  });

  it('extendSkin merges sceneLight and paletteLight from the base and the patch', () => {
    const s = extendSkin(lit, { id: 'dawn', name: 'Dawn', description: '', sceneLight: { dim: { amount: 0.5 } }, paletteLight: { light: '#ff8800' } });
    expect(s.sceneLight?.background).toBe('#eef4fb');
    expect(s.sceneLight?.dim).toEqual({ tint: '#dddddd', amount: 0.5 });
    expect(s.paletteLight).toEqual({ hull: '#ffffff', light: '#ff8800' });
    expect(extendSkin(base, { id: 'plain', name: 'Plain', description: '' }).sceneLight).toBeUndefined();
  });
});

describe('skins: JSON recolours', () => {
  const ok = { id: 'ember', name: 'Ember', extends: 'starship', chrome: { '--accent': '#ffb36b' }, palette: { light: 'rgb(255, 190, 122)' } };

  it('accepts a plain recolour and fills the gaps from its base', () => {
    const json = parseSkinJson(ok);
    const skin = fromJson(json, base);
    expect(skin.id).toBe('ember');
    expect(skin.palette).toEqual({ hull: '#dddddd', light: 'rgb(255, 190, 122)' });
    expect(skin.chrome['--text']).toBe('#ffffff');
    expect(skin.components.Session).toBe(base.components.Session);
  });

  it.each([
    ['a url', { chrome: { '--bg': 'url(https://evil.example/x.png)' } }],
    ['an import', { chrome: { '--bg': '@import "x"' } }],
    ['a rule break', { chrome: { '--bg': 'red; } body { display: none' } }],
    ['a non-token chrome key', { chrome: { color: 'red' } }],
    ['a non-string colour', { palette: { hull: 3 } }],
    ['a bad id', { id: '../etc' }],
    ['no extends', { extends: undefined }],
  ])('refuses %s', (_, patch) => {
    expect(() => parseSkinJson({ ...ok, ...patch })).toThrow();
  });

  it('clamps the grey-out numbers and ignores unknown scene keys', () => {
    const json = parseSkinJson({ ...ok, scene: { dim: { amount: 7, darken: -1 }, exposure: 99, toneMapping: 'weird' } });
    expect(json.scene?.dim).toEqual({ amount: 1, darken: 0 });
    expect(json.scene?.exposure).toBeUndefined();
  });

  it('accepts a light scene and palette, clamping beam strength', () => {
    const json = parseSkinJson({ ...ok, sceneLight: { background: '#f4f7fb', beams: { additive: false, intensity: 9 }, ring: '#1b74b8' }, paletteLight: { light: '#2f9ef0' } });
    expect(json.sceneLight).toEqual({ background: '#f4f7fb', beams: { additive: false, intensity: 3 }, ring: '#1b74b8' });
    expect(fromJson(json, lit).paletteLight).toEqual({ hull: '#ffffff', light: '#2f9ef0' });
    expect(() => parseSkinJson({ ...ok, paletteLight: { light: 'url(x)' } })).toThrow();
  });

  it('a template of a skin with a light scene carries it', () => {
    const tpl = parseSkinJson(JSON.parse(JSON.stringify(toJsonTemplate(lit))));
    expect(tpl.sceneLight).toMatchObject({ background: '#eef4fb', dim: { tint: '#dddddd' } });
    expect(tpl.paletteLight).toEqual({ hull: '#ffffff' });
  });

  it('an exported template imports again unchanged', () => {
    const tpl = toJsonTemplate(base);
    expect(parseSkinJson(JSON.parse(JSON.stringify(tpl)))).toMatchObject({ id: 'starship-custom', extends: 'starship', chrome: base.chrome, palette: base.palette });
  });

  it('a template of a recolour still extends the code skin', () => {
    const recolour = fromJson(parseSkinJson(ok), base);
    expect(toJsonTemplate(recolour, 'starship').extends).toBe('starship');
  });

  it('the shipped example in docs/ parses', () => {
    expect(parseSkinJson(ember).extends).toBe('starship');
  });
});

describe('skins: picking the active one', () => {
  const imported = [parseSkinJson({ id: 'ember', name: 'Ember', extends: 'starship' }), parseSkinJson({ id: 'orphan', name: 'Orphan', extends: 'gone' })];

  it('resolves a code skin, an imported recolour, and falls back to the default', () => {
    const builtins = [base, other];
    expect(resolveSkin({ builtins, imported, activeId: 'factory' })?.id).toBe('factory');
    expect(resolveSkin({ builtins, imported, activeId: 'ember' })?.id).toBe('ember');
    expect(resolveSkin({ builtins, imported, activeId: 'orphan' })?.id).toBe('starship');
    expect(resolveSkin({ builtins, imported, activeId: 'deleted' })?.id).toBe('starship');
    expect(resolveSkin({ builtins: [other], imported, activeId: 'deleted' })?.id).toBe('factory');
    expect(resolveSkin({ builtins: [], imported, activeId: 'starship' })).toBeNull();
  });

  it('lists imported skins after code skins and flags a missing base', () => {
    const list = listSkins({ builtins: [base, other], imported });
    expect(list.map((s) => s.id)).toEqual(['starship', 'factory', 'ember', 'orphan']);
    expect(list.find((s) => s.id === 'orphan')?.base).toBeNull();
    expect(list.find((s) => s.id === 'ember')?.base).toBe('starship');
  });
});

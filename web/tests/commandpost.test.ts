import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import commandpost from '../src/skins/commandpost';
import { COMMAND, COMMAND_LIGHT } from '../src/skins/commandpost/palette';
import { VEHICLE_KINDS } from '../src/skins/commandpost/PodBody';
import { BALL_COLOR, CI_COLOR, PHASE_ACCENT, STATE_COLOR } from '../src/lib/colors';
import { LIGHT_CHROME } from '../src/skins/lightChrome';

/*
 * Command Post's readability and tone rules from its design plan: every status lamp sits in a dark bezel
 * and every phase accent on a dark ops-board strip (neither reads on sand), the chrome's text passes AA in
 * both themes, every kind of work has a vehicle, and the skin's own words stay logistics, not combat.
 */

type RGB = [number, number, number, number];
function parse(c: string): RGB {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGB;
  const rgba = c.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((x) => x.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`unparsed colour ${c}`);
}
const over = (top: RGB, under: RGB): RGB => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGB;
function lum([r, g, b]: RGB) {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const palettes = { dark: COMMAND, light: { ...COMMAND, ...COMMAND_LIGHT } };

describe('Command Post: the skin', () => {
  it('is a full skin with light mode and its own library', () => {
    expect(commandpost.id).toBe('commandpost');
    expect(commandpost.name).toBe('Command Post');
    expect(commandpost.sceneLight).toBeTruthy();
    expect(commandpost.chromeLight).toBeTruthy();
    expect(commandpost.paletteLight).toBeTruthy();
    expect(commandpost.components.Library).toBeTypeOf('function');
    for (const k of ['Backdrop', 'Platform', 'Island', 'Session', 'Landmark', 'Lane', 'Ramp', 'DistrictBand', 'PodBody', 'Crate', 'WarehouseShell', 'Rack', 'Dock'] as const)
      expect(commandpost.components[k], k).toBeTypeOf('function');
  });

  it('keeps every palette key a six-digit hex colour', () => {
    for (const [theme, p] of Object.entries(palettes)) for (const [k, v] of Object.entries(p)) expect(v, `${theme} ${k}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('has a vehicle and a counter pictogram for every kind of work', () => {
    expect([...VEHICLE_KINDS].sort()).toEqual(['data_fix', 'docs', 'issue', 'plan', 'pr']);
  });
});

describe('Command Post: contrast', () => {
  for (const [theme, p] of Object.entries(palettes)) {
    it(`${theme}: every status, ball and CI lamp reads 3:1 on its bezel`, () => {
      const bezel = parse(p.bezel);
      for (const [k, c] of Object.entries({ ...STATE_COLOR, ...BALL_COLOR, ...CI_COLOR })) expect.soft(ratio(parse(c), bezel), `${k} ${c}`).toBeGreaterThanOrEqual(3);
    });

    it(`${theme}: every phase accent reads 3:1 on the ops-board strip`, () => {
      const board = parse(p.opsBoard);
      for (const [k, c] of Object.entries(PHASE_ACCENT)) expect.soft(ratio(parse(c), board), `${k} ${c}`).toBeGreaterThanOrEqual(3);
    });

    it(`${theme}: the bezel and ops board stand out from the terrain`, () => {
      expect(ratio(parse(p.bezel), parse(p.terrain))).toBeGreaterThanOrEqual(theme === 'light' ? 3 : 1.1);
      expect(ratio(parse(p.opsBoard), parse(p.terrain))).toBeGreaterThanOrEqual(theme === 'light' ? 3 : 1.1);
    });
  }

  it('chrome text passes AA on a panel in both themes', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    const root = Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const dark: Record<string, string> = { ...root, ...(commandpost.chrome as Record<string, string>) };
    const light: Record<string, string> = { ...root, ...(LIGHT_CHROME as Record<string, string>), ...(commandpost.chrome as Record<string, string>), ...(commandpost.chromeLight as Record<string, string>) };
    for (const [name, t] of [['dark', dark], ['light', light]] as const) {
      const panel = over(parse(t['--glass']), name === 'dark' ? parse(t['--bg']) : parse('#000000'));
      for (const k of ['--text', '--muted', '--faint']) expect.soft(ratio(parse(t[k]), panel), `${name} ${k}`).toBeGreaterThanOrEqual(4.5);
      // the accent fill carries its own ink
      expect.soft(ratio(parse(t['--accent-ink']), parse(t['--accent'])), `${name} accent ink`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('Command Post: tone', () => {
  // logistics and ops only: none of these may appear in any text the skin draws or shows
  const DENY = /\b(kill|killed|strike|strikes|enemy|enemies|attack|attacks|bomb|bombs|ammo|ammunition|weapon|weapons|gun|guns|rifle|rifles|missile|missiles|rocket|rockets|grenade|grenades|sniper|combat|battle|soldier|soldiers|troops|casualty|casualties|war|warfare|shoot|shooting|fire|firing|target|targets)\b/i;
  const dir = new URL('../src/skins/commandpost/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))) {
    it(`${file}: no combat words in its string literals`, () => {
      const src = readFileSync(new URL(file, dir), 'utf8');
      const literals = [...src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
      for (const s of literals) expect.soft(DENY.test(s), s).toBe(false);
    });
  }
});

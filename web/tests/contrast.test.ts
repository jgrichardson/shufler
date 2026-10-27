import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIGHT_CHROME } from '../src/skins/lightChrome';
import { BALL_COLOR, CI_COLOR, PHASE_ACCENT, STATE_COLOR } from '../src/lib/colors';
import { tone } from '../src/ui/tone';

/*
 * WCAG AA for the chrome's text tokens: 4.5:1 for body text on a panel, in both themes. A panel is --glass
 * composited over the darkest thing behind it (the light theme's worst case is a black scene).
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
const mix = (a: RGB, b: RGB, p: number): RGB => [0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)).concat(1) as RGB;

function lum([r, g, b]: RGB) {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The dark defaults: custom properties in the :root block of styles.css. */
function rootTokens(): Record<string, string> {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  return Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const themes: Record<string, Record<string, string>> = { dark: rootTokens(), light: { ...rootTokens(), ...(LIGHT_CHROME as Record<string, string>) } };

const INKS = ['--text', '--muted', '--faint', '--bad-ink', '--warn-ink', '--ok-ink', '--info-ink', '--violet-ink', '--teal-ink'];

describe('chrome contrast (WCAG AA)', () => {
  for (const [name, t] of Object.entries(themes)) {
    // dark chrome sits over a dark scene; light chrome is checked over black, its worst case
    const panel = over(parse(t['--glass']), name === 'dark' ? parse(t['--bg']) : parse('#000000'));

    it(`${name}: text and status inks reach 4.5:1 on a panel`, () => {
      for (const k of INKS) expect.soft(ratio(parse(t[k]), panel), `${k} ${t[k]}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: palette colours used as text reach 4.5:1 once toned`, () => {
      const p = parseFloat(t['--tone']) / 100;
      const text = parse(t['--text']);
      const all = { ...STATE_COLOR, ...BALL_COLOR, ...CI_COLOR, ...PHASE_ACCENT };
      for (const [k, c] of Object.entries(all)) expect.soft(ratio(mix(parse(c), text, p), panel), `${k} ${c}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: status inks stay readable on their own tinted chip`, () => {
      const alpha = parseFloat(t['--chip-alpha']) / 100;
      const pairs: [string, string][] = [['--me', '--bad-ink'], ['--ok', '--ok-ink'], ['--warn', '--warn-ink']];
      for (const [fill, ink] of pairs) {
        const chip = over([...parse(t[fill]).slice(0, 3), alpha] as RGB, panel);
        expect.soft(ratio(parse(t[ink]), chip), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe('tone()', () => {
  it('mixes a palette colour toward the theme text by --tone', () => {
    expect(tone('#e74c3c')).toBe('color-mix(in srgb, #e74c3c var(--tone), var(--text))');
  });
});

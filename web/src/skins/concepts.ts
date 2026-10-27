import type { Skin } from './types';

/*
 * Dev-only backdrop concepts (design/skins/BACKDROP_RESEARCH.md), for comparing directions side by side:
 * ?concept=<id> patches the Factory skin (and Starship where the concept fits) at registration, and
 * ConceptBackdrop draws the concept's extra geometry. Production builds never read the parameter.
 */

export type ConceptKind = 'horizon' | 'paper' | 'ridges' | 'glow' | 'studio';

export interface ConceptTheme {
  skyTop: string;
  horizon: string;
  /** Below the board: the ground, table, floor or mist it floats over. */
  ground: string;
  fog: string;
  board: string;
  rail: string;
  accent: string;
  hemiSky: string;
  hemiGround: string;
  key: string;
  /** Concept-specific extras: ridge tones, table edge, glow colours, cyclorama wall. */
  extra: Record<string, string>;
}

export interface Concept {
  id: ConceptKind;
  name: string;
  idea: string;
  starship: boolean;
  dark: ConceptTheme;
  light: ConceptTheme;
}

export const CONCEPTS: Concept[] = [
  {
    id: 'horizon',
    name: 'Quiet Horizon',
    idea: 'One smooth sky gradient meeting a haze band at eye level; the board floats over a soft shadow disc.',
    starship: true,
    dark: {
      skyTop: '#1d2233',
      horizon: '#3a3446',
      ground: '#2b2a38',
      fog: '#3a3446',
      board: '#4a4254',
      rail: '#8a7f94',
      accent: '#e0a070',
      hemiSky: '#8f9bd0',
      hemiGround: '#3a3040',
      key: '#ffcf9e',
      extra: {},
    },
    light: {
      skyTop: '#cfdcec',
      horizon: '#f1e6dc',
      ground: '#dcd2cc',
      fog: '#f1e6dc',
      board: '#efe6de',
      rail: '#9a8f86',
      accent: '#c4642e',
      hemiSky: '#f4f8ff',
      hemiGround: '#cbb9ad',
      key: '#fff0dc',
      extra: {},
    },
  },
  {
    id: 'paper',
    name: 'Paper Diorama',
    idea: 'The board as a cut-paper model on a big matte tabletop: no sky, a soft drop shadow and a vignette to the table edge.',
    starship: false,
    dark: {
      skyTop: '#201c19',
      horizon: '#201c19',
      ground: '#2a2622',
      fog: '#201c19',
      board: '#4a4038',
      rail: '#a39382',
      accent: '#d98a4a',
      hemiSky: '#d6c4b0',
      hemiGround: '#2a2622',
      key: '#ffd9b0',
      extra: { tableEdge: '#1b1816' },
    },
    light: {
      skyTop: '#ddd1c0',
      horizon: '#ddd1c0',
      ground: '#e9dfd0',
      fog: '#ddd1c0',
      board: '#f7f1e6',
      rail: '#8f8272',
      accent: '#b8572a',
      hemiSky: '#fff8ec',
      hemiGround: '#cdbfac',
      key: '#fff1d8',
      extra: { tableEdge: '#cdbfac' },
    },
  },
  {
    id: 'ridges',
    name: 'Misty Valley',
    idea: 'Three low, soft ridgelines ring the board, each lighter than the last, dissolving into fog.',
    starship: true,
    dark: {
      skyTop: '#20263a',
      horizon: '#4a4a5e',
      ground: '#2a2c3d',
      fog: '#464a5e',
      board: '#4d4858',
      rail: '#8c8798',
      accent: '#e2a273',
      hemiSky: '#9aa6d8',
      hemiGround: '#2c2c3c',
      key: '#ffd2a6',
      extra: { ridgeFar: '#3d4055', ridgeMid: '#33364a', ridgeNear: '#2a2c3d' },
    },
    light: {
      skyTop: '#bccbe0',
      horizon: '#ece4da',
      ground: '#b2bac9',
      fog: '#e6e0d8',
      board: '#f3ece3',
      rail: '#8e8a88',
      accent: '#bd6a38',
      hemiSky: '#f0f6ff',
      hemiGround: '#bcc4b4',
      key: '#fff3e0',
      extra: { ridgeFar: '#d4d8df', ridgeMid: '#c4cad6', ridgeNear: '#b2bac9' },
    },
  },
  {
    id: 'glow',
    name: 'Night City Glow',
    idea: 'The board floats over a faint, out-of-focus warm glow far below; by day, a pale dawn haze.',
    starship: true,
    dark: {
      skyTop: '#0f1220',
      horizon: '#1e2036',
      ground: '#14162a',
      fog: '#191b2e',
      board: '#3b3a52',
      rail: '#7f7e9e',
      accent: '#f0b070',
      hemiSky: '#7f8ccc',
      hemiGround: '#3a2a3a',
      key: '#ffc890',
      extra: { glowA: '#5a3d4c', glowB: '#7a5040' },
    },
    light: {
      skyTop: '#d9dff0',
      horizon: '#f6e8e0',
      ground: '#ddd5d8',
      fog: '#f0e4de',
      board: '#f4eeea',
      rail: '#938a92',
      accent: '#c26a3a',
      hemiSky: '#f2f4ff',
      hemiGround: '#d4c2c0',
      key: '#fff0e0',
      extra: { glowA: '#f1d3c0', glowB: '#ead0c4' },
    },
  },
  {
    id: 'studio',
    name: 'Studio Product Shot',
    idea: 'A seamless cyclorama: no horizon, a soft floor curving into the wall, the board lit like a product.',
    starship: true,
    dark: {
      skyTop: '#23252b',
      horizon: '#23252b',
      ground: '#2c2f36',
      fog: '#26282e',
      board: '#454a54',
      rail: '#8b929e',
      accent: '#6fb3e0',
      hemiSky: '#c8d4e8',
      hemiGround: '#2c2f36',
      key: '#e8f0ff',
      extra: { wall: '#23252b' },
    },
    light: {
      skyTop: '#eef0f3',
      horizon: '#eef0f3',
      ground: '#e4e7ec',
      fog: '#eceef2',
      board: '#ffffff',
      rail: '#8a929e',
      accent: '#2f7fbf',
      hemiSky: '#ffffff',
      hemiGround: '#dfe3e9',
      key: '#fffaf2',
      extra: { wall: '#eef0f3' },
    },
  },
];

const requested = import.meta.env.DEV && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('concept') : null;
/** The concept in the URL, dev builds only. */
export const CONCEPT: Concept | null = CONCEPTS.find((c) => c.id === requested) ?? null;

/** Board centre in world units, for the concept geometry. */
export const BOARD_C: [number, number, number] = [25, 0, -55];

const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i] - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

const fog = (t: ConceptTheme) => ({ color: t.fog, near: 380, far: 1100 });

function factoryKeys(t: ConceptTheme) {
  return {
    skyZenith: t.skyTop,
    skyUpper: mix(t.skyTop, t.horizon, 0.5),
    skyHorizon: t.horizon,
    skyBelow: t.ground,
    // no sun disc: concepts keep the backdrop flat
    sun: '#000000',
    fog: t.fog,
    hemiSky: t.hemiSky,
    hemiGround: t.hemiGround,
    sunLight: t.key,
    bandLight: t.board,
    bandDark: mix(t.board, t.rail, 0.18),
    rail: t.rail,
  };
}

function starshipKeys(t: ConceptTheme) {
  return { spaceZenith: t.skyTop, spaceUpper: mix(t.skyTop, t.horizon, 0.5), spaceHorizon: t.horizon, spaceBelow: t.ground, nebula: '#000000', fog: t.fog };
}

/** The skins with the active concept laid over them (dev only); unchanged without one. */
export function withConcept(skins: Skin[]): Skin[] {
  const c = CONCEPT;
  if (!c) return skins;
  return skins.map((s) => {
    const keys = s.id === 'factory' ? factoryKeys : s.id === 'starship' && c.starship ? starshipKeys : null;
    if (!keys) return s;
    return {
      ...s,
      scene: { ...s.scene, background: c.dark.fog, fog: fog(c.dark) },
      sceneLight: { ...s.sceneLight, background: c.light.fog, fog: fog(c.light) },
      palette: { ...s.palette, ...keys(c.dark) },
      paletteLight: { ...s.paletteLight, ...keys(c.light) },
    } as Skin;
  });
}

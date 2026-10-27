/**
 * Theme Park colours. Every key can be overridden by a JSON recolour (`"extends": "themepark"`).
 * Dark mode is the park at night: an indigo sky, warm string lights and lit rides. Light mode is golden hour.
 * Domain, phase and status colours are not here: they carry meaning and stay the same in every skin.
 */
export const PARK = {
  // sky dome and fog
  skyZenith: '#070b1f',
  skyUpper: '#141b3d',
  skyHorizon: '#3b2c4c',
  /** Warm glow the park throws up into the haze at the horizon. */
  skyGlow: '#a8645a',
  /** Moon at night, sun by day. */
  sun: '#f4f1ff',
  stars: '#dfe6ff',
  fog: '#2a2340',
  // lights
  sunLight: '#b9c6ff',
  hemiSky: '#6c76b8',
  hemiGround: '#5a3f34',
  /** Warm fill from the park's lamps, low from the front. */
  fillLight: '#ffb070',
  // ground and plazas
  lawn: '#4c6a3e',
  lawnFar: '#2f3d2c',
  paving: '#b9a48c',
  pavingDark: '#8e7a66',
  curb: '#d8cbb8',
  path: '#a8907a',
  hedge: '#2f5130',
  trunk: '#4a3528',
  // track and steel
  steel: '#c9ccd4',
  steelDark: '#4c5160',
  support: '#e9e3d8',
  tie: '#3b3f4a',
  chain: '#2a2c33',
  // stations, pavilions and signs
  plank: '#b48a64',
  canopy: '#f3ebdd',
  trim: '#f6efe2',
  stucco: '#efe3cf',
  roofDark: '#5b4f6c',
  gold: '#e8b85c',
  window: '#ffc77a',
  windowOff: '#3b3340',
  /** Warm bulb colour for string lights, marquee bulbs and lanterns. */
  bulb: '#ffcf86',
  beam: '#ffe2b0',
  // cars
  seat: '#2c2a33',
  carTrim: '#f2ece2',
  // gift shop
  shopWall: '#efe0c8',
  shopRoof: '#b85a4e',
  awning: '#f6efe2',
  ribbon: '#f7e7c4',
  deployBeam: '#ffc861',
  // skyline
  wheelFrame: '#e9e3d8',
  wheelCab: '#d77b5c',
  silhouette: '#2a2540',
  treeFar: '#28352b',
};
export type ParkPalette = typeof PARK;

/** Light mode: golden hour, a clear sky warming to amber at the horizon and a low sun in the west. */
export const PARK_LIGHT = {
  skyZenith: '#4f7fc4',
  skyUpper: '#93b5df',
  skyHorizon: '#f7d9b0',
  skyGlow: '#ffc27a',
  sun: '#fff1d6',
  fog: '#e9d6bf',
  sunLight: '#ffd6a0',
  hemiSky: '#cfe0ff',
  hemiGround: '#a08a6e',
  fillLight: '#ffe2c0',
  lawn: '#a9c873',
  lawnFar: '#a6ad78',
  paving: '#e2d2bc',
  pavingDark: '#c9b59c',
  hedge: '#456e3b',
  silhouette: '#eadbc6',
  treeFar: '#8c9a6e',
} satisfies Partial<ParkPalette>;

/**
 * Factory colours: the original warm sunset sky city. Every key can be overridden by a JSON recolour
 * (`"extends": "factory"`).
 */
export const FACTORY = {
  // sky dome and fog
  // Quiet Horizon (design/skins/BACKDROP_RESEARCH.md): a dusk gradient into a haze band, no clouds
  skyZenith: '#1d2233',
  skyUpper: '#2b2b3d',
  skyHorizon: '#3a3446',
  skyBelow: '#2b2a38',
  /** Only a faint warm halo; no sun disc. */
  sun: '#3a2e2a',
  /** Matches the horizon, so distant parts dissolve into the sky. */
  fog: '#3a3446',
  // lights
  hemiSky: '#8f9bd0',
  hemiGround: '#3a3040',
  ambient: '#ffd9c0',
  sunLight: '#ffcf9e',
  fillLight: '#b8c4ff',
  // islands
  grass: '#9cc471',
  grassDark: '#86b05e',
  rim: '#b4876a',
  rock: '#8d6f8c',
  rockDark: '#6f5675',
  road: '#4a4b55',
  roadLine: '#f2e6cf',
  plaza: '#e3d6c2',
  concrete: '#efe7dc',
  lampPost: '#3d3a44',
  trunk: '#6b4a3a',
  tower: '#efe4d2',
  towerMast: '#4a4550',
  // sessions
  sessionPlate: '#d9cdb9',
  shutterTint: '#9a929c',
  closedTint: '#3a363e',
  shutter: '#6d6470',
  roofBox: '#cfc7bd',
  mast: '#5a5560',
  // landmarks
  stone: '#f1e7d8',
  stoneDark: '#d7c7b2',
  roofRed: '#a8584a',
  roofSlate: '#6d6584',
  steel: '#e0a53c',
  steelDark: '#5e5a66',
  wood: '#9a6b4f',
  glass: '#bfe3ef',
  // skyway
  deck: '#9a8c9c',
  rail: '#8a7f94',
  bandLight: '#4a4254',
  bandDark: '#544b5e',
  bridge: '#6f6370',
  // pods and crates
  podGlass: '#2b3448',
  podSpine: '#3b3036',
  podHoop: '#f4efe6',
  podPole: '#4a4550',
  podRing: '#5a4a40',
  kraft: '#c99a68',
  // warehouse
  whSlab: '#efe6d8',
  whWall: '#f1dcc1',
  whTrim: '#fbf4ea',
  whRoof: '#cf8c6c',
  whGlazing: '#ffe2b0',
  whGlazingGlow: '#ffc46b',
  whGlow: '#ffd48a',
  whShelf: '#d9c2a2',
  whSteel: '#5b5560',
  whRoller: '#cfc8cf',
  whDoor: '#f0a35e',
  whDoorPanel: '#e7ddd0',
  whRamp: '#efe7dc',
  deployBeam: '#ffc861',
  // library
  libraryDome: '#7fa596',
};
export type FactoryPalette = typeof FACTORY;

/** Session wall and roof colours, picked by the session's palette index. */
export const BUILDING_PALETTE = ['#efd9b4', '#e39b78', '#d8c6b4', '#f0c08f', '#b9c8d4', '#e7b7a0'];
export const ROOF_PALETTE = ['#a8584a', '#7a6a8c', '#8f5d4a', '#5f6f86', '#9a6b4f', '#6d7b6a'];

/** Filler town houses and trees on the islands. */
export const HOUSE_WALLS = ['#f1e2c8', '#e8c6a6', '#dcd0c2', '#f2d2b0', '#e6b9a2', '#cfd6dc'];
export const HOUSE_ROOFS = ['#b0614f', '#8a6f86', '#9b6a52', '#6f7f95', '#a5745a'];
export const TREE_GREENS = ['#4f8a4b', '#5e9a52', '#3f7a48', '#6aa65a', '#7aa84f'];

/** Window glow as linear RGB, above 1.0 so bloom picks up lit windows. */
export const WINDOW_LIT = [1.0 * 2.2, 0.78 * 2.2, 0.45 * 2.2] as const;
export const WINDOW_DIM = [1.0 * 1.05, 0.8 * 1.05, 0.5 * 1.05] as const;
export const WINDOW_OFF = [0.22, 0.25, 0.33] as const;

/** Light mode: Quiet Horizon by day, a pale blue sky into a warm haze. */
export const FACTORY_LIGHT = {
  skyZenith: '#cfdcec',
  skyUpper: '#e0e1e4',
  skyHorizon: '#f1e6dc',
  skyBelow: '#dcd2cc',
  sun: '#3a332a',
  fog: '#f1e6dc',
  hemiSky: '#f4f8ff',
  hemiGround: '#cbb9ad',
  ambient: '#ffffff',
  sunLight: '#fff0dc',
  fillLight: '#bcd3ff',
  rock: '#a89486',
  rockDark: '#85736a',
  rim: '#a5876e',
  deck: '#737c89',
  rail: '#9a8f86',
  bandLight: '#efe6de',
  bandDark: '#e3d8ce',
  bridge: '#56606d',
} satisfies Partial<FactoryPalette>;

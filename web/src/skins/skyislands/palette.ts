/**
 * Sky Islands colours. Every key can be overridden by a JSON recolour (`"extends": "skyislands"`).
 * Dark mode is dusk: a low warm sun behind the board, cool violet shadows and a cloud sea far below.
 */
export const SKY = {
  // sky dome, cloud sea and fog
  skyZenith: '#3c3f6e',
  skyUpper: '#9a7a9e',
  skyHorizon: '#f2a676',
  /** Bright band right at the horizon under the sun. */
  skyGlow: '#ffd29a',
  sun: '#fff0c8',
  cloudLit: '#ffd9b2',
  cloudShade: '#bc96a0',
  cloudDeep: '#7c6688',
  /** Matches the sky just above the horizon, so distant islands dissolve into the haze. */
  fog: '#c99486',
  /** Height haze that swallows the bottoms of the islands, the colour of the cloud sea. */
  haze: '#bf9aa6',
  // lights
  sunLight: '#ffc890',
  hemiSky: '#c4a6cf',
  hemiGround: '#7a5048',
  // islands
  grass: '#c4c274',
  grassLip: '#7d8a43',
  rockTop: '#e2b596',
  rockBottom: '#86708a',
  foliage: '#3f5a2c',
  foliageLit: '#b0a64c',
  trunk: '#5a3f2e',
  boulder: '#9c8a86',
  // towers
  stone: '#f2d6bc',
  stoneDark: '#b89c8a',
  slate: '#8a84a8',
  window: '#ffb35c',
  windowAlt: '#b78cff',
  windowCool: '#7fb6ff',
  windowOff: '#4a3430',
  door: '#3a2a24',
  beam: '#ffe2b0',
  // bridges, track and wood
  plank: '#b88a62',
  /** Factory's lane deck in this skin: warm planks, not the lavender floor. */
  deck: '#b88a62',
  plankDark: '#6e4f3c',
  iron: '#3d3a42',
  rope: '#8a6c50',
  // pods
  podRoof: '#4a3a36',
  podGlass: '#ffcf8a',
  wheel: '#2c2a30',
  // warehouse
  whWall: '#a77b58',
  whRoof: '#5d5a72',
  lantern: '#ffbf6a',
};
export type SkyPalette = typeof SKY;

/** Light mode: a bright late afternoon, blue sky over a pale cloud sea, sun higher and to the side. */
export const SKY_LIGHT = {
  skyZenith: '#5d8fd0',
  skyUpper: '#9cc2ea',
  skyHorizon: '#f3dcc0',
  skyGlow: '#fff1d8',
  sun: '#fff8e8',
  cloudLit: '#fbf3ea',
  cloudShade: '#aeb9d4',
  cloudDeep: '#8796b8',
  fog: '#d9dfe8',
  haze: '#dfe4ee',
  sunLight: '#fff1dc',
  hemiSky: '#cfe0ff',
  hemiGround: '#8a7a6e',
  rockTop: '#c8ad94',
  rockBottom: '#7f7890',
  grass: '#9cb85a',
  grassLip: '#7f9a45',
  foliage: '#4f7a38',
  foliageLit: '#a8be58',
  window: '#ffb35c',
  beam: '#fff4dc',
} satisfies Partial<SkyPalette>;

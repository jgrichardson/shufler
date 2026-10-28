/**
 * Command Post colours. Every key can be overridden by a JSON recolour (`"extends": "commandpost"`).
 * Dark mode, "Night Watch", is the field base after dark: a blue-black sky with stars and a thin moon,
 * warm floodlight pools on the compounds, teal plotting screens and blue runway lights on the horizon.
 * Light mode, "Daylight Exercise", is midday over the sand table: khaki terrain, olive paint, cream stencils
 * and a dusty blue sky. Domain, phase and status colours are not here: they carry meaning and stay the same
 * in every skin. Status lamps always sit in a dark `bezel`, and phase accents on a dark `opsBoard` strip,
 * because neither reads on sand.
 */
export const COMMAND = {
  // sky and air
  background: '#0b0d09',
  fog: '#10130d',
  skyZenith: '#070a12',
  skyHorizon: '#1b2230',
  // the map
  terrain: '#30331f',
  terrainAlt: '#383c2b',
  /** Map grid squares and contour lines, drawn at low alpha over the terrain. */
  gridLine: '#6f6c52',
  /** Far mesas, fading into the haze. */
  mesa: '#262a20',
  road: '#4a4538',
  roadLine: '#d9cfae',
  // paint and cloth
  olive: '#4b5320',
  oliveDark: '#2f3416',
  khaki: '#8a7f5c',
  canvasTent: '#6f6a47',
  netting: '#3f4a2c',
  steel: '#5d6364',
  tyre: '#1e1f1c',
  timber: '#6b5638',
  // lettering
  /** Stencil paint on olive. */
  stencil: '#efe7cf',
  /** Stencil paint on khaki and sand. */
  stencilInk: '#1f2414',
  // readability
  /** Dark surround for every status, ball and review lamp. */
  bezel: '#1d2016',
  /** The dark painted strips the phase accents sit on. */
  opsBoard: '#22261a',
  concrete: '#4a4840',
  // lights
  floodLamp: '#ffcf8a',
  screen: '#7fe0c2',
  runwayLight: '#8fb6ff',
  /** The tall mast's strobe on the skyline: white, never red (red means "you"). */
  strobe: '#f4f6ff',
  keyLight: '#c9d6ff',
  hemiSky: '#2a3550',
  hemiGround: '#15170f',
  fillLight: '#ffb874',
  window: '#ffd59a',
  cloud: '#2a3040',
};
export type CommandPalette = typeof COMMAND;

/** Light mode: midday over the sand table. */
export const COMMAND_LIGHT = {
  background: '#e3e2d3',
  fog: '#e6dfc8',
  skyZenith: '#9fb4c2',
  skyHorizon: '#e8dfc6',
  terrain: '#cdbf98',
  terrainAlt: '#bfae84',
  gridLine: '#8e7f5c',
  mesa: '#c9b48a',
  road: '#8f7f5e',
  roadLine: '#f4eedb',
  olive: '#5b6332',
  oliveDark: '#434a22',
  khaki: '#c3b091',
  canvasTent: '#a39a6c',
  netting: '#7d8650',
  steel: '#8b9192',
  tyre: '#262722',
  timber: '#8a6d45',
  opsBoard: '#2b2e20',
  concrete: '#a29e90',
  floodLamp: '#fff3dc',
  screen: '#4fb79a',
  keyLight: '#fff4df',
  hemiSky: '#e9eef2',
  hemiGround: '#a8946a',
  fillLight: '#ffe9c8',
  window: '#e8e2c8',
  cloud: '#f7f4ea',
} satisfies Partial<CommandPalette>;

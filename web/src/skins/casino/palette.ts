/**
 * Casino colours. Every key can be overridden by a JSON recolour (`"extends": "casino"`).
 * Dark mode is the gaming floor after hours: low warm light, pools of light on the felt, a glow of slot
 * machines at the walls. Light mode is a daytime salon: cream walls, gold leaf and soft daylight.
 * Domain, phase and status colours are not here: they carry meaning and stay the same in every skin.
 */
export const CASINO = {
  // room
  background: '#0d0907',
  fog: '#140d0a',
  /** Far walls and the ceiling haze above them. */
  wall: '#2a1a14',
  wallPanel: '#3a241a',
  pilaster: '#4a2f22',
  // lights
  keyLight: '#ffd9a8',
  hemiSky: '#8a6a52',
  hemiGround: '#2a1610',
  fillLight: '#ffb36b',
  /** Warm bokeh and lamp glow. */
  bokeh: '#ffc27a',
  bokehAlt: '#ff8f6b',
  // floor
  carpet: '#3b0f14',
  carpetMotif: '#b8893c',
  carpetAccent: '#1d4a45',
  lowerFloor: '#2a0b0f',
  // tables
  felt: '#0f5a3b',
  /** Printed lines on the felt. */
  feltPrint: '#d8b867',
  wood: '#5a3020',
  woodDark: '#2c160e',
  brass: '#c9a24a',
  // cards and chips
  ivory: '#fbf6ea',
  cardEdge: '#efe8d8',
  ink: '#1b1a20',
  cardRed: '#c3262f',
  chipEdge: '#f6efe0',
  // signage and slot machines
  signPanel: '#140c0a',
  signGold: '#e2c27a',
  slotBody: '#2b1d24',
  slotScreen: '#ffcf8a',
  slotGlowA: '#ff6f61',
  slotGlowB: '#ffc75e',
  slotGlowC: '#5ad1c9',
  /** The cashier's floor and counters: dark green-black marble at night, cream by day. */
  marble: '#2e3a33',
  deployBeam: '#ffd36b',
};
export type CasinoPalette = typeof CASINO;

/** Light mode: a daytime salon. Cream walls, a pale rug, a brighter felt, gold leaf and soft daylight. */
export const CASINO_LIGHT = {
  background: '#efe6d6',
  fog: '#efe4d2',
  wall: '#efe4d0',
  wallPanel: '#e6d6ba',
  pilaster: '#f6eedf',
  keyLight: '#fff3e0',
  hemiSky: '#fff7ea',
  hemiGround: '#b9a07a',
  fillLight: '#fff0d8',
  bokeh: '#fff1d0',
  bokehAlt: '#ffe2b8',
  carpet: '#e9dcc2',
  carpetMotif: '#c9a75c',
  carpetAccent: '#a7b9a2',
  lowerFloor: '#d9c7a6',
  felt: '#1f7a50',
  feltPrint: '#ecd28c',
  wood: '#7a4a2c',
  woodDark: '#4a2a18',
  signPanel: '#1c3b2e',
  slotBody: '#5a4048',
  marble: '#f3ece0',
} satisfies Partial<CasinoPalette>;

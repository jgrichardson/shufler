/** Starship colours. Every key can be overridden by a JSON recolour (`"extends": "starship"`). */
export const STARSHIP = {
  spaceZenith: '#020409',
  spaceUpper: '#050913',
  spaceHorizon: '#0c1526',
  spaceBelow: '#04070d',
  nebula: '#1b2c52',
  fog: '#070c17',
  /** Lacquered hull, and the pale end of the session hull range. */
  hull: '#dfe3e9',
  hullPale: '#c7cfd9',
  titanium: '#8d96a3',
  graphite: '#20252d',
  graphiteDeep: '#14181e',
  glass: '#0a111c',
  /** Cargo bay roof. */
  roof: '#20252d',
  /** Neutral light strips, nav lights, lit windows. */
  light: '#9fd8ff',
  beacon: '#ff4d3d',
  sun: '#f2f5ff',
  planetShine: '#5f9dff',
  planetOcean: '#05122a',
  planetLand: '#121716',
  planetAtmosphere: '#4d99ff',
  cityLights: '#ffb866',
};
export type StarshipPalette = typeof STARSHIP;

/** Light mode: the station on the day side, under a pale sky-blue haze, with the planet bright below. */
export const STARSHIP_LIGHT = {
  spaceZenith: '#7fb0e0',
  spaceUpper: '#b5d3ef',
  spaceHorizon: '#e6f0fa',
  spaceBelow: '#d2e3f3',
  nebula: '#ffffff',
  fog: '#d9e7f4',
  // a touch below white so sunlit hull keeps its form instead of blowing out
  hull: '#d2d9e2',
  hullPale: '#bac4d0',
  graphite: '#7f8b9c',
  graphiteDeep: '#646f7f',
  glass: '#46627f',
  roof: '#c3ccd7',
  light: '#2f9ef0',
  planetShine: '#cfe4ff',
  planetOcean: '#2f76c2',
  planetLand: '#9fbb7a',
  planetAtmosphere: '#e8f4ff',
} satisfies Partial<StarshipPalette>;

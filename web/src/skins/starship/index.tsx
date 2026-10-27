import { defineSkin } from '../api';
import { Backdrop } from './Backdrop';
import { Platform, Island } from './Island';
import { Session } from './Session';
import { Landmark } from './Landmark';
import { Lane, Ramp, DistrictBand } from './Board';
import { PodBody, Crate } from './PodBody';
import { WarehouseShell, Rack, Dock } from './Warehouse';
import { Library } from './Library';
import { STARSHIP, STARSHIP_LIGHT } from './palette';

/** Modern starship station: lacquered white hulls, graphite, titanium and smoked glass over a planet. */
export default defineSkin({
  id: 'starship',
  name: 'Starship',
  description: 'A sleek station in orbit: lacquered hull modules, graphite decks and ice-blue light over a planet.',
  author: 'Shufler',
  version: '1.0.0',
  scene: {
    background: STARSHIP.spaceHorizon,
    fog: { color: STARSHIP.fog, near: 700, far: 1800 },
    toneMapping: 'aces',
    exposure: 1.0,
    fx: {
      ao: { radius: 3, intensity: 2.2 },
      bloom: { intensity: 0.85, threshold: 1.0, radius: 0.6 },
      vignette: { offset: 0.3, darkness: 0.55 },
    },
    dim: { tint: '#3d4552', amount: 0.85, darken: 0.55, glow: 0.18 },
  },
  sceneLight: {
    background: STARSHIP_LIGHT.spaceHorizon,
    fog: { color: STARSHIP_LIGHT.fog, near: 650, far: 1700 },
    exposure: 1.0,
    fx: {
      ao: { radius: 3, intensity: 1.6 },
      bloom: { intensity: 0.4, threshold: 1.1, radius: 0.55 },
      vignette: { offset: 0.35, darkness: 0.2 },
    },
    dim: { tint: '#cfd8e3', amount: 0.75, darken: 1.05, glow: 0.35 },
    beams: { additive: false, intensity: 1 },
    ring: '#1b74b8',
  },
  chrome: {
    '--bg': '#04070d',
    '--glass': 'rgba(9, 13, 21, 0.78)',
    '--glass-strong': 'rgba(7, 10, 17, 0.88)',
    '--glass-border': 'rgba(170, 205, 255, 0.13)',
    '--text': '#e8eef6',
    '--muted': '#a9b6c6',
    '--faint': '#7f8b9b',
    '--accent': '#8fd3ff',
    '--accent-ink': '#06121f',
    '--accent-hi': '#c4e9ff',
    '--accent-lo': '#7cc4f2',
    '--accent-light': '#aad7ff',
    '--panel': '#090d15',
    '--panel-hi': '#101622',
    '--shade': '#00040c',
    '--surface': '#121823',
    '--surface-2': '#0c1018',
    '--surface-3': '#080b10',
    '--ink-hi': '#eef5ff',
    '--paper': '#f2f6fb',
    '--ink-muted': '#5b6573',
    '--accent-border': '#d2eeff',
    '--soft-1': '#c9d6e6',
    '--soft-2': '#ccd6e2',
    '--loading': '#8fa3bd',
    '--term-bg': '#080b12',
    '--orb': 'radial-gradient(circle at 35% 35%, #ffffff, #8fd3ff 50%, #2f6fa8)',
  },
  palette: STARSHIP,
  paletteLight: STARSHIP_LIGHT,
  components: { Backdrop, Platform, Island, Session, Landmark, Lane, Ramp, DistrictBand, PodBody, Crate, WarehouseShell, Rack, Dock, Library },
});

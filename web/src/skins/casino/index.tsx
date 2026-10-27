import { extendSkin } from '../api';
import factory from '../factory';
import { Backdrop } from './Backdrop';
import { Platform, Island } from './Island';
import { Session } from './Session';
import { Landmark, LANDMARK_SCALE } from './Landmark';
import { Lane, Ramp, DistrictBand } from './Table';
import { PodBody, Crate } from './PodBody';
import { WarehouseShell, Rack, Dock } from './Warehouse';
import { Library } from './Library';
import { CASINO, CASINO_LIGHT } from './palette';

/**
 * Casino: each row is a long green-felt card table with a leather rail in its colour, work items are
 * playing cards dealt along the felt (face down in the overview, face up close in, a red joker when the
 * call is yours), sessions are slot machines on their row's dais, each phase has its casino landmark,
 * shipped work is cashed out as chip stacks at the cashier's cage, and the context library is the dealing
 * shoe. After hours by night, a daylit salon by day. Textures and the day HDRI are CC0 (see ASSETS.md).
 */
export default extendSkin(factory, {
  id: 'casino',
  name: 'Casino',
  description: 'A card room: felt tables for rows, playing cards for work items, slot machines for sessions, a cashier for shipped work.',
  author: 'Shufler',
  version: '0.1.0',
  scene: {
    background: CASINO.background,
    fog: { color: CASINO.fog, near: 330, far: 1100 },
    toneMapping: 'aces',
    exposure: 1.1,
    fx: {
      ao: { radius: 2.0, intensity: 1.6 },
      bloom: { intensity: 0.7, threshold: 1.0, radius: 0.6 },
      vignette: { offset: 0.3, darkness: 0.6 },
    },
    dim: { tint: '#3a2e2a', amount: 0.75, darken: 0.6, glow: 0.25 },
    landmarkScale: LANDMARK_SCALE,
    ring: '#f3dc9a',
  },
  sceneLight: {
    background: CASINO_LIGHT.background,
    fog: { color: CASINO_LIGHT.fog, near: 360, far: 1300 },
    exposure: 1.0,
    fx: {
      ao: { radius: 2.0, intensity: 1.4 },
      bloom: { intensity: 0.3, threshold: 1.1, radius: 0.6 },
      vignette: { offset: 0.35, darkness: 0.2 },
    },
    dim: { tint: '#e2d8c6', amount: 0.72, darken: 1.08, glow: 0.4 },
    beams: { additive: false, intensity: 1 },
    ring: '#1d5c40',
  },
  chrome: {
    '--bg': '#120c0a',
    '--glass': 'rgba(18, 13, 11, 0.82)',
    '--glass-strong': 'rgba(14, 10, 9, 0.88)',
    '--glass-border': 'rgba(226, 194, 122, 0.16)',
    '--text': '#f3ece0',
    '--muted': '#cbbfae',
    '--faint': '#a39684',
    '--accent': '#d9b25f',
    '--accent-ink': '#21170a',
    '--accent-hi': '#e7c574',
    '--accent-lo': '#c39a46',
    '--accent-border': '#e9cd88',
    '--accent-light': '#f3dc9a',
    '--panel': '#16100d',
    '--panel-hi': '#2a1f19',
    '--shade': '#0c0806',
    '--surface': '#221813',
    '--surface-2': '#1a120e',
    '--surface-3': '#130d0a',
    '--ink-hi': '#fff8ec',
    '--paper': '#fbf6ea',
    '--ink-muted': '#6b5f55',
    '--soft-1': '#eadfcb',
    '--soft-2': '#e2d8c8',
    '--loading': '#5a4a3a',
    '--term-bg': '#110c0a',
    '--orb': 'radial-gradient(circle at 35% 35%, #f6e2a8, #d9b25f 55%, #8a6a24)',
  },
  /** The felt's green as the accent on the light chrome. */
  chromeLight: {
    '--bg': '#efe6d6',
    '--accent': '#1f6b48',
    '--accent-hi': '#2a8059',
    '--accent-lo': '#185a3c',
    '--accent-border': '#145034',
    '--accent-light': '#145034',
    '--accent-ink': '#ffffff',
  },
  palette: CASINO,
  paletteLight: CASINO_LIGHT,
  components: { Backdrop, Platform, Island, Session, Landmark, Lane, Ramp, DistrictBand, PodBody, Crate, WarehouseShell, Rack, Dock, Library },
});

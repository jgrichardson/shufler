import { defineSkin } from '../api';
import { Backdrop } from './Backdrop';
import { Platform, Island } from './Island';
import { Session } from './Session';
import { Landmark } from './Landmark';
import { Lane, Ramp, DistrictBand } from './Board';
import { PodBody, Crate } from './PodBody';
import { WarehouseShell, Rack, Dock } from './Warehouse';
import { Library } from './Library';
import { FACTORY, FACTORY_LIGHT } from './palette';

/** The original Shufler look: a warm pastel sky city at sunset. */
export default defineSkin({
  id: 'factory',
  name: 'Factory',
  description: 'The original factory in the sky: grass islands, pastel workshops and a warehouse under a quiet horizon.',
  author: 'Shufler',
  version: '1.0.0',
  scene: {
    background: FACTORY.skyHorizon,
    fog: { color: FACTORY.fog, near: 380, far: 1100 },
    toneMapping: 'aces',
    exposure: 1.05,
    fx: {
      ao: false,
      bloom: { intensity: 0.75, threshold: 1.0, radius: 0.7 },
      vignette: { offset: 0.25, darkness: 0.45 },
    },
    dim: { tint: '#7d7480', amount: 0.7, darken: 0.85, glow: 0.3 },
    landmarkScale: 2.1,
  },
  sceneLight: {
    background: FACTORY_LIGHT.skyHorizon,
    fog: { color: FACTORY_LIGHT.fog, near: 380, far: 1100 },
    exposure: 1.0,
    fx: {
      bloom: { intensity: 0.35, threshold: 1.1, radius: 0.6 },
      vignette: { offset: 0.35, darkness: 0.18 },
    },
    dim: { tint: '#d6dee8', amount: 0.72, darken: 1.08, glow: 0.4 },
    beams: { additive: false, intensity: 1 },
    ring: '#1764b5',
  },
  chrome: {
    '--bg': '#3a3446',
    '--glass': 'rgba(24, 20, 30, 0.8)',
    '--glass-strong': 'rgba(20, 18, 28, 0.86)',
    '--glass-border': 'rgba(255, 235, 220, 0.12)',
    '--text': '#f1ece6',
    '--muted': '#c9c1c6',
    '--faint': '#a69ea6',
    '--accent': '#f0a35e',
    '--accent-ink': '#2a1609',
    '--accent-hi': '#f4b06c',
    '--accent-lo': '#e08a48',
    '--accent-border': '#f6b77a',
    '--accent-light': '#ffd6aa',
    '--panel': '#1a1620',
    '--panel-hi': '#302838',
    '--shade': '#28141e',
    '--surface': '#241c22',
    '--surface-2': '#1c1418',
    '--surface-3': '#160f12',
    '--ink-hi': '#fff7ee',
    '--paper': '#fbf6f1',
    '--ink-muted': '#6b5f68',
    '--soft-1': '#e9dccf',
    '--soft-2': '#e2d9d4',
    '--loading': '#5d4a52',
    '--term-bg': '#16121b',
    '--orb': 'radial-gradient(circle at 35% 35%, #ffe0a8, #f0a35e 55%, #c8643a)',
  },
  /** Factory's warm accent on the light chrome. */
  chromeLight: {
    '--bg': '#f1e6dc',
    '--accent': '#b45f1d',
    '--accent-hi': '#d07a35',
    '--accent-lo': '#a3521a',
    '--accent-border': '#93480f',
    '--accent-light': '#8f4511',
    '--accent-ink': '#ffffff',
  },
  palette: FACTORY,
  paletteLight: FACTORY_LIGHT,
  components: { Backdrop, Platform, Island, Session, Landmark, Lane, Ramp, DistrictBand, PodBody, Crate, WarehouseShell, Rack, Dock, Library },
});

import { extendSkin } from '../api';
import factory from '../factory';
import { Backdrop } from './Backdrop';
import { Platform, Island } from './Island';
import { Session } from './Session';
import { Landmark, LANDMARK_SCALE } from './Landmark';
import { Lane, Ramp, DistrictBand } from './Road';
import { PodBody, Crate } from './PodBody';
import { WarehouseShell, Rack, Dock } from './Warehouse';
import { Library } from './Library';
import { COMMAND, COMMAND_LIGHT } from './palette';

/**
 * Command Post: the board is a tactical map that came alive. Rows are compounds on the sand table,
 * sessions are command tents (Codex sessions are ops cabins), work items are a supply convoy on the roads
 * (flat tabletop counters in the overview, a red YOUR MOVE chit when the ball is yours), each stage is a
 * sector with its facility, shipped work lands at the supply depot and close-outs wait at the helipad.
 * Logistics, not combat: no weapons, no insignia. Night Watch by dark, Daylight Exercise by day. All
 * textures and lettering are procedural (see ASSETS.md).
 */
export default extendSkin(factory, {
  id: 'commandpost',
  name: 'Command Post',
  description: 'A field base on a living map: compounds for rows, command tents for sessions, supply convoys for work, a depot and helipad for shipped work.',
  author: 'Shufler',
  version: '0.1.0',
  scene: {
    background: COMMAND.background,
    fog: { color: COMMAND.fog, near: 360, far: 1250 },
    toneMapping: 'aces',
    exposure: 1.2,
    fx: {
      ao: { radius: 2.0, intensity: 1.5 },
      bloom: { intensity: 0.7, threshold: 1.0, radius: 0.6 },
      vignette: { offset: 0.3, darkness: 0.55 },
    },
    dim: { tint: '#2a2d22', amount: 0.78, darken: 0.6, glow: 0.25 },
    landmarkScale: LANDMARK_SCALE,
    ring: '#efe3b8',
  },
  sceneLight: {
    background: COMMAND_LIGHT.background,
    fog: { color: COMMAND_LIGHT.fog, near: 380, far: 1400 },
    exposure: 1.0,
    fx: {
      ao: { radius: 2.0, intensity: 1.3 },
      bloom: { intensity: 0.3, threshold: 1.1, radius: 0.6 },
      vignette: { offset: 0.35, darkness: 0.2 },
    },
    dim: { tint: '#ddd5bd', amount: 0.72, darken: 1.06, glow: 0.4 },
    beams: { additive: false, intensity: 1 },
    ring: '#2f3a17',
  },
  chrome: {
    '--bg': '#0c0e09',
    '--glass': 'rgba(16, 18, 12, 0.84)',
    '--glass-strong': 'rgba(13, 15, 10, 0.9)',
    '--glass-border': 'rgba(216, 196, 138, 0.16)',
    '--text': '#ece8d8',
    '--muted': '#c4bfa8',
    '--faint': '#a19d88',
    '--accent': '#d8c48a',
    '--accent-ink': '#1c1a0e',
    '--accent-hi': '#e6d6a2',
    '--accent-lo': '#c2ad6e',
    '--accent-border': '#e9dcae',
    '--accent-light': '#efe3b8',
    '--panel': '#12140e',
    '--panel-hi': '#22251a',
    '--shade': '#080906',
    '--surface': '#1c1f15',
    '--surface-2': '#15170f',
    '--surface-3': '#0f110b',
    '--ink-hi': '#fbf8ec',
    '--paper': '#f3efdf',
    '--ink-muted': '#5f6050',
    '--soft-1': '#e3dfcb',
    '--soft-2': '#d9d5c2',
    '--loading': '#5b6332',
    '--term-bg': '#0d0f0a',
    '--orb': 'radial-gradient(circle at 35% 35%, #f1e6bf, #d8c48a 55%, #5b6332)',
  },
  /** Olive as the accent on the light chrome: khaki, never the "waiting" amber. */
  chromeLight: {
    '--bg': '#ece6d3',
    '--accent': '#4f5a2a',
    '--accent-hi': '#5f6b34',
    '--accent-lo': '#434c23',
    '--accent-border': '#3d4520',
    '--accent-light': '#3d4520',
    '--accent-ink': '#ffffff',
  },
  palette: COMMAND,
  paletteLight: COMMAND_LIGHT,
  components: { Backdrop, Platform, Island, Session, Landmark, Lane, Ramp, DistrictBand, PodBody, Crate, WarehouseShell, Rack, Dock, Library },
});

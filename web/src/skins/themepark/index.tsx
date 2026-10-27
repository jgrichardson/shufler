import { extendSkin } from '../api';
import factory from '../factory';
import { Backdrop } from './Backdrop';
import { Platform, Island } from './Island';
import { Session } from './Session';
import { Landmark } from './Landmark';
import { Lane, Ramp, DistrictBand } from './Track';
import { PodBody, Crate } from './PodBody';
import { WarehouseShell, Rack, Dock } from './Warehouse';
import { PARK, PARK_LIGHT } from './palette';

/**
 * Theme Park: each row is a themed land with an entrance arch, its work riding a steel coaster through a
 * station per phase, rides behind the columns, and a gift shop where shipped work lands as wrapped boxes.
 * Golden hour by day; at night the string lights and the Ferris wheel come on. Textures and the day HDRI
 * are CC0 (see ASSETS.md). The library is Factory's.
 */
export default extendSkin(factory, {
  id: 'themepark',
  name: 'Theme Park',
  description: 'A park at golden hour or under string lights: coaster track for rows, ride stations for phases, a gift shop for shipped work.',
  author: 'Shufler',
  version: '0.1.0',
  scene: {
    background: PARK.skyHorizon,
    fog: { color: PARK.fog, near: 360, far: 1500 },
    toneMapping: 'aces',
    exposure: 1.15,
    fx: {
      ao: { radius: 2.0, intensity: 1.8 },
      bloom: { intensity: 0.85, threshold: 1.0, radius: 0.6 },
      vignette: { offset: 0.28, darkness: 0.5 },
    },
    dim: { tint: '#5d5870', amount: 0.75, darken: 0.75, glow: 0.3 },
    landmarkScale: 2.0,
  },
  sceneLight: {
    background: PARK_LIGHT.skyHorizon,
    fog: { color: PARK_LIGHT.fog, near: 360, far: 1600 },
    exposure: 1.0,
    fx: {
      ao: { radius: 2.0, intensity: 1.5 },
      bloom: { intensity: 0.35, threshold: 1.1, radius: 0.6 },
      vignette: { offset: 0.35, darkness: 0.2 },
    },
    dim: { tint: '#ddd6cc', amount: 0.72, darken: 1.08, glow: 0.4 },
    beams: { additive: false, intensity: 1 },
    ring: '#1764b5',
  },
  palette: PARK,
  paletteLight: PARK_LIGHT,
  components: { Backdrop, Platform, Island, Session, Landmark, Lane, Ramp, DistrictBand, PodBody, Crate, WarehouseShell, Rack, Dock },
});

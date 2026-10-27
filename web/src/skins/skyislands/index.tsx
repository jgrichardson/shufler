import { extendSkin } from '../api';
import factory from '../factory';
import { Backdrop } from './Backdrop';
import { Platform, Island } from './Island';
import { Session } from './Session';
import { Landmark } from './Landmark';
// Factory's wide plank lanes read better than the prototype's ladder bridges
import { Lane, Ramp, DistrictBand } from '../factory/Board';
import { PodBody, Crate } from './PodBody';
import { WarehouseShell, Rack, Dock } from './Warehouse';
import { SKY, SKY_LIGHT } from './palette';

/**
 * Sky Islands (prototype): each row is a chain of floating rock islands, the session's stone tower on its
 * home island, its work riding Factory's wide plank lanes, a timber warehouse at the end.
 * Textures and HDRI light are CC0 (see ASSETS.md). The library is Factory's for now.
 */
export default extendSkin(factory, {
  id: 'skyislands',
  name: 'Sky Islands',
  description: 'Floating rock islands at dusk: stone towers with glowing windows, plank bridges and rail cars over a sea of clouds.',
  author: 'Shufler',
  version: '0.1.0',
  scene: {
    background: SKY.skyHorizon,
    fog: { color: SKY.fog, near: 320, far: 1500 },
    toneMapping: 'aces',
    exposure: 1.2,
    fx: {
      ao: { radius: 2.2, intensity: 2.0 },
      bloom: { intensity: 0.8, threshold: 1.0, radius: 0.65 },
      vignette: { offset: 0.28, darkness: 0.5 },
    },
    dim: { tint: '#6f6478', amount: 0.75, darken: 0.8, glow: 0.3 },
    landmarkScale: 2.0,
  },
  sceneLight: {
    background: SKY_LIGHT.skyHorizon,
    fog: { color: SKY_LIGHT.fog, near: 300, far: 1600 },
    exposure: 1.0,
    fx: {
      ao: { radius: 2.2, intensity: 1.6 },
      bloom: { intensity: 0.35, threshold: 1.1, radius: 0.6 },
      vignette: { offset: 0.35, darkness: 0.2 },
    },
    dim: { tint: '#d6dee8', amount: 0.72, darken: 1.08, glow: 0.4 },
    beams: { additive: false, intensity: 1 },
    ring: '#1764b5',
  },
  palette: SKY,
  paletteLight: SKY_LIGHT,
  components: { Backdrop, Platform, Island, Session, Landmark, Lane, Ramp, DistrictBand, PodBody, Crate, WarehouseShell, Rack, Dock },
});

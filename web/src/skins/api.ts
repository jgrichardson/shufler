/*
 * The public API for skin authors. A skin should import from here only, so the core can change its
 * internals without breaking skins. See docs/SKINS.md.
 */
export type {
  Skin,
  SkinJson,
  SkinMeta,
  SkinScene,
  SkinFx,
  SkinPalette,
  ChromeTokens,
  SkinComponents,
  PlatformProps,
  IslandProps,
  SessionProps,
  LandmarkProps,
  LaneProps,
  RampProps,
  DistrictBandProps,
  PodKind,
  PodBodyProps,
  CrateProps,
  WarehouseShellProps,
  RackProps,
  DockProps,
  LibraryProps,
} from './types';
export { defineSkin, extendSkin } from './define';
/** useResolvedTheme: 'dark' | 'light', for backdrops that change more than colours between themes. */
export { useSkin, useSkinPalette, useSkinScene, useResolvedTheme } from './store';

/** The core light column (used for sky beams); skins may reuse it for their own effects. */
export { Beam } from '../scene/Beam';
/** Seeded random numbers, so decoration stays put between renders. */
export { rng } from '../scene/layout';
export { RACK_LEN, RACK_DEPTH, SHELF_Y, WAREHOUSE_WALL_H } from '../scene/warehouseLayout';
export { domainDef } from '../lib/domains';
export { PHASE_ACCENT } from '../lib/colors';
/** True when the user asked for reduced motion; skins should calm idle animation. */
export { reducedMotion } from '../ui/motionPrefs';

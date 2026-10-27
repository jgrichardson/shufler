import type { ComponentType, ReactNode } from 'react';
import type { Phase, Station } from '../types';
import type { BuildingShape } from '../scene/Building';
import type { IslandLayout } from '../scene/layout';
import type { Rack, WarehouseGeometry, bayGeometry } from '../scene/warehouseLayout';
import type { DimStyle } from '../scene/materialVariants';

/*
 * The skin contract.
 *
 * The core owns everything that carries meaning: where things sit, what is clickable, how pods travel,
 * status lamps, sky beams, rings, the focus grey-out and the Pipeline fade. A skin owns how things look.
 * Each slot below gets plain data and draws meshes at its local origin; the core positions, scales and
 * wires events around it. A skin never needs to handle selection, dimming or fading itself.
 *
 * Units: one world unit is roughly one metre of model; +y is up; lanes run along +x (left to right through
 * the districts), rows stack along -z. Slots should stay inside the footprints documented per slot so
 * labels, tethers and picking line up.
 */

/** Data-only skin description: what a JSON skin file can set, and what `extendSkin` merges. */
export interface SkinMeta {
  /** Stable id, lowercase, used in ?skin= and settings. */
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
}

export interface SkinFx {
  /** Screen-space ambient occlusion (contact shadows). */
  ao?: { radius: number; intensity: number } | false;
  /** Glow on anything brighter than 1.0 (lamps, light strips). */
  bloom?: { intensity: number; threshold: number; radius: number } | false;
  vignette?: { offset: number; darkness: number } | false;
}

export interface SkinScene {
  /** Clear colour behind the backdrop. */
  background: string;
  fog?: { color: string; near: number; far: number } | null;
  toneMapping?: 'aces' | 'agx' | 'neutral';
  exposure?: number;
  fx?: SkinFx;
  /** How out-of-focus things grey out when the user selects a row, domain, column or item. */
  dim?: Partial<DimStyle>;
  /** Scale applied to the Landmark slot (default 2.5); lower it for wide landmarks so neighbours don't touch. */
  landmarkScale?: number;
  /** The core's sky beams (need-me columns): additive glow suits a dark sky, normal blending a bright one. */
  beams?: { additive?: boolean; intensity?: number };
  /** Colour of the core's selection ring; a bright scene wants a deep colour, a dark one a pale glow. */
  ring?: string;
}

/**
 * CSS custom properties for the 2D chrome (panels, bars, labels). Every key is optional; missing keys
 * fall back to the defaults in styles.css. See docs/SKINS.md for the full token list.
 */
export type ChromeTokens = Partial<Record<`--${string}`, string>>;

/** Free-form colours a skin's own components read through useSkinPalette(); what JSON recolours override. */
export type SkinPalette = Record<string, string>;

export interface PlatformProps {
  radius: number;
  seed: number;
  /** Domain colour for the platform's trim; absent on neutral platforms (command tower, warehouse). */
  rim?: string;
  accent?: string;
  /** x stretch so wide platforms stay inside their row band. */
  stretch?: number;
  /** Close enough to draw small detail (roads, lamps, trim). */
  detail?: boolean;
  children?: ReactNode;
}

export interface IslandProps {
  island: IslandLayout;
  /** Session positions on this island in its local (unstretched) frame, to keep decoration clear of them. */
  buildingLocal: [number, number][];
  detail: boolean;
}

export interface SessionProps {
  station: Station;
  /** Height, width, depth, lit-window fraction and on-hold state, decided by the core from the contract. */
  shape: BuildingShape;
  /** Body height the core expects; the red beam, tethers and labels anchor just above it. */
  height: number;
  /** Status lamp colour (note state, or the stalled colour). */
  lampColor: string;
  active: boolean;
  stalled: boolean;
  /** No Claude process running: no lamp, no lit windows. */
  closed: boolean;
  selected: boolean;
  hovered: boolean;
  detail: boolean;
  /** Stable per-session number for picking among palette variants. */
  paletteIndex: number;
  seed: number;
}

export interface LandmarkProps {
  phase: Exclude<Phase, 'shipped'>;
  accent: string;
  /** The district is selected. */
  active: boolean;
  /** Something live sits in the district. */
  lit: boolean;
}

export interface LaneProps {
  /** Deck runs from x0 to x1 along +x at local y≈0 (top of deck at about -0.25). */
  x0: number;
  x1: number;
  color: string;
  /** x positions for supports under the deck, one per district column. */
  supports: number[];
}

export interface RampProps {
  /** Ramp length along local +x; the core rotates it to climb from the island to the deck. */
  length: number;
  color: string;
}

export interface DistrictBandProps {
  phase: Exclude<Phase, 'shipped'>;
  index: number;
  accent: string;
  /** Band footprint, centred on the column at deck height: width along x, depth along z. */
  width: number;
  depth: number;
  /** x offset of the column's leading edge, where a bridge or marker can sit. */
  edgeX: number;
  active: boolean;
}

export type PodKind = 'pr' | 'issue' | 'data_fix' | 'plan' | 'docs';

export interface PodBodyProps {
  kind: PodKind;
  /** Domain colour, already faded for parked items. */
  hull: string;
  domainColor: string;
  ballColor: string;
  /** Calm overview marker: draw a flat token, not the full body. */
  dot: boolean;
  detail: boolean;
  /** Review-phase gate pips (review bot, CI); colours are given when they should show. */
  pips?: { reviewer: string; ci: string };
}

export interface CrateProps {
  domain: string;
  color: string;
}

export interface WarehouseShellProps {
  g: WarehouseGeometry;
  /** Items deployed this week; skins usually light something when > 0. */
  deployed: number;
  /** The slope from the end of the lanes down to the dock, in world space. */
  ramp: { position: [number, number, number]; rotationZ: number; size: [number, number, number] };
}

export interface RackProps {
  rack: Rack;
  g: WarehouseGeometry;
  color: string;
}

export interface DockProps {
  g: WarehouseGeometry;
  bay: ReturnType<typeof bayGeometry>;
}

export interface LibraryProps {
  /** Items in the context library; skins usually light one volume, slab or window per item, up to what they draw. */
  items: number;
  /** Sessions still owed pinned context; skins usually light a beacon or badge when > 0. */
  owed: number;
  /** The library is selected (its panel is open). */
  active: boolean;
  hovered: boolean;
  /** A library card is being dragged out of the panel. */
  dragging: boolean;
  /** Close enough to draw small detail. */
  detail: boolean;
}

export interface SkinComponents {
  /** Sky, lights, environment map and any scenery. Must provide the scene's lights. */
  Backdrop: ComponentType;
  /** A floating base: row islands and the warehouse stand on one. Radius ≈ footprint; top surface at y=0. */
  Platform: ComponentType<PlatformProps>;
  /** A row island: usually a Platform plus decoration. Drawn at the island centre. */
  Island: ComponentType<IslandProps>;
  /** A session (Claude workspace). Footprint shape.width x shape.depth on the ground at y=0. */
  Session: ComponentType<SessionProps>;
  /** The district landmark behind each column, about 10 x 8 units, drawn at its pad centre. */
  Landmark: ComponentType<LandmarkProps>;
  Lane: ComponentType<LaneProps>;
  Ramp: ComponentType<RampProps>;
  DistrictBand: ComponentType<DistrictBandProps>;
  /** An item on the board. About 2 x 1.4 x 1.2 units, standing on y=0, long axis along x. */
  PodBody: ComponentType<PodBodyProps>;
  /** A shipped crate, 1.25 units on a side, standing on y=0. */
  Crate: ComponentType<CrateProps>;
  WarehouseShell: ComponentType<WarehouseShellProps>;
  /** Rack frame and shelves; drawn at [g.rackFrontX, g.floor, rack.z], running +x for RACK_LEN. */
  Rack: ComponentType<RackProps>;
  /** Loading bay: slab, conveyor and door. World-space, from `bay`. */
  Dock: ComponentType<DockProps>;
  /**
   * Optional: the context library building, back-left of the board beside the district landmarks. Footprint
   * radius about 4.6 and up to about 8.5 tall at its pad centre, front facing +z; the core scales it by 2.5.
   * Skins without one get a generic library.
   */
  Library?: ComponentType<LibraryProps>;
}

export interface Skin extends SkinMeta {
  /** The scene in dark mode (the default). */
  scene: SkinScene;
  /**
   * Light-mode scene, laid over `scene` (fx and dim merge one level deep). Omit it and light mode gets an
   * automatic lift of the dark scene: a little more exposure, softer bloom and vignette, paler grey-out.
   */
  sceneLight?: Partial<SkinScene>;
  /** Chrome tokens in dark mode (the default). */
  chrome: ChromeTokens;
  /** Chrome tokens in light mode, over LIGHT_CHROME; omit to use the shared light chrome as is. */
  chromeLight?: ChromeTokens;
  palette: SkinPalette;
  /** Palette keys that change in light mode (sky, fog, lights, materials), laid over `palette`. */
  paletteLight?: SkinPalette;
  components: SkinComponents;
}

/**
 * A skin as JSON: recolours an existing skin without code. Users can import one in Settings.
 * `extends` names the skin whose geometry it reuses.
 */
export interface SkinJson extends SkinMeta {
  extends: string;
  scene?: Partial<SkinScene>;
  sceneLight?: Partial<SkinScene>;
  chrome?: ChromeTokens;
  chromeLight?: ChromeTokens;
  palette?: SkinPalette;
  paletteLight?: SkinPalette;
}

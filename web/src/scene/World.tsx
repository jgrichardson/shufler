import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useWorld } from '../store';
import type { Station } from '../types';
import { Building } from './Building';
import { Skyway } from './Skyway';
import { Pods } from './Pods';
import { Warehouse } from './Warehouse';
import { Library } from './Library';
import { useLibDrag } from '../ui/library/drag';
import { Rides } from './Conveyor';
import { Tethers, Couriers, TetherPulses } from './Tethers';
import { PlateProjector } from './PlateProjector';
import { StripProjector } from './StripProjector';
import { RowProjector } from './RowProjector';
import { useLayout, useLod, useRedSets } from './useLayout';
import { IslandsDriver, MorphDriver, isPipeline } from './morph';
import { BigIsland } from './BigIsland';
import { Glide } from './Glide';
import type { BuildingLayout } from './layout';
import { MorphFade } from './MorphFade';
import { Dimmable } from './Dimmable';
import { outside, useFocus } from './focus';
import { useSkin } from '../skins/store';
import * as THREE from 'three';
import { useTerminalStation } from '../ui/followCmux';
import { ZOOM_LABEL_PPU, lodFor, pixelsPerUnit, useLayers } from '../ui/layers';

/** Tracks on-screen scale at the camera target and publishes the LOD band (and <body data-zoom> for plate CSS). */
function ZoomLevel() {
  const { camera, controls, size } = useThree();
  const setLod = useLod((s) => s.set);
  useFrame(() => {
    const target = (controls as unknown as { target?: { distanceTo: (v: unknown) => number } } | null)?.target;
    const d = target ? target.distanceTo(camera.position) : 300;
    const ppu = pixelsPerUnit(size.height, d, (camera as THREE.PerspectiveCamera).fov ?? 25);
    const level = lodFor(ppu);
    const zoomed = ppu >= ZOOM_LABEL_PPU;
    const cur = useLod.getState();
    if (cur.lod !== level || cur.zoomed !== zoomed) {
      document.body.dataset.zoom = level;
      document.body.dataset.zoomed = zoomed ? '1' : '0';
      setLod(level, zoomed);
    }
  });
  return null;
}

export function World() {
  const layout = useLayout();
  const snapshot = useWorld((s) => s.snapshot);
  const selection = useWorld((s) => s.selection);
  const hover = useWorld((s) => s.hover);
  const focus = useFocus();
  const { Island } = useSkin().components;
  const lod = useLod((s) => s.lod);
  const zoomed = useLod((s) => s.zoomed);
  const layers = useLayers();
  const pipeline = useWorld((s) => isPipeline(s.preset));
  const red = useRedSets();
  const stationById = useMemo(() => new Map((snapshot?.stations ?? []).map((s) => [s.id, s])), [snapshot?.stations]);
  const liveCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of snapshot?.workpieces ?? []) {
      if (w.phase === 'shipped') continue;
      for (const sid of w.station_ids) m.set(sid, (m.get(sid) ?? 0) + 1);
    }
    return m;
  }, [snapshot?.workpieces]);

  const buildingLocals = useMemo(() => {
    const out = new Map<string, [number, number][]>();
    if (!layout) return out;
    for (const isl of layout.islands) {
      out.set(
        isl.id,
        isl.stationIds
          .map((id) => layout.buildings.get(id))
          .filter((b): b is NonNullable<typeof b> => !!b)
          .map((b) => [(b.pos[0] - isl.center[0]) / isl.stretch, b.pos[2] - isl.center[2]] as [number, number]),
      );
    }
    return out;
  }, [layout]);

  // buildings draw at their own origin; Glide places them, so a layout switch can move them smoothly
  const localBuildings = useMemo(() => {
    const out = new Map<string, BuildingLayout>();
    for (const [id, b] of layout?.buildings ?? []) out.set(id, { ...b, pos: [0, 0, 0], scale: 1 });
    return out;
  }, [layout]);

  const terminalStation = useTerminalStation();
  const dropStation = useLibDrag((s) => (s.itemIds ? s.over : null));

  if (!layout || !snapshot) return null;
  const selectedStation = selection?.kind === 'station' ? selection.id : null;
  const selectedItem = selection?.kind === 'item' ? selection.id : null;
  const hoverStation = hover?.kind === 'station' ? hover.id : null;
  const detail = lod !== 'far';
  // a selected domain keeps its own row bright under the needs-me dim
  const ownedBySelected = new Set<string>(selectedStation ? stationById.get(selectedStation)?.workpiece_ids ?? [] : []);

  return (
    <group>
      <ZoomLevel />
      <PlateProjector />
      <StripProjector layout={layout} />
      <RowProjector layout={layout} />
      <MorphDriver />
      <IslandsDriver />
      <MorphFade>
      {layers.islands && layout.islands.map((isl) => (
        <Dimmable key={isl.id} on={outside(focus?.lanes, isl.lane, focus) && !isl.stationIds.some((id) => !outside(focus?.stations, id, focus))}>
          <Glide pos={[isl.center[0], isl.top, isl.center[2]]} mode={isl.track ? 'islands' : 'grid'} size={isl.radius * isl.stretch}>
            {isl.track ? (
              <BigIsland island={isl} detail={lod === 'near'} />
            ) : (
              <Island island={isl} buildingLocal={buildingLocals.get(isl.id) ?? []} detail={lod === 'near'} />
            )}
          </Glide>
        </Dimmable>
      ))}
      {layers.sessions && [...layout.buildings.values()].map((b) => {
        const st: Station | undefined = stationById.get(b.stationId);
        if (!st) return null;
        const isRed = red.stations.has(st.id);
        return (
          <Glide key={b.stationId} pos={b.pos} mode={b.big ? 'islands' : 'grid'} size={b.scale} scale={b.scale}>
          <Building
            layout={localBuildings.get(b.stationId) ?? b}
            station={st}
            ownedLive={liveCount.get(st.id) ?? 0}
            selected={selectedStation === st.id}
            hovered={hoverStation === st.id}
            red={isRed}
            dimmed={outside(focus?.stations, st.id, focus)}
            detail={detail}
            beam={layers.beams && layers.needs}
            terminal={terminalStation === st.id}
            drop={dropStation === st.id}
          />
          </Glide>
        );
      })}
      </MorphFade>
      <Skyway layout={layout.grid ?? layout} focus={focus} ramps={layers.islands} gateSelected={selection?.kind === 'gate' ? selection.phase : null} litPhases={new Set(snapshot.workpieces.filter((w) => !w.parked && w.phase !== 'shipped').map((w) => w.phase))} />
      {layers.prs && <Pods
        layout={layout}
        workpieces={snapshot.workpieces}
        selectedId={selectedItem}
        redIds={red.items}
        focus={focus}
        detail={detail || ownedBySelected.size > 0}
        pipeline={pipeline}
        islands={layout.mode === 'islands'}
        zoomed={zoomed}
        labels={layers.labels}
        layers={layers}
      />}
      <Library layout={layout} dimmed={!!focus && !focus.library} detail={detail} />
      <Warehouse layout={layout} shipped={snapshot.shipped} dimmed={!!focus && !focus.warehouse} />
      <Rides layout={layout} shipped={snapshot.shipped} />
      {layers.tethers && layers.sessions && layers.prs && (lod !== 'far' || layers.labels === 'all') && !pipeline && <Tethers layout={layout} redIds={layers.needs ? red.items : new Set<string>()} />}
      {layers.sessions && lod !== 'far' && <Couriers layout={layout} />}
      <TetherPulses layout={layout} />
    </group>
  );
}

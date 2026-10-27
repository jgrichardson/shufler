import { memo, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Station } from '../types';
import { isClosed } from '../lib/derive';
import { STALLED_COLOR, stateColor } from '../lib/colors';
import { dispatch } from '../store';
import { Beam } from './Beam';
import type { BuildingLayout } from './layout';
import { Dimmable } from './Dimmable';
import { HitProxy, HoverHalo, HoverLift } from './Hover';
import { useResolvedTheme, useSkin, useSkinScene } from '../skins/store';

/** Ring under whatever is selected. */
export const SELECT_RING = '#cfe8ff';
/** Marks the session the user's terminal is on (terminal sync), distinct from the selection ring. */
export const TERMINAL_RING = '#7ff0c8';
/** A library card is being dragged over this session (or its row header). */
export const DROP_RING = '#ffd27a';

const FLOOR_H = 1.15;

/** The selection ring colour for the active skin and theme. */
export function useSelectRing(): string {
  return useSkinScene().ring ?? SELECT_RING;
}

export interface BuildingShape {
  floors: number;
  width: number;
  depth: number;
  house: boolean;
  litFraction: number;
  shuttered: boolean;
}

/** CONTRACT v3: height 1 + 0.5 x owned live items (max 3 storeys); windows lit while active. */
export function buildingShape(st: Pick<Station, 'activity' | 'note' | 'group'>, ownedLive: number): BuildingShape {
  const status = st.activity.status;
  const closed = status === 'closed';
  const done = st.note?.state === 'done';
  const floors = done ? 1 : Math.min(3, 1 + Math.ceil(0.5 * ownedLive));
  return {
    floors,
    width: 2.3,
    depth: 2.1,
    house: floors <= 1,
    litFraction: closed ? 0 : done ? 0.05 : status === 'active' ? 0.88 : status === 'stalled' ? 0.55 : 0.22,
    shuttered: String(st.group ?? '').toUpperCase() === 'ON_HOLD',
  };
}

export function bodyHeight(shape: BuildingShape): number {
  return shape.house ? 1.45 : shape.floors * FLOOR_H + 0.3;
}

/** Where a building's plate anchors: just above the roof line. */
export function plateAnchorHeight(shape: BuildingShape): number {
  return bodyHeight(shape) + (shape.house ? 1.3 : 0.9);
}

export function GroundRing({ color, radius, spin = true, pulse = false }: { color: string; radius: number; spin?: boolean; pulse?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  // a glow on a dark scene; on a bright one the colour itself, a touch lifted
  const k = useResolvedTheme() === 'light' ? 1.15 : 2.2;
  const geo = useMemo(() => {
    // dashed ring: 12 arc segments with gaps so the rotation reads
    const g = new THREE.RingGeometry(radius, radius + 0.2, 72, 1, 0, Math.PI * 2);
    return g;
  }, [radius]);
  useFrame(({ clock }, dt) => {
    if (!ref.current) return;
    if (spin) ref.current.rotation.z += dt * 0.6;
    if (pulse) {
      const k = 1 + 0.06 * Math.sin(clock.elapsedTime * 4);
      ref.current.scale.set(k, k, 1);
    }
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]} geometry={geo}>
      <meshBasicMaterial color={new THREE.Color(color).multiplyScalar(k)} toneMapped={false} transparent opacity={0.95} />
    </mesh>
  );
}

interface Props {
  layout: BuildingLayout;
  station: Station;
  ownedLive: number;
  selected: boolean;
  hovered: boolean;
  red: boolean;
  dimmed: boolean;
  detail: boolean;
  beam?: boolean;
  /** The terminal is on this session. */
  terminal?: boolean;
  /** A dragged library card would drop here. */
  drop?: boolean;
}

function BuildingImpl({ layout, station, ownedLive, selected, hovered, red: redIn, dimmed, detail, beam = true, terminal = false, drop = false }: Props) {
  const { Session } = useSkin().components;
  const selectRing = useSelectRing();
  const shape = useMemo(
    () => buildingShape(station, ownedLive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [station.activity.status, station.note?.state, station.group, ownedLive],
  );
  const seed = useMemo(() => layout.paletteIndex * 7919 + station.id.length, [layout.paletteIndex, station.id]);
  const stalled = station.activity.status === 'stalled';
  const active = station.activity.status === 'active';
  // round 9: no running Claude, so no glow, no lamp, and never a red beam or ring
  const closed = isClosed(station);
  const red = redIn && !closed;
  const lampColor = stalled ? STALLED_COLOR : stateColor(station.note?.state);
  const bodyH = bodyHeight(shape);

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
    dispatch({ type: 'hover', hover: { kind: 'station', id: station.id, x: e.clientX, y: e.clientY } });
  };
  const onOut = () => {
    document.body.style.cursor = '';
    dispatch({ type: 'hover', hover: null });
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    dispatch({ type: 'select', selection: { kind: 'station', id: station.id } });
  };

  return (
    <Dimmable on={dimmed}>
      <group position={layout.pos} rotation={[0, layout.rotY, 0]} scale={layout.scale}>
        <group onPointerOver={onOver} onPointerMove={onOver} onPointerOut={onOut} onClick={onClick}>
          <HoverLift on={hovered && !dimmed} lift={0.25} grow={0.03}>
            <Session
              station={station}
              shape={shape}
              height={bodyH}
              lampColor={lampColor}
              active={active}
              stalled={stalled}
              closed={closed}
              selected={selected}
              hovered={hovered || drop}
              detail={detail}
              paletteIndex={layout.paletteIndex}
              seed={seed}
            />
          </HoverLift>
          <HitProxy size={[shape.width + 1.6, bodyH + 1.4, shape.depth + 1.6]} y={(bodyH + 1.4) / 2} />
        </group>
        {red && beam && (
          <group position={[0, bodyH + 0.2, 0]}>
            <Beam color="#e74c3c" pulse intensity={1.15} radius={0.55} height={80} />
          </group>
        )}
        {red && <GroundRing color="#e74c3c" radius={1.95} />}
        {selected && <GroundRing color={selectRing} radius={2.35} spin={false} pulse />}
        <HoverHalo on={hovered && !selected && !dimmed} radius={2.35} />
        {terminal && <GroundRing color={TERMINAL_RING} radius={2.8} />}
        {drop && <GroundRing color={DROP_RING} radius={3.2} pulse />}
      </group>
    </Dimmable>
  );
}

export const Building = memo(BuildingImpl);

import { useMemo, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { Shipped } from '../types';
import { domainDef } from '../lib/domains';
import { openPile } from '../store';
import { PILE_DOCK } from '../store/reducer';
import { useSkin } from '../skins/store';
import { Dimmable } from './Dimmable';
import { HoverLift } from './Hover';
import { SKY_Y, skywayEndX, type SceneLayout } from './layout';
import { inflightPrs, useRides } from './rides';
import { CRATE_SCALE, RACK_COLS, SHELF_Y, bayGeometry, baySlot, rackSlot, warehouseGeometry, warehouseRacks, type Rack, type WarehouseGeometry } from './warehouseLayout';

const envelopeMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const envelopeFlap = new THREE.MeshBasicMaterial({ color: '#9b59b6', toneMapped: false });

/** Pointer cursor and a hovered flag for a clickable part of the warehouse. */
function useHover() {
  const [on, set] = useState(false);
  return {
    on,
    handlers: {
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
        set(true);
      },
      onPointerOut: () => {
        document.body.style.cursor = '';
        set(false);
      },
    },
  };
}

function Crate({ domain, position }: { domain: string; position: [number, number, number] }) {
  const { Crate: Body } = useSkin().components;
  return (
    <group position={position} scale={CRATE_SCALE}>
      <Body domain={domain} color={domainDef(domain).color} />
    </group>
  );
}

/** One rack per domain; crates newest at the front. Clicking it opens that domain's shipped pile. */
function RackUnit({ rack, g }: { rack: Rack; g: WarehouseGeometry }) {
  const { Rack: Frame } = useSkin().components;
  const hover = useHover();
  return (
    <group
      {...hover.handlers}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        openPile(rack.domain);
      }}
    >
      {/* lift only: the group's origin is the world's, so it must not scale */}
      <HoverLift on={hover.on} lift={0.3} grow={0}>
        <group position={[g.rackFrontX, g.floor, rack.z]}>
          <Frame rack={rack} g={g} color={domainDef(rack.domain).color} />
        </group>
        {rack.stored.slice(0, RACK_COLS * SHELF_Y.length).map((s, i) => (
          <Crate key={s.pr} domain={rack.domain} position={rackSlot(g, rack.z, i)} />
        ))}
      </HoverLift>
    </group>
  );
}

/** Close-out owed: an envelope over the crate. */
function Envelope({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh material={envelopeMat}>
        <boxGeometry args={[0.7, 0.46, 0.05]} />
      </mesh>
      <mesh position={[0, 0.08, 0.03]} rotation={[0, 0, Math.PI / 4]} material={envelopeFlap}>
        <boxGeometry args={[0.32, 0.32, 0.02]} />
      </mesh>
    </group>
  );
}

/** The Shipping Dock. Crates owing a close-out wait here. */
function LoadingBay({ g, owed }: { g: WarehouseGeometry; owed: Shipped[] }) {
  const { Dock } = useSkin().components;
  const b = bayGeometry(g);
  const hover = useHover();
  return (
    <group
      {...hover.handlers}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        openPile(PILE_DOCK);
      }}
    >
      <Dock g={g} bay={b} />
      <HoverLift on={hover.on} lift={0.3} grow={0}>
        {owed.map((s, i) => {
          const p = baySlot(b, i);
          return (
            <group key={s.pr}>
              <Crate domain={s.domain} position={[p[0], p[1], p[2]]} />
              <Envelope position={[p[0], p[1] + 1.55, p[2]]} />
            </group>
          );
        })}
      </HoverLift>
    </group>
  );
}

/** End of the belt: the landing ramp, the Shipping Dock (loading bay) and the Warehouse with one rack per domain. */
export function Warehouse({ layout, shipped: all, dimmed = false }: { layout: SceneLayout; shipped: Shipped[]; dimmed?: boolean }) {
  const { WarehouseShell } = useSkin().components;
  const rides = useRides((s) => s.rides);
  const shipped = useMemo(() => {
    const air = inflightPrs(rides);
    return air.size ? all.filter((s) => !air.has(s.pr)) : all;
  }, [all, rides]);
  const racks = useMemo(() => warehouseRacks(layout, shipped), [layout, shipped]);
  const g = useMemo(() => warehouseGeometry(layout, racks), [layout, racks]);
  const owed = useMemo(() => racks.flatMap((r) => r.owed).sort((a, b) => (b.merged_at ?? '').localeCompare(a.merged_at ?? '')), [racks]);
  const deployed = shipped.filter((s) => s.deployed).length;
  const endX = skywayEndX();
  const ramp = useMemo(
    () => ({
      position: [endX + 2, (SKY_Y + g.floor) / 2 - 0.3, (layout.bounds.minZ + layout.bounds.maxZ) / 2] as [number, number, number],
      rotationZ: -0.5,
      size: [6, 0.3, layout.bounds.maxZ - layout.bounds.minZ + 4] as [number, number, number],
    }),
    [endX, g.floor, layout.bounds.minZ, layout.bounds.maxZ],
  );
  return (
    <Dimmable on={dimmed}>
      <WarehouseShell g={g} deployed={deployed} ramp={ramp} />
      {racks.map((r) => (
        <RackUnit key={r.domain} rack={r} g={g} />
      ))}
      <LoadingBay g={g} owed={owed} />
    </Dimmable>
  );
}

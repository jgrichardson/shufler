import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Shipped } from '../types';
import { domainDef } from '../lib/domains';
import { useSkin } from '../skins/store';
import { REDUCED_SECONDS, reducedMotion } from '../ui/motionPrefs';
import { SECONDS_PER_DISTRICT } from './journey';
import { SKY_Y, skywayEndX, type SceneLayout } from './layout';
import { useRides, type Ride } from './rides';
import { bayGeometry, baySlot, rackSlot, warehouseGeometry, warehouseRacks, type WarehouseGeometry } from './warehouseLayout';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface Leg {
  to: THREE.Vector3;
  dur: number;
}

/**
 * Round 11 waypoints: down the lane to the skyway end, down the ramp onto the dock conveyor, then either stop on
 * the belt (close-out still owed) or roll through the bay door and onto the front of the domain's rack (~2 s).
 */
export function ridePath(from: THREE.Vector3, g: WarehouseGeometry, dest: { rack: [number, number, number] } | { bay: [number, number, number] }, reduced: boolean): Leg[] {
  const endX = skywayEndX();
  const b = bayGeometry(g);
  const legs: Leg[] = [
    { to: new THREE.Vector3(endX, SKY_Y, from.z), dur: Math.max(0.6, ((endX - from.x) / 14) * SECONDS_PER_DISTRICT) },
    { to: new THREE.Vector3(b.x0 + 0.9, b.beltY, b.z), dur: 1.0 },
  ];
  if ('bay' in dest) legs.push({ to: new THREE.Vector3(...dest.bay), dur: 0.9 });
  else {
    legs.push({ to: new THREE.Vector3(g.frontX + 0.6, b.beltY, b.z), dur: 0.9 });
    legs.push({ to: new THREE.Vector3(...dest.rack), dur: 1.1 });
  }
  if (reduced) {
    const total = legs.reduce((a, l) => a + l.dur, 0);
    for (const l of legs) l.dur = (l.dur / total) * REDUCED_SECONDS;
  }
  return legs;
}

function RidingPod({ ride, legs }: { ride: Ride; legs: Leg[] }) {
  const ref = useRef<THREE.Group>(null);
  const finish = useRides((s) => s.finish);
  const state = useRef({ leg: 0, t: 0, from: new THREE.Vector3(...ride.from) });
  const color = domainDef(ride.domain).color;
  const { PodBody } = useSkin().components;

  useFrame((_, dt) => {
    const g = ref.current;
    const st = state.current;
    if (!g) return;
    const leg = legs[st.leg];
    if (!leg) return;
    st.t = Math.min(1, st.t + dt / leg.dur);
    g.position.lerpVectors(st.from, leg.to, ease(st.t));
    if (st.t >= 1) {
      st.from.copy(leg.to);
      st.t = 0;
      st.leg += 1;
      if (st.leg >= legs.length) finish(ride.id);
    }
  });

  return (
    <group ref={ref} position={ride.from}>
      <group scale={1.4}>
        <PodBody kind="pr" hull={color} domainColor={color} ballColor={color} dot={false} detail={false} />
      </group>
    </group>
  );
}

/** Pods on their way to the dock and the warehouse. */
export function Rides({ layout, shipped }: { layout: SceneLayout; shipped: Shipped[] }) {
  const rides = useRides((s) => s.rides);
  const racks = useMemo(() => warehouseRacks(layout, shipped), [layout, shipped]);
  const g = useMemo(() => warehouseGeometry(layout, racks), [layout, racks]);
  const owed = useMemo(() => racks.flatMap((r) => r.owed).sort((a, b) => (b.merged_at ?? '').localeCompare(a.merged_at ?? '')), [racks]);
  const reduced = reducedMotion();
  return (
    <group>
      {rides.map((r) => {
        const owedAt = owed.findIndex((s) => s.pr === r.pr);
        const rack = racks.find((x) => x.domain === r.domain);
        const dest =
          owedAt >= 0
            ? { bay: baySlot(bayGeometry(g), owedAt) }
            : { rack: rackSlot(g, rack?.z ?? r.from[2], 0) };
        return <RidingPod key={r.id} ride={r} legs={ridePath(new THREE.Vector3(...r.from), g, dest, reduced)} />;
      })}
    </group>
  );
}

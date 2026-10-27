import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rng, type IslandProps, type PlatformProps } from '../api';
import type { IslandLayout } from '../../scene/layout';
import { useKit } from './kit';

/* Row islands are docking platforms: equipment modules and antenna masts stand where towns and trees stood. */
const mastGeo = new THREE.CylinderGeometry(0.035, 0.06, 2.2, 5);
mastGeo.translate(0, 1.1, 0);
const mastTipGeo = new THREE.SphereGeometry(0.09, 6, 4);
mastTipGeo.translate(0, 2.25, 0);

interface TreeSpot {
  x: number;
  z: number;
  s: number;
}

interface HouseSpot {
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  /** 0..1 position between the hull and pale hull, and between graphite shades. */
  color: number;
  roof: number;
}


/** Non-session filler houses along the outside of the ring road so each island reads as a town. */
function houseSpots(island: IslandLayout): HouseSpot[] {
  const r = rng(island.seed ^ 0x2545f491);
  const R = island.radius;
  const n = Math.round(5 + R * 0.55);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + r() * 0.35;
    const rad = R * (0.86 + r() * 0.04);
    return {
      x: Math.cos(a) * rad,
      z: Math.sin(a) * rad,
      rot: -a,
      w: 1.1 + r() * 0.5,
      d: 1.0 + r() * 0.4,
      h: 0.8 + r() * 0.7,
      color: r(),
      roof: r(),
    };
  });
}

const houseBodyGeo = new THREE.BoxGeometry(1, 1, 1);
houseBodyGeo.translate(0, 0.5, 0);
// flat graphite cap with a lip, so each module reads as a sealed unit
const houseRoofGeo = new THREE.BoxGeometry(1.06, 0.14, 1.06);
houseRoofGeo.translate(0, 0.07, 0);
const houseMat = new THREE.MeshPhysicalMaterial({ roughness: 0.4, metalness: 0.25, clearcoat: 0.6 });
const houseRoofMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.7 });

function Town({ houses }: { houses: HouseSpot[] }) {
  const { p } = useKit();
  const bodies = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const hullA = new THREE.Color(p.hull);
    const hullB = new THREE.Color(p.hullPale);
    const roofA = new THREE.Color(p.graphite);
    const roofB = new THREE.Color(p.graphiteDeep);
    houses.forEach((h, i) => {
      q.setFromAxisAngle(up, h.rot);
      m.compose(new THREE.Vector3(h.x, 0, h.z), q, new THREE.Vector3(h.w, h.h, h.d));
      bodies.current?.setMatrixAt(i, m);
      bodies.current?.setColorAt(i, c.copy(hullA).lerp(hullB, h.color));
      m.compose(new THREE.Vector3(h.x, h.h, h.z), q, new THREE.Vector3(h.w * 0.95, 1, h.d * 0.95));
      roofs.current?.setMatrixAt(i, m);
      roofs.current?.setColorAt(i, c.copy(roofA).lerp(roofB, h.roof));
    });
    for (const mesh of [bodies.current, roofs.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [houses, p]);
  return (
    <>
      <instancedMesh ref={bodies} args={[houseBodyGeo, houseMat, houses.length]} castShadow receiveShadow />
      <instancedMesh ref={roofs} args={[houseRoofGeo, houseRoofMat, houses.length]} castShadow />
    </>
  );
}

function treeSpots(island: IslandLayout, buildingSpots: [number, number][], houses: HouseSpot[]): TreeSpot[] {
  const r = rng(island.seed ^ 0x9e3779b9);
  const R = island.radius;
  const spots: TreeSpot[] = [];
  // small row islands (round 2) get a few scaled trees on the rim and no town
  const small = R < 5;
  const k = Math.min(1, R / 6);
  const want = small ? Math.round(1 + R * 0.5) : Math.round(4 + R * 0.6);
  let guard = 0;
  while (spots.length < want && guard++ < 600) {
    const band = r();
    // outer rim beyond the ring road, or the inner lawn between plaza and road
    const rad = small || band < 0.7 ? R * (0.84 + r() * 0.09) : R * (0.18 + r() * 0.5);
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    if (buildingSpots.some(([bx, bz]) => (bx - x) ** 2 + (bz - z) ** 2 < 6.5 * k * k)) continue;
    if (houses.some((h) => (h.x - x) ** 2 + (h.z - z) ** 2 < 1.6)) continue;
    if (Math.abs(rad - R * 0.74) < R * 0.06) continue; // keep the road clear
    if (rad < R * 0.16) continue;
    spots.push({ x, z, s: (0.6 + r() * 0.7) * k });
  }
  return spots;
}

/** Antenna masts with a lit tip; sparse, so the deck stays clean. */
function Masts({ spots }: { spots: TreeSpot[] }) {
  const kit = useKit();
  const mastMat = kit.ti;
  const mastTipMat = kit.light(kit.p.light, 2.2);
  const masts = useRef<THREE.InstancedMesh>(null);
  const tips = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    for (const mesh of [masts.current, tips.current]) {
      if (!mesh) continue;
      spots.forEach((t, i) => {
        m.makeScale(t.s, t.s, t.s).setPosition(t.x, 0, t.z);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [spots]);
  return (
    <>
      <instancedMesh ref={masts} args={[mastGeo, mastMat, spots.length]} castShadow />
      <instancedMesh ref={tips} args={[mastTipGeo, mastTipMat, spots.length]} />
    </>
  );
}

const navGeo = new THREE.SphereGeometry(0.11, 6, 4);

/**
 * A docking platform: lacquered hex deck, a light strip in the domain colour around its edge, a graphite
 * hull tapering to a drive glow underneath.
 */
export function Platform({ radius, seed, accent, rim, stretch = 1, detail = true, children }: PlatformProps) {
  const kit = useKit();
  const R = radius;
  const strip = rim ?? kit.p.light;
  const fins = useMemo(() => {
    const r = rng(seed ^ 0x51ed27);
    const a0 = r() * Math.PI;
    return [0, 1, 2].map((i) => a0 + (i * Math.PI * 2) / 3);
  }, [seed]);
  const lamps = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return [Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97] as const;
      }),
    [R],
  );

  return (
    <group>
      <group scale={[stretch, 1, 1]}>
        {/* deck */}
        <mesh position={[0, -0.22, 0]} material={kit.hull} receiveShadow castShadow>
          <cylinderGeometry args={[R, R, 0.44, 6]} />
        </mesh>
        {/* edge light strip */}
        <mesh position={[0, -0.52, 0]} material={kit.light(strip, 1.9)}>
          <cylinderGeometry args={[R * 1.004, R * 1.004, 0.13, 6, 1, true]} />
        </mesh>
        {/* hull band and tapering keel */}
        <mesh position={[0, -1.15, 0]} material={kit.graphite} castShadow>
          <cylinderGeometry args={[R * 0.985, R * 0.8, 1.1, 6]} />
        </mesh>
        <mesh position={[0, -1.7 - R * 0.35, 0]} rotation={[Math.PI, 0, 0]} material={kit.deep} castShadow>
          <coneGeometry args={[R * 0.8, R * 0.7, 6, 1]} />
        </mesh>
        {/* stabiliser fins */}
        {fins.map((a, i) => (
          <mesh key={i} position={[Math.cos(a) * R * 0.55, -1.9, Math.sin(a) * R * 0.55]} rotation={[0, -a, 0]} material={kit.ti} castShadow>
            <boxGeometry args={[R * 0.5, 0.9, 0.08]} />
          </mesh>
        ))}
        {/* drive glow under the keel */}
        <mesh position={[0, -1.75 - R * 0.7, 0]} material={kit.light(strip, 2.6)}>
          <sphereGeometry args={[Math.max(0.25, R * 0.09), 10, 8]} />
        </mesh>
        {detail && (
          <>
            {/* landing ring inlaid in the deck */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} material={kit.light(kit.p.light, 0.9)}>
              <ringGeometry args={[R * 0.72, R * 0.735, 6, 1]} />
            </mesh>
            {lamps.map(([x, z], i) => (
              <mesh key={i} geometry={navGeo} position={[x, 0.08, z]} material={kit.light(kit.p.light, 2.4)} />
            ))}
          </>
        )}
        {/* centre pad */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} material={kit.graphite} receiveShadow>
          <circleGeometry args={[R * 0.2, 6]} />
        </mesh>
        {accent && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={kit.light(accent, 1.6)}>
            <ringGeometry args={[R * 0.2, R * 0.215, 6, 1]} />
          </mesh>
        )}
      </group>
      {children}
    </group>
  );
}

/** Command spire at the centre of the command island. */
function ControlTower() {
  const kit = useKit();
  const towerHull = kit.plated;
  const towerDark = kit.graphite;
  const towerGlass = kit.glass;
  const towerRing = kit.light(kit.p.light, 2.4);
  const towerBeacon = kit.light(kit.p.beacon, 3);
  return (
    <group>
      <mesh position={[0, 3.4, 0]} material={towerHull} castShadow receiveShadow>
        <cylinderGeometry args={[0.7, 1.35, 6.8, 6]} />
      </mesh>
      <mesh position={[0, 7.1, 0]} material={towerGlass}>
        <cylinderGeometry args={[1.7, 1.1, 1.2, 6]} />
      </mesh>
      <mesh position={[0, 6.55, 0]} material={towerRing}>
        <cylinderGeometry args={[1.16, 1.16, 0.08, 6, 1, true]} />
      </mesh>
      <mesh position={[0, 7.85, 0]} material={towerDark} castShadow>
        <cylinderGeometry args={[1.85, 1.75, 0.3, 6]} />
      </mesh>
      <mesh position={[0, 9.0, 0]} material={towerDark}>
        <cylinderGeometry args={[0.03, 0.06, 2.2, 5]} />
      </mesh>
      <mesh position={[0, 10.15, 0]} material={towerBeacon}>
        <sphereGeometry args={[0.14, 8, 6]} />
      </mesh>
    </group>
  );
}

export function Island({ island, buildingLocal, detail }: IslandProps) {
  const houses = useMemo(() => (island.radius < 5 ? [] : houseSpots(island)), [island]);
  const spots = useMemo(() => treeSpots(island, buildingLocal, houses), [island, buildingLocal, houses]);
  return (
    <Platform radius={island.radius} seed={island.seed} rim={island.isTower ? undefined : island.color} stretch={island.stretch} detail={detail}>
      <group scale={[island.stretch, 1, 1]}>
        {detail && <Masts spots={spots} />}
        {detail && <Town houses={houses} />}
      </group>
      {island.isTower && (
        <group position={[0, 0, -island.radius * 0.45]}>
          <ControlTower />
        </group>
      )}
    </Platform>
  );
}

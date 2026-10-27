import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rng, type IslandProps, type PlatformProps } from '../api';
import { useKit, glowMat } from './kit';
import { HOUSE_ROOFS, HOUSE_WALLS, TREE_GREENS } from './palette';

type IslandLayout = IslandProps['island'];

const foliageGeo = new THREE.ConeGeometry(0.75, 2.0, 7);
foliageGeo.translate(0, 1.55, 0);
const foliageGeo2 = new THREE.ConeGeometry(0.55, 1.4, 7);
foliageGeo2.translate(0, 2.35, 0);
const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.7, 5);
trunkGeo.translate(0, 0.35, 0);
const roundTreeGeo = new THREE.IcosahedronGeometry(0.85, 0);
roundTreeGeo.translate(0, 1.35, 0);

interface TreeSpot {
  x: number;
  z: number;
  s: number;
  round: boolean;
  color: string;
}

interface HouseSpot {
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  color: string;
  roof: string;
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
      color: HOUSE_WALLS[Math.floor(r() * HOUSE_WALLS.length)],
      roof: HOUSE_ROOFS[Math.floor(r() * HOUSE_ROOFS.length)],
    };
  });
}

const houseBodyGeo = new THREE.BoxGeometry(1, 1, 1);
houseBodyGeo.translate(0, 0.5, 0);
const houseRoofGeo = new THREE.ConeGeometry(0.75, 0.6, 4);
houseRoofGeo.rotateY(Math.PI / 4);
houseRoofGeo.translate(0, 0.3, 0);

function Town({ houses }: { houses: HouseSpot[] }) {
  const kit = useKit();
  const bodies = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    houses.forEach((h, i) => {
      q.setFromAxisAngle(up, h.rot);
      m.compose(new THREE.Vector3(h.x, 0, h.z), q, new THREE.Vector3(h.w, h.h, h.d));
      bodies.current?.setMatrixAt(i, m);
      bodies.current?.setColorAt(i, c.set(h.color));
      m.compose(new THREE.Vector3(h.x, h.h, h.z), q, new THREE.Vector3(h.w * 0.95, 1, h.d * 0.95));
      roofs.current?.setMatrixAt(i, m);
      roofs.current?.setColorAt(i, c.set(h.roof));
    });
    for (const mesh of [bodies.current, roofs.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [houses]);
  return (
    <>
      <instancedMesh ref={bodies} args={[houseBodyGeo, kit.house, houses.length]} castShadow receiveShadow />
      <instancedMesh ref={roofs} args={[houseRoofGeo, kit.houseRoof, houses.length]} castShadow />
    </>
  );
}

function treeSpots(island: IslandLayout, buildingSpots: [number, number][], houses: HouseSpot[]): TreeSpot[] {
  const r = rng(island.seed ^ 0x9e3779b9);
  const R = island.radius;
  const spots: TreeSpot[] = [];
  // small row islands get a few scaled trees on the rim and no town
  const small = R < 5;
  const k = Math.min(1, R / 6);
  const want = small ? Math.round(4 + R * 1.5) : Math.round(14 + R * 2.2);
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
    spots.push({ x, z, s: (0.7 + r() * 0.6) * k, round: r() < 0.35, color: TREE_GREENS[Math.floor(r() * TREE_GREENS.length)] });
  }
  return spots;
}

/** Cone pines (two tiers) and round low-poly trees, with trunks. */
function Trees({ spots }: { spots: TreeSpot[] }) {
  const kit = useKit();
  const cones = useMemo(() => spots.filter((s) => !s.round), [spots]);
  const rounds = useMemo(() => spots.filter((s) => s.round), [spots]);
  const coneRef = useRef<THREE.InstancedMesh>(null);
  const cone2Ref = useRef<THREE.InstancedMesh>(null);
  const roundRef = useRef<THREE.InstancedMesh>(null);
  const trunkRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const place = (mesh: THREE.InstancedMesh | null, list: TreeSpot[], colorize: boolean) => {
      if (!mesh) return;
      list.forEach((t, i) => {
        m.makeScale(t.s, t.s, t.s).setPosition(t.x, 0, t.z);
        mesh.setMatrixAt(i, m);
        if (colorize) mesh.setColorAt(i, c.set(t.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    place(coneRef.current, cones, true);
    place(cone2Ref.current, cones, true);
    place(roundRef.current, rounds, true);
    place(trunkRef.current, spots, false);
  }, [spots, cones, rounds]);

  return (
    <>
      <instancedMesh ref={coneRef} args={[foliageGeo, kit.tree, cones.length]} castShadow receiveShadow />
      <instancedMesh ref={cone2Ref} args={[foliageGeo2, kit.tree, cones.length]} castShadow />
      <instancedMesh ref={roundRef} args={[roundTreeGeo, kit.tree, rounds.length]} castShadow receiveShadow />
      <instancedMesh ref={trunkRef} args={[trunkGeo, kit.trunk, spots.length]} castShadow />
    </>
  );
}

const lampGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.4, 4);
lampGeo.translate(0, 0.7, 0);
const lampHeadGeo = new THREE.SphereGeometry(0.14, 6, 4);
lampHeadGeo.translate(0, 1.45, 0);
const lampHeadMat = glowMat(2.4, 1.8, 1.0);

/** The floating landmass: grass top, earth rim, inverted rock cone with hanging spurs, ring road and plaza. */
export function Platform({ radius, seed, accent, rim, stretch = 1, detail = true, children }: PlatformProps) {
  const kit = useKit();
  const R = radius;
  const spurs = useMemo(() => {
    const r = rng(seed ^ 0x51ed27);
    return Array.from({ length: 5 }, () => {
      const a = r() * Math.PI * 2;
      const d = R * (0.35 + r() * 0.4);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, h: R * (0.45 + r() * 0.5), w: R * (0.18 + r() * 0.16) };
    });
  }, [seed, R]);
  const lamps = useMemo(() => {
    const n = Math.max(6, Math.round(R * 0.9));
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + 0.2;
      return [Math.cos(a) * R * 0.83, Math.sin(a) * R * 0.83] as const;
    });
  }, [R]);

  return (
    <group>
      <group scale={[stretch, 1, 1]}>
        {/* grass cap */}
        <mesh position={[0, -0.3, 0]} material={kit.grass} receiveShadow castShadow>
          <cylinderGeometry args={[R, R * 0.985, 0.6, 8]} />
        </mesh>
        {/* earth band, painted in the domain colour when given */}
        <mesh position={[0, -1.2, 0]} material={kit.tint(rim ?? kit.p.rim, 0.9, 0, true)} castShadow>
          <cylinderGeometry args={[R * 0.985, R * 0.9, 1.2, 8]} />
        </mesh>
        {/* rock underside */}
        <mesh position={[0, -1.8 - R * 0.55, 0]} rotation={[Math.PI, 0, 0]} material={kit.rock} castShadow>
          <coneGeometry args={[R * 0.9, R * 1.1, 8, 2]} />
        </mesh>
        {spurs.map((s, i) => (
          <mesh key={i} position={[s.x, -1.8 - s.h / 2, s.z]} rotation={[Math.PI, i, 0]} material={i % 2 ? kit.rockDark : kit.rock}>
            <coneGeometry args={[s.w, s.h, 5]} />
          </mesh>
        ))}
        {detail && (
          <>
            <mesh rotation={[-Math.PI / 2, 0, Math.PI / 8]} position={[0, 0.02, 0]} material={kit.road} receiveShadow>
              <ringGeometry args={[R * 0.68, R * 0.79, 8, 1]} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, Math.PI / 8]} position={[0, 0.035, 0]} material={kit.roadLine}>
              <ringGeometry args={[R * 0.732, R * 0.738, 8, 1]} />
            </mesh>
            {lamps.map(([x, z], i) => (
              <group key={i} position={[x, 0, z]}>
                <mesh geometry={lampGeo} material={kit.lampPost} />
                <mesh geometry={lampHeadGeo} material={lampHeadMat} />
              </group>
            ))}
          </>
        )}
        {/* plaza */}
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 8]} position={[0, 0.015, 0]} material={kit.plaza} receiveShadow>
          <circleGeometry args={[R * 0.2, 8]} />
        </mesh>
        {accent && (
          <mesh rotation={[-Math.PI / 2, 0, Math.PI / 8]} position={[0, 0.03, 0]}>
            <meshBasicMaterial color={accent} />
            <ringGeometry args={[R * 0.2, R * 0.215, 8, 1]} />
          </mesh>
        )}
      </group>
      {children}
    </group>
  );
}

const towerGlass = glowMat(1.9, 1.5, 0.95);
const towerBeacon = glowMat(3, 0.6, 0.4);

/** Control Tower landmark at the centre of the command island. */
function ControlTower() {
  const kit = useKit();
  return (
    <group>
      <mesh position={[0, 3.2, 0]} material={kit.tower} castShadow receiveShadow>
        <cylinderGeometry args={[0.9, 1.3, 6.4, 8]} />
      </mesh>
      <mesh position={[0, 6.9, 0]} material={towerGlass}>
        <cylinderGeometry args={[1.6, 1.25, 1.1, 8]} />
      </mesh>
      <mesh position={[0, 7.65, 0]} material={kit.tower} castShadow>
        <cylinderGeometry args={[1.8, 1.7, 0.4, 8]} />
      </mesh>
      <mesh position={[0, 8.6, 0]} material={kit.towerMast}>
        <cylinderGeometry args={[0.04, 0.04, 1.6, 4]} />
      </mesh>
      <mesh position={[0, 9.45, 0]} material={towerBeacon}>
        <sphereGeometry args={[0.16, 8, 6]} />
      </mesh>
    </group>
  );
}

/** A row island: grassy floating platform with trees and a little town, the control tower on the command island. */
export function Island({ island, buildingLocal, detail }: IslandProps) {
  const houses = useMemo(() => (island.radius < 5 ? [] : houseSpots(island)), [island]);
  const spots = useMemo(() => treeSpots(island, buildingLocal, houses), [island, buildingLocal, houses]);
  return (
    <Platform radius={island.radius} seed={island.seed} rim={island.isTower ? undefined : island.color} stretch={island.stretch} detail={detail}>
      <group scale={[island.stretch, 1, 1]}>
        {detail && <Trees spots={spots} />}
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

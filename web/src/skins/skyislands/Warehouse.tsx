import { useMemo } from 'react';
import * as THREE from 'three';
import { Beam, RACK_DEPTH, RACK_LEN, SHELF_Y, WAREHOUSE_WALL_H, type DockProps, type RackProps, type WarehouseShellProps } from '../api';
import { islandVariant, texturedBox, useKit, mergeGeometries } from './kit';

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** The timber hall: plank back and far walls, an open front on posts, a slate roof over the back with lanterns. */
function Hall({ g, deployed }: { g: WarehouseShellProps['g']; deployed: number }) {
  const kit = useKit();
  const H = WAREHOUSE_WALL_H;
  const depth = g.backX - g.frontX;
  const roofW = g.backX - g.roofFromX + 1.2;
  const roofCx = (g.roofFromX + g.backX) / 2;
  const geo = useMemo(() => {
    const walls = mergeGeometries([
      at(texturedBox(0.4, H, g.length, 0.5), g.backX, g.floor + H / 2, g.cz),
      at(texturedBox(depth, H, 0.4, 0.5), g.cx, g.floor + H / 2, g.zMin),
    ]);
    const posts: THREE.BufferGeometry[] = [];
    const cols = Math.max(2, Math.round(g.length / 6));
    for (let i = 0; i <= cols; i++) {
      const z = g.zMin + (i * g.length) / cols;
      posts.push(at(texturedBox(0.4, H, 0.4, 0.8), g.frontX, g.floor + H / 2, z));
      posts.push(at(texturedBox(g.roofFromX - g.frontX, 0.22, 0.22, 0.8), (g.frontX + g.roofFromX) / 2, g.floor + H, z));
    }
    posts.push(at(texturedBox(0.45, 0.4, g.length + 0.4, 0.8), g.frontX, g.floor + H, g.cz));
    posts.push(at(texturedBox(0.4, 0.3, g.length + 0.4, 0.8), g.roofFromX, g.floor + H + 0.1, g.cz));
    // a pitched roof: two slopes meeting over the back half
    const rise = 2.6;
    const slope = Math.atan2(rise, roofW / 2);
    const half = Math.hypot(roofW / 2, rise) + 0.3;
    const roofA = texturedBox(half, 0.16, g.length + 1.2, 0.35);
    roofA.rotateZ(slope);
    at(roofA, roofCx - roofW / 4, g.floor + H + rise / 2, g.cz);
    const roofB = texturedBox(half, 0.16, g.length + 1.2, 0.35);
    roofB.rotateZ(-slope);
    at(roofB, roofCx + roofW / 4, g.floor + H + rise / 2, g.cz);
    const lanterns: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= cols; i++) {
      const z = g.zMin + (i * g.length) / cols;
      lanterns.push(at(new THREE.BoxGeometry(0.28, 0.4, 0.28), g.frontX + 0.35, g.floor + H - 0.6, z));
    }
    return { walls, posts: mergeGeometries(posts), roof: mergeGeometries([roofA, roofB]), lanterns: mergeGeometries(lanterns), rise };
  }, [g, H, depth, roofW, roofCx]);
  return (
    <group>
      <mesh position={[g.cx, g.floor - 0.15, g.cz]} material={kit.plank} receiveShadow castShadow>
        <boxGeometry args={[depth + 1, 0.3, g.length + 1]} />
      </mesh>
      <mesh geometry={geo.walls} material={kit.plank} castShadow receiveShadow />
      <mesh geometry={geo.posts} material={kit.plankDark} castShadow />
      <mesh geometry={geo.roof} material={kit.slate} castShadow receiveShadow />
      <mesh geometry={geo.lanterns} material={kit.glow(kit.p.lantern, 2.4)} />
      {deployed > 0 && (
        <group position={[roofCx, g.floor + H + geo.rise + 0.2, g.cz]}>
          <Beam color={kit.p.beam} height={110} radius={0.5} intensity={0.45} />
        </group>
      )}
    </group>
  );
}

/** The warehouse island: a long floating rock under the dock and hall, with the plank slope from the track. */
export function WarehouseShell({ g, deployed, ramp }: WarehouseShellProps) {
  const kit = useKit();
  const isl = islandVariant(77, 1.5);
  const R = g.island.radius;
  return (
    <group>
      <group position={[g.island.cx, g.floor - 0.32, g.cz]} scale={[R * g.island.stretch * 1.05, Math.min(16, R * 0.4), R * 1.02]}>
        <mesh geometry={isl.top} material={kit.grass} receiveShadow />
        <mesh geometry={isl.under} material={[kit.lip, kit.rock]} castShadow receiveShadow />
      </group>
      <mesh position={ramp.position} rotation={[0, 0, ramp.rotationZ]} material={kit.plank} castShadow receiveShadow>
        <boxGeometry args={ramp.size} />
      </mesh>
      <Hall g={g} deployed={deployed} />
    </group>
  );
}

/** Wooden shelving: posts in the domain colour's stain at the ends, plank shelves. Drawn at the rack corner. */
export function Rack({ color }: RackProps) {
  const kit = useKit();
  const height = SHELF_Y[SHELF_Y.length - 1] + 1.3;
  const geo = useMemo(() => {
    const posts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++)
      for (const side of [-1, 1]) posts.push(at(texturedBox(0.16, height, 0.16, 1), (i * RACK_LEN) / 3, height / 2, (side * RACK_DEPTH) / 2));
    const shelves = SHELF_Y.map((y) => at(texturedBox(RACK_LEN + 0.2, 0.1, RACK_DEPTH + 0.1, 0.8), RACK_LEN / 2, y, 0));
    return { posts: mergeGeometries(posts), shelves: mergeGeometries(shelves) };
  }, [height]);
  return (
    <group>
      <mesh geometry={geo.posts} material={kit.plankDark} castShadow />
      <mesh geometry={geo.shelves} material={kit.plank} castShadow receiveShadow />
      {/* a painted rail in the domain colour so each rack reads from above */}
      <mesh position={[RACK_LEN / 2, height, RACK_DEPTH / 2]} material={kit.painted(color)}>
        <boxGeometry args={[RACK_LEN + 0.2, 0.16, 0.18]} />
      </mesh>
    </group>
  );
}

/** Loading pier: plank slab, a roller bed on posts and a timber door frame into the hall. */
export function Dock({ g, bay: b }: DockProps) {
  const kit = useKit();
  const geo = useMemo(() => {
    const dark: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) dark.push(at(texturedBox(b.len, 0.2, 0.12, 0.8), b.cx, b.beltY - 0.12, b.z + side * 1.05));
    for (let i = 0; i < 4; i++) dark.push(at(texturedBox(0.14, b.beltY - g.floor, 1.9, 0.8), b.x0 + 0.4 + (i * (b.len - 0.8)) / 3, (g.floor + b.beltY) / 2, b.z));
    for (const side of [-1, 1]) dark.push(at(texturedBox(0.36, 3.8, 0.3, 0.8), g.frontX, g.floor + 1.9, b.z + side * 1.6));
    dark.push(at(texturedBox(0.4, 0.4, 3.6, 0.8), g.frontX, g.floor + 3.9, b.z));
    const rollers: THREE.BufferGeometry[] = [];
    const n = Math.floor(b.len / 0.55);
    for (let i = 0; i < n; i++) {
      const r = new THREE.CylinderGeometry(0.11, 0.11, 2.0, 8);
      r.rotateX(Math.PI / 2);
      rollers.push(at(r, b.x0 + 0.3 + i * 0.55, b.beltY - 0.06, b.z));
    }
    return { dark: mergeGeometries(dark), rollers: n ? mergeGeometries(rollers) : null };
  }, [g, b]);
  return (
    <group>
      <mesh position={[b.cx, g.floor + 0.05, b.z]} material={kit.plank} castShadow receiveShadow>
        <boxGeometry args={[b.len + 0.6, 0.6, 6]} />
      </mesh>
      <mesh geometry={geo.dark} material={kit.plankDark} castShadow />
      {geo.rollers && <mesh geometry={geo.rollers} material={kit.iron} />}
    </group>
  );
}

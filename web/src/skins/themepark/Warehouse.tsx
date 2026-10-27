import { useMemo } from 'react';
import * as THREE from 'three';
import { Beam, RACK_DEPTH, RACK_LEN, SHELF_Y, WAREHOUSE_WALL_H, type DockProps, type RackProps, type WarehouseShellProps } from '../api';
import { Bins, bare, box, post, stripedTent, useKit } from './kit';
import { trackParts } from './Track';
import { TREE_GEOS } from './Island';

/*
 * The warehouse is the park's gift shop and exit plaza, where shipped work lands as wrapped gift boxes:
 * a paved plaza at ground level, the last drop of track from the end of the rows, an open-fronted shop
 * hall with a striped awning, display stands per domain, and string lights over the plaza.
 */

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** Bulbs hung in sagging spans between points, as a festoon. */
function festoon(bins: Bins, key: string, pts: THREE.Vector3[], sag: number, spacing = 0.7) {
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1];
    const n = Math.max(2, Math.round(a.distanceTo(b) / spacing));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(Math.PI * t) * sag;
      bins.add(key, bare(new THREE.SphereGeometry(0.09, 6, 4).translate(p.x, p.y, p.z)));
    }
  }
}

/** The shop hall: stucco back and far walls, an open front on columns, a tiled roof over the back with an awning. */
function Hall({ g, deployed }: { g: WarehouseShellProps['g']; deployed: number }) {
  const kit = useKit();
  const H = WAREHOUSE_WALL_H;
  const depth = g.backX - g.frontX;
  const roofW = g.backX - g.roofFromX + 1.0;
  const roofCx = (g.roofFromX + g.backX) / 2;
  const built = useMemo(() => {
    const bins = new Bins();
    bins.add('stucco', box(0.5, H, g.length, g.backX, g.floor + H / 2, g.cz, 0.4));
    bins.add('stucco', box(depth, H, 0.5, g.cx, g.floor + H / 2, g.zMin, 0.4));
    // cornice and a painted band along the back wall
    bins.add('trim', box(0.8, 0.3, g.length + 0.6, g.backX, g.floor + H, g.cz));
    bins.add('trim', box(depth + 0.6, 0.3, 0.8, g.cx, g.floor + H, g.zMin));
    const cols = Math.max(2, Math.round(g.length / 6));
    const lampTops: THREE.Vector3[] = [];
    for (let i = 0; i <= cols; i++) {
      const z = g.zMin + (i * g.length) / cols;
      bins.add('trim', post(g.frontX, z, g.floor, g.floor + H, 0.18, 10));
      bins.add('gold', at(new THREE.SphereGeometry(0.22, 10, 8), g.frontX, g.floor + H + 0.2, z));
      bins.add('trim', box(g.roofFromX - g.frontX, 0.16, 0.16, (g.frontX + g.roofFromX) / 2, g.floor + H - 0.1, z));
      lampTops.push(new THREE.Vector3(g.frontX, g.floor + H - 0.3, z));
    }
    bins.add('trim', box(0.36, 0.3, g.length + 0.4, g.frontX, g.floor + H - 0.1, g.cz));
    // a hipped tiled roof over the back of the hall
    const rise = 2.4;
    const slope = Math.atan2(rise, roofW / 2);
    const half = Math.hypot(roofW / 2, rise) + 0.2;
    for (const s of [-1, 1]) {
      const r = box(half, 0.16, g.length + 1.0, 0, 0, 0, 0.35);
      r.rotateZ(-s * slope);
      bins.add('roof', at(r, roofCx + (s * roofW) / 4, g.floor + H + rise / 2, g.cz));
    }
    // a striped awning along the roof's front edge, scalloped
    const gores = Math.max(8, Math.round(g.length / 1.2));
    for (let i = 0; i < gores; i++) {
      const z0 = g.zMin + (i * g.length) / gores;
      const z1 = z0 + g.length / gores;
      const a = new THREE.BufferGeometry();
      const x0 = g.roofFromX - 0.3, x1 = g.roofFromX - 2.0;
      const y0 = g.floor + H + 0.1, y1 = g.floor + H - 0.7;
      const zm = (z0 + z1) / 2;
      a.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, z0, x0, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x1, y1, z0, x1, y1, z0, x1, y1, z1, x1, y1 - 0.3, zm], 3));
      a.computeVertexNormals();
      bins.add(i % 2 ? 'awningA' : 'awningB', a);
    }
    // string lights from column to column along the open front, and back to the shop
    const lights = new Bins();
    festoon(lights, 'bulbs', lampTops, 0.6);
    for (let i = 0; i < lampTops.length; i += 2) festoon(lights, 'bulbs', [lampTops[i], new THREE.Vector3(g.roofFromX - 2.0, g.floor + H - 0.75, lampTops[i].z)], 0.4);
    // a marquee lantern on the ridge that carries the deployed beam
    const lantern = new THREE.Vector3(roofCx, g.floor + H + rise, g.cz);
    bins.add('trim', at(new THREE.CylinderGeometry(1.0, 1.2, 0.4, 16), lantern.x, lantern.y + 0.2, lantern.z));
    bins.add('tent', stripedTent(1.5, 1.4, 10, kit.p.shopRoof, kit.p.awning, 0.16).translate(lantern.x, lantern.y + 1.6, lantern.z));
    bins.add('glass', at(new THREE.CylinderGeometry(0.9, 0.9, 1.2, 16), lantern.x, lantern.y + 1.0, lantern.z));
    return { g: { ...bins.merged(), ...lights.merged() } as Record<string, THREE.BufferGeometry>, rise };
  }, [g, H, depth, roofW, roofCx, kit.p.shopRoof, kit.p.awning]);
  const bulbs = kit.glow(kit.p.bulb, kit.light ? 1.2 : 2.8);
  return (
    <group>
      <mesh geometry={built.g.stucco} material={kit.stucco} castShadow receiveShadow />
      <mesh geometry={built.g.trim} material={kit.trim} castShadow />
      <mesh geometry={built.g.gold} material={kit.gold} />
      <mesh geometry={built.g.roof} material={kit.painted(kit.p.shopRoof, 0.7)} castShadow receiveShadow />
      <mesh geometry={built.g.awningA} material={kit.painted(kit.p.shopRoof, 0.6)} castShadow />
      <mesh geometry={built.g.awningB} material={kit.painted(kit.p.awning, 0.6)} castShadow />
      <mesh geometry={built.g.tent} material={kit.vcol} castShadow />
      <mesh geometry={built.g.glass} material={kit.glow(kit.p.window, kit.light ? 1.1 : 1.8)} />
      <mesh geometry={built.g.bulbs} material={bulbs} />
      {/* warm light strip along the inside of the back wall */}
      <mesh position={[g.backX - 0.3, g.floor + H - 0.7, g.cz]} material={kit.glow(kit.p.bulb, 1.6)}>
        <boxGeometry args={[0.06, 0.16, g.length - 1]} />
      </mesh>
      {deployed > 0 && (
        <group position={[roofCx, g.floor + H + built.rise + 2.6, g.cz]}>
          <Beam color={kit.p.deployBeam} height={110} radius={0.6} intensity={0.5} />
        </group>
      )}
    </group>
  );
}

/** The exit plaza at park level, the final drop of track from the end of the rows, and the shop hall. */
export function WarehouseShell({ g, deployed, ramp }: WarehouseShellProps) {
  const kit = useKit();
  const plaza = useMemo(() => {
    const x0 = g.island.cx - g.island.radius * g.island.stretch;
    const x1 = g.backX + 3;
    const z0 = g.zMin - 3;
    const z1 = g.zMax + 3;
    const bins = new Bins();
    bins.add('paving', box(x1 - x0, 0.4, z1 - z0, (x0 + x1) / 2, g.floor - 0.2, (z0 + z1) / 2, 0.18));
    bins.add('curb', box(x1 - x0 + 0.5, 0.42, 0.5, (x0 + x1) / 2, g.floor - 0.2, z1));
    bins.add('curb', box(0.5, 0.42, z1 - z0, x0, g.floor - 0.2, (z0 + z1) / 2));
    // planters with trees along the front edge of the plaza
    for (let z = z0 + 4; z < z1 - 2; z += 9) {
      const x = x0 + 2.5;
      bins.add('planter', box(2.0, 0.5, 2.0, x, g.floor + 0.25, z));
      bins.add('tree', TREE_GEOS[Math.abs(Math.round(z)) % TREE_GEOS.length].clone().scale(1.6, 1.6, 1.6).translate(x, g.floor + 0.5, z));
    }
    return bins.merged();
  }, [g]);
  const drop = useMemo(() => {
    const bins = new Bins();
    const len = ramp.size[0];
    trackParts(bins, -len / 2, len / 2, ramp.size[1] / 2 + 0.2);
    return bins.merged();
  }, [ramp.size]);
  return (
    <group>
      <mesh geometry={plaza.paving} material={kit.paving} receiveShadow />
      <mesh geometry={plaza.curb} material={kit.curb} receiveShadow />
      <mesh geometry={plaza.planter} material={kit.curb} castShadow receiveShadow />
      <mesh geometry={plaza.tree} material={kit.vcol} castShadow />
      <group position={ramp.position} rotation={[0, 0, ramp.rotationZ]}>
        <mesh geometry={drop.spine} material={kit.painted(kit.p.shopRoof, 0.35)} castShadow />
        <mesh geometry={drop.steel} material={kit.steel} castShadow />
        <mesh geometry={drop.tie} material={kit.tie} />
        {/* the ramp's own deck stays as a slim walkway under the track so items still have a floor */}
        <mesh material={kit.plank} castShadow receiveShadow>
          <boxGeometry args={[ramp.size[0], Math.min(0.2, ramp.size[1]), ramp.size[2]]} />
        </mesh>
      </group>
      <Hall g={g} deployed={deployed} />
    </group>
  );
}

/** A display stand: white posts, plank shelves and a top rail in the domain colour. Drawn at the rack corner. */
export function Rack({ color }: RackProps) {
  const kit = useKit();
  const height = SHELF_Y[SHELF_Y.length - 1] + 1.3;
  const geo = useMemo(() => {
    const posts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) posts.push(post((i * RACK_LEN) / 3, (side * RACK_DEPTH) / 2, 0, height, 0.07, 8));
    const shelves = SHELF_Y.map((y) => box(RACK_LEN + 0.2, 0.1, RACK_DEPTH + 0.1, RACK_LEN / 2, y, 0, 0.7));
    const b = new Bins();
    posts.forEach((p) => b.add('posts', p));
    shelves.forEach((s) => b.add('shelves', s));
    return b.merged();
  }, [height]);
  return (
    <group>
      <mesh geometry={geo.posts} material={kit.trim} castShadow />
      <mesh geometry={geo.shelves} material={kit.plank} castShadow receiveShadow />
      {/* a painted rail and a little pennant fringe in the domain colour so each stand reads from above */}
      <mesh position={[RACK_LEN / 2, height, RACK_DEPTH / 2]} material={kit.painted(color, 0.4)}>
        <boxGeometry args={[RACK_LEN + 0.2, 0.18, 0.18]} />
      </mesh>
      <mesh position={[RACK_LEN / 2, height, -RACK_DEPTH / 2]} material={kit.painted(color, 0.4)}>
        <boxGeometry args={[RACK_LEN + 0.2, 0.18, 0.18]} />
      </mesh>
    </group>
  );
}

/** The unload platform: a plank deck, a roller bed on legs and an arched doorway with an awning into the shop. */
export function Dock({ g, bay: b }: DockProps) {
  const kit = useKit();
  const geo = useMemo(() => {
    const bins = new Bins();
    bins.add('plank', box(b.len + 0.6, 0.5, 6, b.cx, g.floor + 0.05, b.z, 0.6));
    for (const side of [-1, 1]) bins.add('steel', box(b.len, 0.2, 0.12, b.cx, b.beltY - 0.12, b.z + side * 1.05));
    for (let i = 0; i < 4; i++) bins.add('steel', box(0.12, b.beltY - g.floor, 1.9, b.x0 + 0.4 + (i * (b.len - 0.8)) / 3, (g.floor + b.beltY) / 2, b.z));
    const n = Math.floor(b.len / 0.55);
    for (let i = 0; i < n; i++) bins.add('rollers', new THREE.CylinderGeometry(0.11, 0.11, 2.0, 8).rotateX(Math.PI / 2).translate(b.x0 + 0.3 + i * 0.55, b.beltY - 0.06, b.z));
    // the doorway: stucco piers, a half-round arch and a striped awning over it
    for (const s of [-1, 1]) bins.add('stucco', box(0.5, 3.8, 0.5, g.frontX, g.floor + 1.9, b.z + s * 1.7, 0.6));
    bins.add('arch', new THREE.TorusGeometry(1.7, 0.2, 8, 20, Math.PI).rotateY(Math.PI / 2).translate(g.frontX, g.floor + 3.8, b.z));
    bins.add('tent', stripedTent(1.3, 0.7, 8, kit.p.shopRoof, kit.p.awning, 0.12).translate(g.frontX - 0.6, g.floor + 5.6, b.z));
    return bins.merged();
  }, [g, b, kit.p.shopRoof, kit.p.awning]);
  return (
    <group>
      <mesh geometry={geo.plank} material={kit.plank} castShadow receiveShadow />
      <mesh geometry={geo.steel} material={kit.steelDark} castShadow />
      {geo.rollers && <mesh geometry={geo.rollers} material={kit.steel} />}
      <mesh geometry={geo.stucco} material={kit.stucco} castShadow />
      <mesh geometry={geo.arch} material={kit.painted(kit.p.shopRoof, 0.5)} castShadow />
      <mesh geometry={geo.tent} material={kit.vcol} castShadow />
    </group>
  );
}

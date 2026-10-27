import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import type { IslandProps, PlatformProps } from '../api';
import { Bins, FLOOR_Y, canvas, canvasTexture, post, roundRect, spaced, useKit } from './kit';

/*
 * Each row starts at a round dais on the gaming floor: polished wood with a leather band in the row's
 * colour, its slot machine (the session) in the middle, velvet ropes on brass stanchions round the back,
 * a brass easel at the front with the table's placard, and a little pedestal where parked cards wait.
 */

/** A wooden dais whose top is at y = 0 and whose wall drops `drop` to the floor, banded in `rim`. */
export function Dais({ radius, rim, stretch = 1, drop, children }: { radius: number; rim?: string; stretch?: number; drop: number; children?: ReactNode }) {
  const kit = useKit();
  const geo = useMemo(
    () => ({
      top: new THREE.CylinderGeometry(1, 1, 0.12, 48).translate(0, -0.06, 0),
      wall: new THREE.CylinderGeometry(1.0, 1.03, drop, 48, 1, true).translate(0, -drop / 2, 0),
      band: new THREE.CylinderGeometry(1.012, 1.012, 0.16, 48, 1, true).translate(0, -0.2, 0),
      bead: new THREE.TorusGeometry(1, 0.025, 6, 64).rotateX(Math.PI / 2).translate(0, 0.0, 0),
      kick: new THREE.CylinderGeometry(1.04, 1.04, 0.08, 48, 1, true).translate(0, -drop + 0.04, 0),
    }),
    [drop],
  );
  return (
    <group>
      <group scale={[radius * stretch, 1, radius]}>
        <mesh geometry={geo.top} material={kit.wood} receiveShadow castShadow />
        <mesh geometry={geo.wall} material={kit.woodDark} receiveShadow />
        {rim && <mesh geometry={geo.band} material={kit.leather(rim)} />}
        <mesh geometry={geo.bead} material={kit.brass} />
        <mesh geometry={geo.kick} material={kit.brass} />
      </group>
      {children}
    </group>
  );
}

/** A floating base for anything that stands on one: a dais down to the gaming floor. */
export function Platform({ radius, rim, stretch, children }: PlatformProps) {
  return (
    <Dais radius={radius} rim={rim} stretch={stretch} drop={0.7}>
      {children}
    </Dais>
  );
}

const placards = new Map<string, THREE.Texture | null>();
/** The table placard: the row's code large in gold on a lacquer card edged in the row's colour. */
function placard(code: string, color: string): THREE.Texture | null {
  const key = `${code}|${color}`;
  if (placards.has(key)) return placards.get(key)!;
  const made = canvas(320, 220);
  let t: THREE.Texture | null = null;
  if (made) {
    const [c, g] = made;
    g.fillStyle = '#16100d';
    g.fillRect(0, 0, 320, 220);
    g.strokeStyle = color;
    g.lineWidth = 10;
    roundRect(g, 10, 10, 300, 200, 16);
    g.stroke();
    g.strokeStyle = '#d6b86e';
    g.lineWidth = 2;
    roundRect(g, 24, 24, 272, 172, 10);
    g.stroke();
    g.fillStyle = '#e9cf8a';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = '600 22px Georgia, "Times New Roman", serif';
    spaced(g, 'TABLE', 160, 62, 6);
    g.font = '700 96px Georgia, "Times New Roman", serif';
    g.fillText(code, 160, 160);
    g.font = '600 16px Georgia, "Times New Roman", serif';
    spaced(g, 'NO LIMIT', 160, 186, 5);
    t = canvasTexture(c);
  }
  placards.set(key, t);
  return t;
}

/** A sagging rope between two points, as a tube. */
function rope(a: THREE.Vector3, b: THREE.Vector3, sag: number) {
  const m = a.clone().lerp(b, 0.5);
  m.y -= sag;
  const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(m, 0.55).setY(m.y + sag * 0.3), m, b.clone().lerp(m, 0.55).setY(m.y + sag * 0.3), b]);
  return new THREE.TubeGeometry(curve, 16, 0.05, 6, false);
}

export function Island({ island, buildingLocal }: IslandProps) {
  const kit = useKit();
  const R = island.radius * 1.12;
  // the dais stands on the gaming floor whatever height the core puts the island top at
  const drop = Math.max(0.3, island.top - FLOOR_Y);
  const built = useMemo(() => {
    const bins = new Bins();
    // stanchions round the back half, clear of the session
    const posts: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * (1.12 + (i * 0.76) / 3);
      const x = Math.cos(a) * R * 0.86 * island.stretch;
      const z = Math.sin(a) * R * 0.86;
      if (buildingLocal.some(([bx, bz]) => (bx - x) ** 2 + (bz - z) ** 2 < 1.4)) continue;
      bins.add('brass', post(x, z, 0, 0.9, 0.05, 10));
      bins.add('brass', new THREE.CylinderGeometry(0.16, 0.2, 0.06, 14).translate(x, 0.03, z));
      bins.add('brass', new THREE.SphereGeometry(0.09, 10, 8).translate(x, 0.95, z));
      posts.push(new THREE.Vector3(x, 0.84, z));
    }
    for (let i = 0; i < posts.length - 1; i++) bins.add('rope', rope(posts[i], posts[i + 1], 0.22));
    // the parked-card pedestal on the east shoulder (where the core parks items, 0.9 above the dais)
    const px = island.radius * 0.55;
    bins.add('wood', new THREE.CylinderGeometry(0.22, 0.3, 0.8, 14).translate(px, 0.4, 0));
    bins.add('brass', new THREE.CylinderGeometry(0.6, 0.6, 0.06, 24).translate(px, 0.83, 0));
    // the easel at the front-left
    const ex = -R * 0.5;
    const ez = R * 0.62;
    for (const s of [-1, 1]) bins.add('brass', post(ex + s * 0.45, ez, 0, 1.0, 0.03, 6));
    bins.add('brass', post(ex, ez - 0.25, 0, 0.9, 0.03, 6).rotateX(0));
    return { g: bins.merged(), easel: [ex, ez] as [number, number] };
  }, [R, island.radius, island.stretch, buildingLocal]);
  const map = placard(island.code, island.color);
  return (
    <Dais radius={R} rim={island.color} stretch={island.stretch} drop={drop}>
      <mesh geometry={built.g.brass} material={kit.brass} castShadow />
      {built.g.rope && <mesh geometry={built.g.rope} material={kit.leather(island.color)} castShadow />}
      <mesh geometry={built.g.wood} material={kit.woodDark} castShadow />
      <group position={[built.easel[0], 0.95, built.easel[1] + 0.02]} rotation={[-0.38, 0, 0]}>
        <mesh material={kit.brass}>
          <boxGeometry args={[1.38, 0.96, 0.04]} />
        </mesh>
        <mesh position={[0, 0, 0.025]}>
          <planeGeometry args={[1.3, 0.89]} />
          <meshStandardMaterial map={map} roughness={0.5} emissive="#ffffff" emissiveMap={map} emissiveIntensity={kit.light ? 0.04 : 0.22} />
        </mesh>
      </group>
    </Dais>
  );
}

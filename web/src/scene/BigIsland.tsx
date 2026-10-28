import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PHASE_ACCENT } from '../lib/colors';
import { useResolvedTheme, useSkin } from '../skins/store';
import type { IslandLayout } from './layout';
import { TRACK_HALF_W, TRACK_Y, loopPoint, type TrackLoop } from './islands';

/** Straight pieces the loop is drawn with; enough that the oval reads smooth from any zoom. */
const SEGMENTS = 40;
/** Each piece runs this far into the next, so the outside of a bend shows no gaps. */
const OVERLAP = 0.35;

/** Chords round the loop: centre, heading and length of each straight piece, in the island's frame. */
export function trackSegments(loop: TrackLoop, n = SEGMENTS): { x: number; z: number; yaw: number; len: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = loopPoint(loop, (i / n) * loop.length);
    const b = loopPoint(loop, ((i + 1) / n) * loop.length);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: Math.atan2(-(b.z - a.z), b.x - a.x), len: Math.hypot(b.x - a.x, b.z - a.z) };
  });
}

/** The material a mesh was given by its skin, under any fade or grey-out variant the core swapped in. */
const baseMaterial = (m: THREE.Mesh) => ((m.userData as { vBase?: THREE.Material }).vBase ?? m.material) as THREE.Material | THREE.Material[];

/**
 * The island's loop, built from the skin's own Ramp: one Ramp is drawn hidden as a template, and each of
 * its meshes is repeated round the loop as an instanced copy. A few draw calls per island whatever the
 * skin draws, and the track always looks like that skin's bridges. Rebuilt when the template changes
 * (skin, theme, or a skin that finishes its geometry a frame late).
 */
function TrackLoopMesh({ loop, color }: { loop: TrackLoop; color: string }) {
  const { Ramp } = useSkin().components;
  const template = useRef<THREE.Group>(null);
  const host = useRef<THREE.Group>(null);
  const signature = useRef('');
  const frames = useRef(0);
  const segs = useMemo(() => trackSegments(loop), [loop]);
  const pieceLen = loop.length / SEGMENTS + OVERLAP;
  const placements = useMemo(() => {
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    return segs.map((s) => new THREE.Matrix4().compose(new THREE.Vector3(s.x, TRACK_Y, s.z), q.setFromAxisAngle(up, s.yaw).clone(), new THREE.Vector3((s.len + OVERLAP) / pieceLen, 1, 1)));
  }, [segs, pieceLen]);

  const clear = () => {
    const h = host.current;
    if (!h) return;
    for (const child of [...h.children]) {
      h.remove(child);
      (child as THREE.InstancedMesh).dispose?.();
    }
  };

  useFrame(() => {
    // the template settles within a frame or two; after that a cheap check now and then
    if (frames.current++ > 3 && frames.current % 20) return;
    const root = template.current;
    const h = host.current;
    if (!root || !h) return;
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const sig = meshes.map((m) => `${m.geometry.uuid}:${[baseMaterial(m)].flat().map((x) => x.uuid).join('+')}`).join(',') + `|${placements.length}`;
    if (sig === signature.current) return;
    signature.current = sig;
    clear();
    root.updateMatrixWorld(true);
    const toRoot = root.matrixWorld.clone().invert();
    const rel = new THREE.Matrix4();
    const m4 = new THREE.Matrix4();
    for (const mesh of meshes) {
      rel.multiplyMatrices(toRoot, mesh.matrixWorld);
      const inst = new THREE.InstancedMesh(mesh.geometry, baseMaterial(mesh), placements.length);
      placements.forEach((p, i) => inst.setMatrixAt(i, m4.multiplyMatrices(p, rel)));
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = mesh.castShadow;
      inst.receiveShadow = mesh.receiveShadow;
      inst.computeBoundingSphere();
      h.add(inst);
    }
  });
  useEffect(() => clear, []);
  // a new loop shape means new placements: rebuild on the next check
  useLayoutEffect(() => {
    signature.current = '';
    frames.current = 0;
  }, [placements]);

  return (
    <>
      <group ref={template} visible={false}>
        <Ramp length={pieceLen} color={color} />
      </group>
      <group ref={host} />
    </>
  );
}

const postGeo = new THREE.CylinderGeometry(0.07, 0.1, 1.5, 6).translate(0, 0.75, 0);
const footGeo = new THREE.CylinderGeometry(0.34, 0.4, 0.12, 12).translate(0, 0.06, 0);
const capGeo = new THREE.OctahedronGeometry(0.34, 0).translate(0, 1.82, 0);
const postMats = {
  dark: new THREE.MeshStandardMaterial({ color: '#6c7280', metalness: 0.4, roughness: 0.5 }),
  light: new THREE.MeshStandardMaterial({ color: '#4c5260', metalness: 0.3, roughness: 0.55 }),
};
const capMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });

/** A post at each stop, just outside the track, with a lamp in the stage's colour (the colours of the district strip). */
function StopMarkers({ loop }: { loop: TrackLoop }) {
  const light = useResolvedTheme() === 'light';
  const posts = useRef<THREE.InstancedMesh>(null);
  const feet = useRef<THREE.InstancedMesh>(null);
  const caps = useRef<THREE.InstancedMesh>(null);
  const n = loop.stops.length;
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    loop.stops.forEach((stop, i) => {
      const p = loopPoint(loop, stop.s);
      const off = TRACK_HALF_W + 0.55;
      m.makeTranslation(p.x + p.nx * off, TRACK_Y * 0.5, p.z + p.nz * off);
      for (const r of [posts, feet, caps]) r.current?.setMatrixAt(i, m);
      caps.current?.setColorAt(i, c.set(PHASE_ACCENT[stop.phase] ?? '#9aa4b2').multiplyScalar(light ? 1.05 : 1.9));
    });
    for (const r of [posts, feet, caps]) {
      if (!r.current) continue;
      r.current.instanceMatrix.needsUpdate = true;
      if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true;
      r.current.computeBoundingSphere();
    }
  }, [loop, light]);
  const mat = light ? postMats.light : postMats.dark;
  return (
    <>
      <instancedMesh key={`p${n}`} ref={posts} args={[postGeo, mat, n]} castShadow />
      <instancedMesh key={`f${n}`} ref={feet} args={[footGeo, mat, n]} receiveShadow />
      <instancedMesh key={`c${n}`} ref={caps} args={[capGeo, capMat, n]} />
    </>
  );
}

/** Highest the platform's ground may rise above y = 0 under the track before it is flattened. */
const MAX_RISE = 0.12;

/**
 * Some skins shape their platform tops in proportion to the radius (Sky Islands' rolling grass), which on an
 * island this big would bury the track. Once the platform is drawn, this measures the ground along the loop
 * and at the centre, and squashes that ground cap (not the rock under it) in y just enough to keep it under MAX_RISE. Flat tops are untouched.
 */
function useLowGround(body: RefObject<THREE.Group>, loop: TrackLoop, skinKey: string) {
  const done = useRef('');
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const probes = useMemo(() => [{ x: 0, z: 0 }, ...trackSegments(loop, 24)], [loop]);
  useFrame(() => {
    const g = body.current;
    if (!g || done.current === skinKey) return;
    const caps: THREE.Mesh[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.boundingBox ?? m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!;
      // a cap lying on the ground (nothing below y = 0) is what can rise over the track; the rock under it stays
      if (b.min.y >= -0.01 && b.max.y > 0.01) caps.push(m);
    });
    for (const m of caps) m.scale.y = 1;
    g.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, -1, 0);
    let rise = 0;
    let hits = 0;
    for (const p of probes) {
      const from = g.localToWorld(new THREE.Vector3(p.x, 40, p.z));
      ray.set(from, down);
      const hit = ray.intersectObject(g, true)[0];
      if (!hit) continue;
      hits++;
      rise = Math.max(rise, g.worldToLocal(hit.point.clone()).y);
    }
    // a skin still loading its textures has drawn nothing yet: measure again next frame
    if (!hits) return;
    done.current = skinKey;
    if (rise <= MAX_RISE) return;
    for (const m of caps) m.scale.y = MAX_RISE / rise;
  });
}

/**
 * A session's big island: the skin's floating platform in the row's domain colour, the loop of track on its
 * ring road, and a lit post at each stage's stop. The building and the pods are drawn by the core as usual.
 */
export function BigIsland({ island, detail }: { island: IslandLayout; detail: boolean }) {
  const skin = useSkin();
  const { Platform } = skin.components;
  const body = useRef<THREE.Group>(null);
  const loop = island.track!;
  useLowGround(body, loop, `${skin.id}|${island.seed}`);
  return (
    <>
      <group ref={body}>
        <Platform radius={island.radius} seed={island.seed} rim={island.color} accent={island.color} stretch={island.stretch} detail={detail} />
      </group>
      <TrackLoopMesh loop={loop} color={island.color} />
      <StopMarkers loop={loop} />
    </>
  );
}

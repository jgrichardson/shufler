import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Beam, rng, reducedMotion, type SessionProps } from '../api';
import { texturedBox, useKit } from './kit';

const FLOOR_H = 1.15;

/** A square prism that tapers toward the top, with UVs in world scale for the stone texture. */
export function taperedPrism(wBot: number, wTop: number, h: number, density = 0.7): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(wTop / Math.SQRT2, wBot / Math.SQRT2, h, 4, 1, true);
  g.rotateY(Math.PI / 4);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * wBot * 4 * density, uv.getY(i) * h * density);
  return g;
}

/** Pyramid roof with a little flare at the eaves, slate textured. */
export function pyramidRoof(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(w / Math.SQRT2, h, 4, 2);
  g.rotateY(Math.PI / 4);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  // pull the middle ring in for a concave, hand-built roof line
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getY(i)) < 1e-4) {
      p.setX(i, p.getX(i) * 0.72);
      p.setZ(i, p.getZ(i) * 0.72);
    }
  }
  g.computeVertexNormals();
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 2, uv.getY(i) * h * 1.2);
  return g;
}

const windowGeo = new THREE.PlaneGeometry(0.17, 0.62);
const windowMat = new THREE.MeshBasicMaterial({ toneMapped: false });
const crystalGeo = new THREE.OctahedronGeometry(0.2, 0);

interface Slot {
  m: THREE.Matrix4;
  lit: boolean;
}

/** Tall slit windows on all four faces, one row per floor; the lit share follows the session's activity. */
function Windows({ w, d, floors, base, lit, seed, colour, active, stalled }: { w: number; d: number; floors: number; base: number; lit: number; seed: number; colour: string; active: boolean; stalled: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { p } = useKit();
  const slots = useMemo(() => {
    const r = rng(seed);
    const out: Slot[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const faces: [number, number, number, number][] = [
      [0, 0, d / 2 + 0.012, w],
      [Math.PI, 0, -d / 2 - 0.012, w],
      [Math.PI / 2, w / 2 + 0.012, 0, d],
      [-Math.PI / 2, -w / 2 - 0.012, 0, d],
    ];
    for (const [rot, fx, fz, span] of faces) {
      q.setFromAxisAngle(up, rot);
      const cols = span > 1.3 ? 2 : 1;
      for (let f = 0; f < floors; f++)
        for (let c = 0; c < cols; c++) {
          const off = cols === 1 ? 0 : (c - 0.5) * span * 0.42;
          const local = new THREE.Vector3(off, 0, 0).applyQuaternion(q);
          const pos = new THREE.Vector3(fx + local.x, base + 0.55 + f * FLOOR_H, fz + local.z);
          out.push({ m: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)), lit: r() < lit });
        }
    }
    return out;
  }, [w, d, floors, base, lit, seed]);
  const on = useMemo(() => new THREE.Color(colour).multiplyScalar(active ? 2.6 : 1.5), [colour, active]);
  const off = useMemo(() => new THREE.Color(p.windowOff), [p.windowOff]);
  const tmp = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    slots.forEach((s, i) => {
      mesh.setMatrixAt(i, s.m);
      mesh.setColorAt(i, s.lit ? on : off);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [slots, on, off]);
  useFrame(() => {
    const mesh = ref.current;
    if (!stalled || !mesh || reducedMotion() || Math.random() > 0.25) return;
    const i = Math.floor(Math.random() * slots.length);
    mesh.setColorAt(i, Math.random() > 0.5 ? tmp.copy(on).multiplyScalar(0.6) : off);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[windowGeo, windowMat, slots.length]} />;
}

/**
 * A session as a stone tower: a plinth on the island, a tapering shaft with tall glowing slit windows (one
 * row per floor, so the tower grows with the work it owns), a slate pyramid roof and a status crystal on
 * the spire. Active sessions send a faint pale light up into the sky, as in the concept painting.
 */
export function Session({ station, shape, height: bodyH, lampColor, active, stalled, closed, selected, hovered, detail, paletteIndex, seed }: SessionProps) {
  const kit = useKit();
  const { p } = kit;
  const plinthH = 0.32;
  // taller than the core's body height: the tower should dominate its island, as in the concept
  const shaftH = Math.max(1.6, bodyH * 1.25 - plinthH + 0.5);
  const sw = 1.45;
  const geo = useMemo(
    () => ({
      plinth: texturedBox(shape.width, plinthH, shape.depth, 0.8),
      shaft: taperedPrism(sw, sw * 0.86, shaftH, 0.75),
      cornice: texturedBox(sw * 1.02, 0.16, sw * 1.02, 0.8),
      roof: pyramidRoof(sw * 1.18, 1.25),
      annex: texturedBox(0.85, 0.7, 0.8, 0.8),
      annexRoof: pyramidRoof(1.0, 0.5),
    }),
    [shape.width, shape.depth, shaftH],
  );
  const winColour = paletteIndex % 6 === 4 ? p.windowAlt : paletteIndex % 6 === 5 ? p.windowCool : p.window;
  const floors = Math.max(1, Math.round(shaftH / FLOOR_H));
  const lampRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!lampRef.current || !stalled) return;
    lampRef.current.visible = Math.sin(clock.elapsedTime * 2.2) > -0.2;
  });
  const top = plinthH + shaftH;
  const emissive = hovered || selected ? lampColor : '#000000';
  const stone = useMemo(() => {
    if (!hovered && !selected && !closed && !shape.shuttered) return kit.stone;
    const m = kit.stone.clone();
    if (closed) m.color.multiplyScalar(0.45);
    if (shape.shuttered) m.color.lerp(new THREE.Color('#8a8496'), 0.5);
    m.emissive.set(emissive);
    m.emissiveIntensity = hovered || selected ? 0.12 : 0;
    return m;
  }, [kit.stone, hovered, selected, closed, shape.shuttered, emissive]);

  return (
    <group scale={[1.2, 1.2, 1.2]}>
      <mesh geometry={geo.plinth} position={[0, plinthH / 2, 0]} material={kit.stoneDark} castShadow receiveShadow />
      <mesh geometry={geo.shaft} position={[0, plinthH + shaftH / 2, 0]} material={stone} castShadow receiveShadow />
      <mesh geometry={geo.cornice} position={[0, top, 0]} material={kit.stoneDark} castShadow />
      <mesh geometry={geo.roof} position={[0, top + 0.08 + 0.625, 0]} material={kit.slate} castShadow />
      {/* door */}
      <mesh position={[0, plinthH + 0.34, (sw * 0.99) / 2 + 0.01]} material={kit.glow(p.window, active && !closed ? 0.9 : 0.25)}>
        <planeGeometry args={[0.36, 0.62]} />
      </mesh>
      {detail && (
        <group position={[-(sw / 2 + 0.36), plinthH, 0.35]}>
          <mesh geometry={geo.annex} position={[0, 0.35, 0]} material={kit.stoneDark} castShadow receiveShadow />
          <mesh geometry={geo.annexRoof} position={[0, 0.95, 0]} material={kit.slate} castShadow />
          <mesh position={[0, 0.33, 0.41]} material={kit.glow(p.window, closed ? 0.2 : 1.6)}>
            <planeGeometry args={[0.18, 0.26]} />
          </mesh>
        </group>
      )}
      {!closed && !shape.shuttered && (
        <Windows w={sw * 0.93} d={sw * 0.93} floors={floors} base={plinthH} lit={shape.litFraction} seed={seed} colour={winColour} active={active} stalled={stalled} />
      )}
      {station.note?.state !== 'done' && !closed && (
        <mesh ref={lampRef} geometry={crystalGeo} position={[0, top + 1.55, 0]} scale={[1, 1.6, 1]} material={kit.glow(lampColor, 2.8)} />
      )}
      {active && !closed && (
        <group position={[0, top + 1.4, 0]}>
          <Beam color={p.beam} height={45} radius={0.12} intensity={0.35} />
        </group>
      )}
    </group>
  );
}

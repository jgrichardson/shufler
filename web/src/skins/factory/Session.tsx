import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { rng, type SessionProps } from '../api';
import { glowMat, useKit } from './kit';
import { BUILDING_PALETTE, ROOF_PALETTE, WINDOW_DIM, WINDOW_LIT, WINDOW_OFF } from './palette';

const FLOOR_H = 1.15;
const windowGeo = new THREE.PlaneGeometry(0.34, 0.5);
const windowMat = new THREE.MeshBasicMaterial({ toneMapped: false });
const droneGeo = new THREE.OctahedronGeometry(0.2, 0);
const droneMat = glowMat(1.6, 2.0, 2.4);
const lampGeo = new THREE.SphereGeometry(0.17, 10, 8);

type Shape = SessionProps['shape'];

/** Warm windows on all four faces; lit share follows the session's activity, stalled ones flicker. */
function Windows({ shape, seed, stalled, active }: { shape: Shape; seed: number; stalled: boolean; active: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const slots = useMemo(() => {
    const out: { m: THREE.Matrix4; lit: boolean }[] = [];
    const r = rng(seed);
    const { width, depth } = shape;
    const floors = shape.house ? 1 : shape.floors;
    const faces: [number, number, number, number][] = [
      [0, 0, depth / 2 + 0.01, width],
      [Math.PI, 0, -depth / 2 - 0.01, width],
      [Math.PI / 2, width / 2 + 0.01, 0, depth],
      [-Math.PI / 2, -width / 2 - 0.01, 0, depth],
    ];
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (const [rot, fx, fz, span] of faces) {
      const cols = Math.max(2, Math.floor(span / 0.62));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          const off = (c - (cols - 1) / 2) * (span / cols);
          const local = new THREE.Vector3(off, 0, 0).applyQuaternion(q);
          const p = new THREE.Vector3(fx + local.x, 0.62 + f * FLOOR_H, fz + local.z);
          out.push({ m: new THREE.Matrix4().compose(p, q, s), lit: r() < shape.litFraction });
        }
      }
    }
    return out;
  }, [shape, seed]);

  const color = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const on = active ? WINDOW_LIT : WINDOW_DIM;
    slots.forEach((s, i) => {
      mesh.setMatrixAt(i, s.m);
      const lit = s.lit && !shape.shuttered;
      mesh.setColorAt(i, lit ? color.setRGB(on[0], on[1], on[2]) : color.setRGB(WINDOW_OFF[0], WINDOW_OFF[1], WINDOW_OFF[2]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [slots, active, color, shape.shuttered]);

  useFrame(() => {
    const mesh = ref.current;
    if (!stalled || !mesh || Math.random() > 0.3) return;
    const i = Math.floor(Math.random() * slots.length);
    const on = Math.random() > 0.5;
    mesh.setColorAt(i, on ? color.setRGB(WINDOW_LIT[0], WINDOW_LIT[1] * 0.75, WINDOW_LIT[2] * 0.5) : color.setRGB(...WINDOW_OFF));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[windowGeo, windowMat, slots.length]} />;
}

/** Subagents: little glowing drones circling the house. */
function Drones({ count, height }: { count: number; height: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.children.forEach((c, i) => {
      const a = t * (0.9 + i * 0.13) + (i * Math.PI * 2) / count;
      const r = 1.9 + (i % 2) * 0.5;
      c.position.set(Math.cos(a) * r, height + 0.8 + Math.sin(t * 2 + i) * 0.25 + i * 0.3, Math.sin(a) * r);
      c.rotation.y = t * 3;
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} geometry={droneGeo} material={droneMat} />
      ))}
    </group>
  );
}

/** A session as a pastel house (one storey, pyramid roof) or a small block with a flat roof, lit windows and a status lamp. */
export function Session({ station, shape, height: bodyH, lampColor, active, stalled, closed, selected, hovered, detail, paletteIndex, seed }: SessionProps) {
  const kit = useKit();
  const { p } = kit;
  const pi = ((paletteIndex % BUILDING_PALETTE.length) + BUILDING_PALETTE.length) % BUILDING_PALETTE.length;
  const wall = useMemo(() => {
    const c = new THREE.Color(BUILDING_PALETTE[pi]);
    if (shape.shuttered) c.lerp(new THREE.Color(p.shutterTint), 0.55);
    if (closed) c.lerp(new THREE.Color(p.closedTint), 0.7);
    return c;
  }, [pi, p, shape.shuttered, closed]);
  const roof = ROOF_PALETTE[pi % ROOF_PALETTE.length];
  const lampMat = kit.light(lampColor, 2.6);
  const lampRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!lampRef.current || !stalled) return;
    lampRef.current.visible = Math.sin(clock.elapsedTime * 2.2) > -0.2;
  });

  const lampPos: [number, number, number] = shape.house ? [0, bodyH + 1.1, 0] : [-0.6, bodyH + 1.65, 0.4];

  return (
    <group>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} material={kit.plate} receiveShadow>
        <planeGeometry args={[shape.width + 1.0, shape.depth + 1.0]} />
      </mesh>
      <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[shape.width, bodyH, shape.depth]} />
        <meshStandardMaterial
          color={wall}
          roughness={0.82}
          emissive={hovered || selected ? lampColor : '#000000'}
          emissiveIntensity={hovered || selected ? 0.12 : 0}
        />
      </mesh>
      {shape.house ? (
        <mesh position={[0, bodyH + 0.5, 0]} rotation={[0, Math.PI / 4, 0]} material={kit.tint(roof, 0.8, 0, true)} castShadow>
          <coneGeometry args={[Math.max(shape.width, shape.depth) * 0.8, 1.0, 4]} />
        </mesh>
      ) : (
        <>
          <mesh position={[0, bodyH + 0.1, 0]} material={kit.tint(roof, 0.7)} castShadow>
            <boxGeometry args={[shape.width + 0.18, 0.2, shape.depth + 0.18]} />
          </mesh>
          {detail && (
            <>
              <mesh position={[0.45, bodyH + 0.42, -0.3]} material={kit.roofBox} castShadow>
                <boxGeometry args={[0.7, 0.45, 0.6]} />
              </mesh>
              <mesh position={[-0.6, bodyH + 0.9, 0.4]} material={kit.mast}>
                <cylinderGeometry args={[0.03, 0.03, 1.4, 4]} />
              </mesh>
            </>
          )}
        </>
      )}
      {detail && !shape.shuttered && !closed && <Windows shape={shape} seed={seed} stalled={stalled} active={active} />}
      {shape.shuttered && (
        <mesh position={[0, bodyH / 2, shape.depth / 2 + 0.02]} material={kit.shutter}>
          <planeGeometry args={[shape.width * 0.86, bodyH * 0.8]} />
        </mesh>
      )}
      {station.note?.state !== 'done' && !closed && <mesh ref={lampRef} geometry={lampGeo} position={lampPos} material={lampMat} />}
      {detail && station.activity.subagents > 0 && <Drones count={Math.min(6, station.activity.subagents)} height={bodyH} />}
    </group>
  );
}

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { rng, type SessionProps } from '../api';
import { useKit } from './kit';

const FLOOR_H = 1.15;
const windowGeo = new THREE.PlaneGeometry(0.44, 0.14);
const windowMat = new THREE.MeshBasicMaterial({ toneMapped: false });
const droneGeo = new THREE.OctahedronGeometry(0.2, 0);

const LIT = 2.3;
const DIM = 1.1;
const OFF = new THREE.Color(0.05, 0.07, 0.1);

type Shape = SessionProps['shape'];

/** Slit windows on all four faces; lit share follows the session's activity, stalled ones flicker. */
function Windows({ shape, seed, stalled, active, light }: { shape: Shape; seed: number; stalled: boolean; active: boolean; light: string }) {
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

  const on = useMemo(() => new THREE.Color(light).multiplyScalar(active ? LIT : DIM), [light, active]);
  const color = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    slots.forEach((s, i) => {
      mesh.setMatrixAt(i, s.m);
      mesh.setColorAt(i, s.lit && !shape.shuttered ? on : OFF);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [slots, on, shape.shuttered]);

  useFrame(() => {
    const mesh = ref.current;
    if (!stalled || !mesh || Math.random() > 0.3) return;
    const i = Math.floor(Math.random() * slots.length);
    mesh.setColorAt(i, Math.random() > 0.5 ? color.copy(on).multiplyScalar(0.7) : OFF);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[windowGeo, windowMat, slots.length]} />;
}

/** Subagents: small craft circling the module. */
function Drones({ count, height, material }: { count: number; height: number; material: THREE.Material }) {
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
        <mesh key={i} geometry={droneGeo} material={material} />
      ))}
    </group>
  );
}

/** A session as a white hull module: graphite cap, slit windows, status lamp on a mast. */
export function Session({ station, shape, height: bodyH, lampColor, active, stalled, closed, selected, hovered, detail, paletteIndex, seed }: SessionProps) {
  const kit = useKit();
  const { p } = kit;
  const k = (paletteIndex % 6) / 5;
  const wall = useMemo(() => {
    const c = new THREE.Color(p.hull).lerp(new THREE.Color(p.hullPale), k);
    if (shape.shuttered) c.lerp(new THREE.Color(p.titanium), 0.55);
    if (closed) c.lerp(new THREE.Color(p.graphiteDeep), 0.7);
    return c;
  }, [p, k, shape.shuttered, closed]);
  const roof = useMemo(() => new THREE.Color(p.graphite).lerp(new THREE.Color(p.graphiteDeep), k).getStyle(), [p, k]);
  const lampRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!lampRef.current || !stalled) return;
    lampRef.current.visible = Math.sin(clock.elapsedTime * 2.2) > -0.2;
  });
  const lampPos: [number, number, number] = shape.house ? [0, bodyH + 1.1, 0] : [-0.6, bodyH + 1.65, 0.4];

  return (
    <group>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} material={kit.graphite} receiveShadow>
        <planeGeometry args={[shape.width + 1.0, shape.depth + 1.0]} />
      </mesh>
      <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[shape.width, bodyH, shape.depth]} />
        <meshPhysicalMaterial
          color={wall}
          roughness={0.36}
          metalness={0.25}
          clearcoat={0.7}
          clearcoatRoughness={0.2}
          emissive={hovered || selected ? lampColor : '#000000'}
          emissiveIntensity={hovered || selected ? 0.12 : 0}
        />
      </mesh>
      {shape.house ? (
        <mesh position={[0, bodyH + 0.22, 0]} castShadow>
          <boxGeometry args={[shape.width * 0.82, 0.44, shape.depth * 0.82]} />
          <meshStandardMaterial color={roof} roughness={0.4} metalness={0.7} />
        </mesh>
      ) : (
        <>
          <mesh position={[0, bodyH + 0.1, 0]} castShadow>
            <boxGeometry args={[shape.width + 0.12, 0.2, shape.depth + 0.12]} />
            <meshStandardMaterial color={roof} roughness={0.4} metalness={0.7} />
          </mesh>
          {detail && (
            <>
              <mesh position={[0.45, bodyH + 0.42, -0.3]} material={kit.ti} castShadow>
                <boxGeometry args={[0.7, 0.45, 0.6]} />
              </mesh>
              <mesh position={[-0.6, bodyH + 0.9, 0.4]} material={kit.ti}>
                <cylinderGeometry args={[0.03, 0.03, 1.4, 4]} />
              </mesh>
            </>
          )}
        </>
      )}
      {detail && !shape.shuttered && !closed && <Windows shape={shape} seed={seed} stalled={stalled} active={active} light={p.light} />}
      {shape.shuttered && (
        <mesh position={[0, bodyH / 2, shape.depth / 2 + 0.02]} material={kit.graphite}>
          <planeGeometry args={[shape.width * 0.86, bodyH * 0.8]} />
        </mesh>
      )}
      {station.note?.state !== 'done' && !closed && (
        <mesh ref={lampRef} position={lampPos} material={kit.light(lampColor, 2.6)}>
          <sphereGeometry args={[0.17, 10, 8]} />
        </mesh>
      )}
      {detail && station.activity.subagents > 0 && <Drones count={Math.min(6, station.activity.subagents)} height={bodyH} material={kit.light(p.light, 2.2)} />}
    </group>
  );
}

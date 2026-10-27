import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { LandmarkProps } from '../api';
import { useKit } from './kit';

/* District landmarks (CONTRACT v3.1 "Districts"): one sculptural station module per phase, lit in its accent. */

function useGlow(accent: string, k = 2.2) {
  return useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(k), toneMapped: false }), [accent, k]);
}

/** Brainstorm: a glass icosahedron turning over a pedestal, its edges traced in light. */
function IdeaCore({ glow }: { glow: THREE.Material }) {
  const { graphite: dark, glass } = useKit();
  const core = useRef<THREE.Group>(null);
  const wire = useMemo(() => {
    const m = (glow as THREE.MeshBasicMaterial).clone();
    m.wireframe = true;
    return m;
  }, [glow]);
  useFrame(({ clock }) => {
    const g = core.current;
    if (!g) return;
    g.rotation.y = clock.elapsedTime * 0.25;
    g.rotation.x = Math.sin(clock.elapsedTime * 0.2) * 0.3;
    g.position.y = 3.7 + Math.sin(clock.elapsedTime * 0.9) * 0.15;
  });
  return (
    <group>
      <mesh position={[0, 0.7, 0]} material={dark} castShadow>
        <cylinderGeometry args={[0.7, 1.2, 1.4, 6]} />
      </mesh>
      <mesh position={[0, 1.45, 0]} material={glow}>
        <cylinderGeometry args={[0.75, 0.75, 0.08, 6]} />
      </mesh>
      <group ref={core}>
        <mesh material={glass} castShadow>
          <icosahedronGeometry args={[1.5, 0]} />
        </mesh>
        <mesh material={wire} scale={1.02}>
          <icosahedronGeometry args={[1.5, 0]} />
        </mesh>
      </group>
    </group>
  );
}

/** Plan: a drafting table with three holographic sheets layered above it. */
function HoloTable({ accent, glow }: { accent: string; glow: THREE.Material }) {
  const { plated: hull, glass } = useKit();
  const sheets = useRef<THREE.Group>(null);
  const sheetMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    [accent],
  );
  useFrame(({ clock }) => {
    sheets.current?.children.forEach((c, i) => {
      c.position.y = 1.9 + i * 0.75 + Math.sin(clock.elapsedTime * 0.8 + i) * 0.08;
    });
  });
  return (
    <group>
      <mesh position={[0, 0.55, 0]} material={hull} castShadow receiveShadow>
        <boxGeometry args={[4.8, 1.1, 3]} />
      </mesh>
      <mesh position={[0, 1.12, 0]} material={glass}>
        <boxGeometry args={[4.4, 0.06, 2.6]} />
      </mesh>
      <mesh position={[0, 1.17, 1.32]} material={glow}>
        <boxGeometry args={[4.4, 0.04, 0.06]} />
      </mesh>
      <group ref={sheets}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} material={sheetMat}>
            <planeGeometry args={[3.8 - i * 0.7, 2.2 - i * 0.4]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Build: a gantry over a module under assembly; the carriage runs along the beam. */
function Gantry({ glow }: { glow: THREE.Material }) {
  const { plated: hull, graphite: dark, ti } = useKit();
  const carriage = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (carriage.current) carriage.current.position.x = Math.sin(clock.elapsedTime * 0.35) * 2.0;
  });
  return (
    <group>
      {[-2.7, 2.7].map((x) => (
        <mesh key={x} position={[x, 3.2, 0]} material={ti} castShadow>
          <boxGeometry args={[0.4, 6.4, 0.9]} />
        </mesh>
      ))}
      <mesh position={[0, 6.5, 0]} material={hull} castShadow>
        <boxGeometry args={[6.2, 0.5, 1.1]} />
      </mesh>
      <mesh position={[0, 6.24, 0.56]} material={glow}>
        <boxGeometry args={[5.8, 0.05, 0.04]} />
      </mesh>
      <group ref={carriage} position={[0, 5.9, 0]}>
        <mesh material={dark} castShadow>
          <boxGeometry args={[0.9, 0.6, 1.2]} />
        </mesh>
        <mesh position={[0, -1.3, 0]} material={ti}>
          <boxGeometry args={[0.06, 2.0, 0.06]} />
        </mesh>
        <mesh position={[0, -2.35, 0]} material={glow}>
          <boxGeometry args={[0.5, 0.08, 0.5]} />
        </mesh>
      </group>
      {/* the module being built: half skin, half frame */}
      <mesh position={[0, 0.9, 0]} material={hull} castShadow receiveShadow>
        <boxGeometry args={[2.4, 1.8, 2]} />
      </mesh>
      <mesh position={[0, 2.25, 0]} material={dark}>
        <boxGeometry args={[2.4, 0.9, 2]} />
      </mesh>
    </group>
  );
}

/** QA: a glass test cylinder inside three slim posts, a ring of light sweeping up and down it. */
function Scanner({ glow }: { glow: THREE.Material }) {
  const { plated: hull, graphite: dark, ti, glass } = useKit();
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.position.y = 3.0 + Math.sin(clock.elapsedTime * 0.9) * 2.1;
  });
  const posts = [0, 1, 2].map((i) => (i * Math.PI * 2) / 3 + Math.PI / 6);
  return (
    <group>
      <mesh position={[0, 0.35, 0]} material={dark} castShadow>
        <cylinderGeometry args={[1.3, 1.5, 0.7, 6]} />
      </mesh>
      <mesh position={[0, 2.55, 0]} material={glass} castShadow>
        <cylinderGeometry args={[0.95, 0.95, 3.7, 32]} />
      </mesh>
      <mesh position={[0, 4.45, 0]} material={hull} castShadow>
        <cylinderGeometry args={[1.05, 1.05, 0.25, 32]} />
      </mesh>
      {posts.map((a) => (
        <mesh key={a} position={[Math.cos(a) * 2.2, 3.0, Math.sin(a) * 2.2]} material={ti} castShadow>
          <cylinderGeometry args={[0.09, 0.12, 6, 8]} />
        </mesh>
      ))}
      <mesh position={[0, 6.0, 0]} rotation={[Math.PI / 2, 0, 0]} material={hull} castShadow>
        <torusGeometry args={[2.2, 0.16, 10, 48]} />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} material={glow}>
        <torusGeometry args={[1.45, 0.05, 8, 48]} />
      </mesh>
    </group>
  );
}

/** Review: an observatory drum and dome inside a slowly precessing ring. */
function Observatory({ glow }: { glow: THREE.Material }) {
  const { plated: hull, ti, glass } = useKit();
  const ring = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.y = clock.elapsedTime * 0.15;
  });
  return (
    <group>
      <mesh position={[0, 1.2, 0]} material={hull} castShadow receiveShadow>
        <cylinderGeometry args={[2.1, 2.4, 2.4, 32]} />
      </mesh>
      <mesh position={[0, 2.4, 0]} material={glass} castShadow>
        <sphereGeometry args={[2.05, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, 2.42, 0]} material={glow}>
        <cylinderGeometry args={[2.12, 2.12, 0.08, 32, 1, true]} />
      </mesh>
      <mesh position={[0, 3.3, 1.75]} rotation={[0.5, 0, 0]} material={glow}>
        <torusGeometry args={[0.38, 0.06, 8, 24]} />
      </mesh>
      <group ref={ring} position={[0, 2.6, 0]}>
        <mesh rotation={[Math.PI / 2 + 0.35, 0, 0.15]} material={ti}>
          <torusGeometry args={[3.0, 0.1, 8, 64]} />
        </mesh>
      </group>
    </group>
  );
}

/** Merge: a standing ring gate with a lit inner rim. */
function Portal({ glow }: { glow: THREE.Material }) {
  const { plated: hull, graphite: dark } = useKit();
  return (
    <group>
      <group position={[0, 3.3, 0]}>
        <mesh material={hull} castShadow>
          <torusGeometry args={[2.8, 0.42, 16, 64]} />
        </mesh>
        <mesh material={glow}>
          <torusGeometry args={[2.36, 0.06, 8, 64]} />
        </mesh>
      </group>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 2.2, 0.55, 0]} rotation={[0, 0, side * 0.35]} material={dark} castShadow>
          <boxGeometry args={[0.9, 1.4, 1.3]} />
        </mesh>
      ))}
    </group>
  );
}

/** Deploy: a launch rail with a capsule ready to go and a glow ring at its foot. */
function LaunchRail({ glow }: { glow: THREE.Material }) {
  const { plated: hull, graphite: dark, ti } = useKit();
  const capsule = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (capsule.current) capsule.current.position.y = 4.4 + Math.sin(clock.elapsedTime * 0.6) * 0.12;
  });
  return (
    <group>
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, 4.5, -0.9]} material={ti} castShadow>
          <boxGeometry args={[0.18, 9, 0.3]} />
        </mesh>
      ))}
      <mesh position={[0, 4.5, -1.1]} material={dark} castShadow>
        <boxGeometry args={[1.9, 9, 0.2]} />
      </mesh>
      <mesh position={[0, 4.5, -0.98]} material={glow}>
        <boxGeometry args={[0.08, 8.4, 0.05]} />
      </mesh>
      <group ref={capsule}>
        <mesh material={hull} castShadow>
          <capsuleGeometry args={[0.65, 2.6, 8, 16]} />
        </mesh>
        <mesh position={[0, 0.6, 0]} material={glow}>
          <cylinderGeometry args={[0.67, 0.67, 0.08, 16, 1, true]} />
        </mesh>
      </group>
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} material={glow}>
        <ringGeometry args={[1.3, 1.45, 32]} />
      </mesh>
    </group>
  );
}

/** District landmarks (Phases v4). A district the daemon adds later gets the holo table. */
const BY_PHASE: Record<string, (p: { accent: string; glow: THREE.Material }) => JSX.Element> = {
  brainstorm: IdeaCore,
  plan: HoloTable,
  build: Gantry,
  qa: Scanner,
  review: Observatory,
  merge: Portal,
  deploy: LaunchRail,
};

/** One district landmark on its own hex pad, lit brighter while its district is live or selected. */
export function Landmark({ phase, accent, active, lit }: LandmarkProps) {
  const { plated, deep } = useKit();
  const glow = useGlow(accent, active ? 3 : lit ? 2.3 : 1.3);
  const Comp = BY_PHASE[phase] ?? HoloTable;
  return (
    <group>
      <mesh position={[0, -0.25, 0]} material={plated} receiveShadow castShadow>
        <cylinderGeometry args={[4.6, 4.4, 0.5, 6]} />
      </mesh>
      <mesh position={[0, -0.56, 0]} material={glow}>
        <cylinderGeometry args={[4.42, 4.42, 0.1, 6, 1, true]} />
      </mesh>
      <mesh position={[0, -1.6, 0]} material={deep} castShadow>
        <coneGeometry args={[4.2, 2.0, 6]} />
      </mesh>
      <Comp accent={accent} glow={glow} />
    </group>
  );
}

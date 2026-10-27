import { useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { LandmarkProps } from '../api';
import { useKit, type Kit } from './kit';

/* Cute stone, wood and steel district landmarks; each sits behind the back lane so it reads as skyline. */

interface Parts {
  kit: Kit;
  glow: THREE.Material;
}

function Windows({ w, h, rows, cols, z, mat }: { w: number; h: number; rows: number; cols: number; z: number; mat: THREE.Material }) {
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push(
        <mesh key={`${r}-${c}`} position={[(c - (cols - 1) / 2) * (w / cols), (r + 0.6) * (h / (rows + 0.4)), z]} material={mat}>
          <planeGeometry args={[(w / cols) * 0.45, (h / rows) * 0.42]} />
        </mesh>,
      );
  return <>{out}</>;
}

function PlanHouse({ kit, glow }: Parts) {
  return (
    <group>
      <mesh position={[0, 1.4, 0]} material={kit.stone} castShadow receiveShadow>
        <boxGeometry args={[5, 2.8, 3.6]} />
      </mesh>
      <mesh position={[0, 3.6, 0]} rotation={[0, Math.PI / 4, 0]} material={kit.roofRed} castShadow>
        <coneGeometry args={[3.9, 1.8, 4]} />
      </mesh>
      <mesh position={[1.4, 4.1, 0.4]} material={kit.stoneDark}>
        <boxGeometry args={[0.5, 1.4, 0.5]} />
      </mesh>
      <group position={[0, 0, 1.81]}>
        <Windows w={4.4} h={2.6} rows={1} cols={3} z={0} mat={glow} />
      </group>
    </group>
  );
}

function BuildYard({ kit, glow }: Parts) {
  const jib = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (jib.current) jib.current.rotation.y = Math.sin(clock.elapsedTime * 0.25) * 0.6;
  });
  return (
    <group>
      {[-1.2, 1.2].map((x) =>
        [-0.9, 0.9].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 1.6, z]} material={kit.wood}>
            <boxGeometry args={[0.15, 3.2, 0.15]} />
          </mesh>
        )),
      )}
      {[1.1, 2.3].map((y) => (
        <mesh key={y} position={[0, y, 0]} material={kit.wood}>
          <boxGeometry args={[2.7, 0.12, 2.1]} />
        </mesh>
      ))}
      <mesh position={[0, 0.9, 0]} material={kit.stoneDark} castShadow>
        <boxGeometry args={[2.2, 1.8, 1.6]} />
      </mesh>
      <mesh position={[3, 4.2, 0]} material={kit.steel} castShadow>
        <boxGeometry args={[0.45, 8.4, 0.45]} />
      </mesh>
      <group ref={jib} position={[3, 8.4, 0]}>
        <mesh position={[-2.2, 0, 0]} material={kit.steel} castShadow>
          <boxGeometry args={[6.4, 0.35, 0.35]} />
        </mesh>
        <mesh position={[1.5, -0.2, 0]} material={kit.steelDark}>
          <boxGeometry args={[0.9, 0.7, 0.7]} />
        </mesh>
        <mesh position={[-4.6, -1.4, 0]} material={kit.steelDark}>
          <boxGeometry args={[0.04, 2.6, 0.04]} />
        </mesh>
        <mesh position={[0, 0.45, 0]} material={glow}>
          <sphereGeometry args={[0.16, 8, 6]} />
        </mesh>
      </group>
    </group>
  );
}

function TestLab({ kit, glow }: Parts) {
  return (
    <group>
      <mesh position={[0, 0.3, 0]} material={kit.stone} receiveShadow>
        <boxGeometry args={[5, 0.6, 3.6]} />
      </mesh>
      <mesh position={[0, 1.9, 0]} material={kit.glass}>
        <boxGeometry args={[4.4, 2.6, 3]} />
      </mesh>
      <mesh position={[0, 1.9, 0]} material={glow}>
        <boxGeometry args={[3.2, 0.08, 2]} />
      </mesh>
      <mesh position={[0, 3.2, 0]} material={kit.glass}>
        <sphereGeometry args={[1.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {[-1.6, 0, 1.6].map((x) => (
        <mesh key={x} position={[x, 1.2, 0]} material={kit.steelDark}>
          <cylinderGeometry args={[0.22, 0.22, 1.2, 10]} />
        </mesh>
      ))}
    </group>
  );
}

function ReviewHall({ kit, glow }: Parts) {
  return (
    <group>
      <mesh position={[0, 0.3, 0]} material={kit.stone} castShadow receiveShadow>
        <boxGeometry args={[6, 0.6, 4]} />
      </mesh>
      {[-2.3, -0.8, 0.8, 2.3].map((x) => (
        <mesh key={x} position={[x, 2.1, 1.5]} material={kit.stone} castShadow>
          <cylinderGeometry args={[0.28, 0.3, 3, 10]} />
        </mesh>
      ))}
      <mesh position={[0, 2.1, -0.4]} material={kit.stoneDark}>
        <boxGeometry args={[5.4, 3, 2.4]} />
      </mesh>
      <mesh position={[0, 3.85, 0.2]} material={kit.stone} castShadow>
        <boxGeometry args={[6.2, 0.5, 4]} />
      </mesh>
      <mesh position={[0, 4.6, 0.2]} scale={[1, 0.45, 0.62]} material={kit.stone} castShadow>
        <coneGeometry args={[4.4, 2.2, 4, 1]} />
      </mesh>
      <group position={[0, 4.75, 2.05]}>
        <mesh position={[-0.35, 0, 0]} material={glow}>
          <boxGeometry args={[0.16, 0.9, 0.08]} />
        </mesh>
        <mesh position={[0.35, 0, 0]} material={glow}>
          <boxGeometry args={[0.16, 0.9, 0.08]} />
        </mesh>
        <mesh material={glow}>
          <boxGeometry args={[0.7, 0.14, 0.08]} />
        </mesh>
      </group>
    </group>
  );
}

function PreviewPier({ kit, glow }: Parts) {
  return (
    <group>
      <mesh position={[0, 0.25, 0.8]} material={kit.wood} receiveShadow>
        <boxGeometry args={[6, 0.4, 2]} />
      </mesh>
      {[-2.6, -0.9, 0.9, 2.6].map((x) => (
        <mesh key={x} position={[x, -0.9, 1.6]} material={kit.wood}>
          <cylinderGeometry args={[0.15, 0.15, 2.2, 6]} />
        </mesh>
      ))}
      <mesh position={[0, 3.4, -0.6]} material={kit.stone} castShadow>
        <cylinderGeometry args={[0.75, 1.15, 6.4, 12]} />
      </mesh>
      {[1.4, 3.4, 5.4].map((y) => (
        <mesh key={y} position={[0, y, -0.6]} material={kit.roofRed}>
          <cylinderGeometry args={[1.12 - y * 0.05, 1.15 - y * 0.05, 0.55, 12]} />
        </mesh>
      ))}
      <mesh position={[0, 7.1, -0.6]} material={glow}>
        <cylinderGeometry args={[0.65, 0.65, 1, 10]} />
      </mesh>
      <mesh position={[0, 8, -0.6]} material={kit.roofRed} castShadow>
        <coneGeometry args={[0.95, 0.9, 10]} />
      </mesh>
    </group>
  );
}

function MergeGate({ kit, glow }: Parts) {
  return (
    <group>
      {[-2.4, 2.4].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 3, 0]} material={kit.stoneDark} castShadow>
            <boxGeometry args={[1.8, 6, 2.2]} />
          </mesh>
          <mesh position={[0, 6.5, 0]} material={kit.roofSlate} castShadow>
            <coneGeometry args={[1.5, 1.6, 4]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 5, 0]} material={kit.stoneDark} castShadow>
        <boxGeometry args={[3.2, 1.6, 2]} />
      </mesh>
      {[-1, -0.33, 0.33, 1].map((x) => (
        <mesh key={x} position={[x, 2.4, 0.6]} material={kit.steelDark}>
          <boxGeometry args={[0.12, 3.6, 0.12]} />
        </mesh>
      ))}
      {[1.2, 2.4, 3.6].map((y) => (
        <mesh key={y} position={[0, y, 0.6]} material={kit.steelDark}>
          <boxGeometry args={[2.3, 0.12, 0.12]} />
        </mesh>
      ))}
      <mesh position={[0, 5, 1.02]} material={glow}>
        <boxGeometry args={[1.4, 0.35, 0.05]} />
      </mesh>
    </group>
  );
}

function DeployDock({ kit, glow }: Parts) {
  return (
    <group>
      <mesh position={[0, 0.25, 0]} material={kit.stoneDark} receiveShadow>
        <boxGeometry args={[6.4, 0.5, 4]} />
      </mesh>
      {[-2.6, 2.6].map((x) =>
        [-1.4, 1.4].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 3.5, z]} material={kit.steel} castShadow>
            <boxGeometry args={[0.35, 6.5, 0.35]} />
          </mesh>
        )),
      )}
      <mesh position={[0, 6.8, 0]} material={kit.steel} castShadow>
        <boxGeometry args={[6, 0.5, 3.2]} />
      </mesh>
      <mesh position={[0.8, 5.6, 0]} material={kit.steelDark}>
        <boxGeometry args={[0.04, 2, 0.04]} />
      </mesh>
      <mesh position={[0.8, 4.4, 0]} material={kit.wood} castShadow>
        <boxGeometry args={[1.4, 1, 1.4]} />
      </mesh>
      {[-1.6, 1.6].map((x) => (
        <mesh key={x} position={[x, 7.2, 1.62]} material={glow}>
          <sphereGeometry args={[0.18, 8, 6]} />
        </mesh>
      ))}
    </group>
  );
}

/** A district the daemon adds later gets the plan house. */
const BY_PHASE: Record<string, (p: Parts) => ReactElement> = {
  brainstorm: TestLab,
  plan: PlanHouse,
  build: BuildYard,
  qa: PreviewPier,
  review: ReviewHall,
  merge: MergeGate,
  deploy: DeployDock,
};

/** One district landmark on its own small stone plaza; its lights brighten when the district is lit or selected. */
export function Landmark({ phase, accent, active, lit }: LandmarkProps) {
  const kit = useKit();
  const glow = kit.light(accent, active ? 3 : lit ? 2.3 : 1.4);
  const Comp = BY_PHASE[phase] ?? PlanHouse;
  return (
    <group>
      <mesh position={[0, -0.25, 0]} material={kit.stone} receiveShadow castShadow>
        <cylinderGeometry args={[4.6, 3.6, 0.5, 8]} />
      </mesh>
      <mesh position={[0, -1.6, 0]} material={kit.stoneDark} castShadow>
        <coneGeometry args={[3.6, 2.4, 8]} />
      </mesh>
      <Comp kit={kit} glow={glow} />
    </group>
  );
}

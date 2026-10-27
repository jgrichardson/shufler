import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type LibraryProps } from '../api';
import { useKit } from './kit';

/* The context library: a domed stone hall with a columned portico; one drum window lights per library item. */

const DRUM_WINDOWS = 12;
const COLUMNS = 6;

/** Window angles from the front outward, alternating left and right, so the first items light where you look. */
const windowAngle = (i: number) => (i % 2 ? -1 : 1) * Math.ceil(i / 2) * ((Math.PI * 2) / DRUM_WINDOWS);

export function Library({ items, owed, active, hovered, dragging }: LibraryProps) {
  const kit = useKit();
  const { p } = kit;
  const strength = active ? 2.6 : hovered || dragging ? 2.1 : 1.6;
  const warm = kit.light(p.whGlow, strength);
  const amber = kit.light(p.deployBeam, 1.9);
  const dome = kit.tint(p.libraryDome, 0.5, 0.35);
  const pediment = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-2.55, 0);
    s.lineTo(2.55, 0);
    s.lineTo(0, 1.0);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 1.25, bevelEnabled: false });
  }, []);
  const lantern = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (lantern.current) lantern.current.scale.setScalar(owed > 0 && !reducedMotion() ? 1 + 0.2 * Math.sin(clock.elapsedTime * 3) : 1);
  });
  return (
    <group>
      {/* stone pad, like the district landmarks */}
      <mesh position={[0, -0.25, 0]} material={kit.stone} receiveShadow castShadow>
        <cylinderGeometry args={[4.6, 3.6, 0.5, 8]} />
      </mesh>
      <mesh position={[0, -1.6, 0]} material={kit.stoneDark} castShadow>
        <coneGeometry args={[3.6, 2.4, 8]} />
      </mesh>
      {/* three broad steps */}
      {[
        [6.6, 5.4, 0.11, kit.stoneDark],
        [6.0, 4.8, 0.33, kit.stone],
        [5.4, 4.2, 0.55, kit.stoneDark],
      ].map(([w, d, y, m], i) => (
        <mesh key={i} position={[0, y as number, 0.15]} material={m as THREE.Material} receiveShadow castShadow>
          <boxGeometry args={[w as number, 0.22, d as number]} />
        </mesh>
      ))}
      {/* the hall */}
      <mesh position={[0, 1.96, -0.5]} material={kit.stone} castShadow receiveShadow>
        <boxGeometry args={[4.8, 2.6, 2.8]} />
      </mesh>
      <mesh position={[0, 3.37, -0.5]} material={kit.stoneDark} castShadow>
        <boxGeometry args={[5.1, 0.22, 3.1]} />
      </mesh>
      {/* door, fanlight and tall windows behind the colonnade */}
      <mesh position={[0, 1.4, 0.91]} material={kit.wood}>
        <boxGeometry args={[0.9, 1.45, 0.04]} />
      </mesh>
      <mesh position={[0, 2.13, 0.92]} material={warm}>
        <circleGeometry args={[0.45, 20, 0, Math.PI]} />
      </mesh>
      {[-1.55, 1.55].map((x) => (
        <group key={x} position={[x, 1.95, 0.92]}>
          <mesh material={warm}>
            <planeGeometry args={[0.55, 1.2]} />
          </mesh>
          <mesh position={[0, 0.6, 0]} material={warm}>
            <circleGeometry args={[0.275, 16, 0, Math.PI]} />
          </mesh>
        </group>
      ))}
      {/* portico: six columns, entablature and pediment */}
      {Array.from({ length: COLUMNS }, (_, i) => {
        const x = -2.05 + (i * 4.1) / (COLUMNS - 1);
        return (
          <group key={i} position={[x, 0, 1.55]}>
            <mesh position={[0, 1.86, 0]} material={kit.stone} castShadow>
              <cylinderGeometry args={[0.15, 0.18, 2.4, 14]} />
            </mesh>
            <mesh position={[0, 3.1, 0]} material={kit.stoneDark}>
              <boxGeometry args={[0.44, 0.12, 0.44]} />
            </mesh>
            <mesh position={[0, 0.72, 0]} material={kit.stoneDark}>
              <boxGeometry args={[0.42, 0.1, 0.42]} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, 3.32, 1.2]} material={kit.stone} castShadow>
        <boxGeometry args={[5.1, 0.34, 1.3]} />
      </mesh>
      <mesh position={[0, 3.36, 1.86]} material={kit.steel}>
        <boxGeometry args={[4.6, 0.06, 0.02]} />
      </mesh>
      <mesh geometry={pediment} position={[0, 3.49, 0.6]} material={kit.stone} castShadow />
      <mesh position={[0, 3.82, 1.86]} material={warm}>
        <circleGeometry args={[0.2, 16]} />
      </mesh>
      {/* drum with one window per item, then the dome and its lantern */}
      <mesh position={[0, 4.13, -0.5]} material={kit.stone} castShadow>
        <cylinderGeometry args={[1.55, 1.6, 1.3, 32]} />
      </mesh>
      {Array.from({ length: DRUM_WINDOWS }, (_, i) => {
        const a = windowAngle(i);
        return (
          <group key={i} position={[0, 4.1, -0.5]} rotation={[0, a, 0]}>
            <mesh position={[0, 0, 1.585]} material={i < items ? warm : kit.steelDark}>
              <planeGeometry args={[0.3, 0.68]} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, 4.8, -0.5]} rotation={[Math.PI / 2, 0, 0]} material={kit.steel}>
        <torusGeometry args={[1.6, 0.06, 8, 48]} />
      </mesh>
      <mesh position={[0, 4.78, -0.5]} material={dome} castShadow>
        <sphereGeometry args={[1.62, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, 6.62, -0.5]} material={kit.stone}>
        <cylinderGeometry args={[0.34, 0.38, 0.5, 12]} />
      </mesh>
      <mesh ref={lantern} position={[0, 6.64, -0.5]} material={owed > 0 ? amber : warm}>
        <cylinderGeometry args={[0.36, 0.36, 0.3, 12, 1, true]} />
      </mesh>
      <mesh position={[0, 7.1, -0.5]} material={kit.steelDark}>
        <coneGeometry args={[0.42, 0.5, 12]} />
      </mesh>
      <mesh position={[0, 7.45, -0.5]} material={kit.steel}>
        <sphereGeometry args={[0.1, 10, 8]} />
      </mesh>
      {/* lamps either side of the steps */}
      {[-2.9, 2.9].map((x) => (
        <group key={x} position={[x, 0, 2.55]}>
          <mesh position={[0, 0.65, 0]} material={kit.lampPost}>
            <cylinderGeometry args={[0.05, 0.07, 1.3, 8]} />
          </mesh>
          <mesh position={[0, 1.38, 0]} material={owed > 0 ? amber : warm}>
            <sphereGeometry args={[0.16, 12, 10]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

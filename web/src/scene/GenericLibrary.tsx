import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { LibraryProps } from '../skins/types';
import { reducedMotion } from '../ui/motionPrefs';

/* The library a skin gets when it supplies none: a plain stone archive with one lit volume per item. */

const stone = new THREE.MeshStandardMaterial({ color: '#d8d3cb', roughness: 0.7 });
const trim = new THREE.MeshStandardMaterial({ color: '#6c707a', roughness: 0.5, metalness: 0.3 });
const shelf = new THREE.MeshStandardMaterial({ color: '#2c2f36', roughness: 0.8 });
const dark = new THREE.MeshStandardMaterial({ color: '#4a4d55', roughness: 0.6 });
const lit = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(1.8), toneMapped: false });
const litHi = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(2.6), toneMapped: false });
const owedMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffae42').multiplyScalar(2.8), toneMapped: false });

const COLS = 5;
const ROWS = 3;

export function GenericLibrary({ items, owed, active, hovered }: LibraryProps) {
  const beacon = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const b = beacon.current;
    if (!b) return;
    const k = owed > 0 && !reducedMotion() ? 1 + 0.18 * Math.sin(clock.elapsedTime * 3) : 1;
    b.scale.setScalar(k);
  });
  const glow = active || hovered ? litHi : lit;
  return (
    <group>
      <mesh position={[0, -0.25, 0]} material={stone} receiveShadow castShadow>
        <cylinderGeometry args={[4.5, 4.2, 0.5, 8]} />
      </mesh>
      <mesh position={[0, -1.5, 0]} material={dark} castShadow>
        <coneGeometry args={[4.2, 2.2, 8]} />
      </mesh>
      <mesh position={[0, 2.1, -0.3]} material={stone} castShadow receiveShadow>
        <boxGeometry args={[6, 4.2, 3.6]} />
      </mesh>
      <mesh position={[0, 2.1, 1.5]} material={shelf}>
        <boxGeometry args={[5.2, 3.4, 0.1]} />
      </mesh>
      {Array.from({ length: COLS * ROWS }, (_, i) => {
        const c = i % COLS;
        const r = Math.floor(i / COLS);
        return (
          <mesh key={i} position={[(c - (COLS - 1) / 2) * 0.95, 3.2 - r * 1.1, 1.6]} material={i < items ? glow : dark}>
            <boxGeometry args={[0.55, 0.85, 0.12]} />
          </mesh>
        );
      })}
      <mesh position={[0, 4.35, -0.3]} material={trim}>
        <boxGeometry args={[6.4, 0.3, 4]} />
      </mesh>
      <mesh position={[0, 5.4, -0.3]} rotation={[0, Math.PI / 4, 0]} material={trim} castShadow>
        <coneGeometry args={[3.7, 1.8, 4]} />
      </mesh>
      <mesh ref={beacon} position={[0, 6.6, -0.3]} material={owed > 0 ? owedMat : glow}>
        <sphereGeometry args={[0.32, 16, 12]} />
      </mesh>
    </group>
  );
}

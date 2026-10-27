import { useMemo } from 'react';
import * as THREE from 'three';
import { useResolvedTheme, type DistrictBandProps, type LaneProps, type RampProps } from '../api';
import { useKit } from './kit';

const DECK_W = 2.0;

const band = (color: string, opacity: number) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, metalness: 0.3, clearcoat: 1, transparent: true, opacity, depthWrite: false });
/** Dark glass under the columns; frosted pale glass in light mode. */
const bandMats = { dark: [band('#18233a', 0.6), band('#0f1729', 0.6)], light: [band('#eef3f9', 0.78), band('#d5e0ec', 0.78)] };
const tints = new Map<string, THREE.MeshBasicMaterial>();
/** Light mode's selected-column wash: the accent as a translucent film, not a dim self-lit strip. */
const tintMat = (accent: string) => {
  let m = tints.get(accent);
  if (!m) tints.set(accent, (m = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.42, depthWrite: false })));
  return m;
};

/** Graphite deck with a domain-tinted inlay, a lit centre line and titanium rails; keels with light bars underneath. */
export function Lane({ x0, x1, color, supports }: LaneProps) {
  const kit = useKit();
  const len = x1 - x0;
  const mid = (x0 + x1) / 2;
  const inlay = useMemo(() => new THREE.Color(color).lerp(new THREE.Color(kit.p.graphite), 0.55), [color, kit.p.graphite]);
  return (
    <group>
      <mesh position={[mid, -0.45, 0]} material={kit.graphite} castShadow receiveShadow>
        <boxGeometry args={[len, 0.36, DECK_W]} />
      </mesh>
      <mesh position={[mid, -0.26, 0]} receiveShadow>
        <boxGeometry args={[len, 0.04, 0.7]} />
        <meshStandardMaterial color={inlay} roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh position={[mid, -0.23, 0]} material={kit.light(color, 1.7)}>
        <boxGeometry args={[len, 0.03, 0.09]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[mid, -0.12, (side * DECK_W) / 2]} material={kit.ti}>
          <boxGeometry args={[len, 0.1, 0.08]} />
        </mesh>
      ))}
      {supports.map((x) => (
        <group key={x} position={[x, -0.6, 0]}>
          <mesh position={[0, -0.35, 0]} material={kit.graphite} castShadow>
            <boxGeometry args={[0.5, 0.7, 1.4]} />
          </mesh>
          <mesh position={[0, -0.72, 0]} material={kit.light(kit.p.light, 2.2)}>
            <boxGeometry args={[0.3, 0.05, 1.0]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Ramp({ length, color }: RampProps) {
  const kit = useKit();
  return (
    <group>
      <mesh material={kit.graphite} castShadow receiveShadow>
        <boxGeometry args={[length, 0.3, 2.4]} />
      </mesh>
      <mesh position={[0, 0.17, 0]} material={kit.light(color, 1.5)}>
        <boxGeometry args={[length, 0.03, 0.12]} />
      </mesh>
    </group>
  );
}

/** Dark-glass floor under the column and a titanium bridge with a lit edge at its leading side. */
export function DistrictBand({ index, accent, width, depth, edgeX, active }: DistrictBandProps) {
  const kit = useKit();
  const theme = useResolvedTheme();
  return (
    <group>
      <mesh position={[0, -1.4, 0]} material={bandMats[theme][index % 2]} receiveShadow>
        <boxGeometry args={[width - 0.3, 0.12, depth]} />
      </mesh>
      {active && (
        <mesh position={[0, -1.32, 0]} material={theme === 'light' ? tintMat(accent) : kit.light(accent, 0.16)}>
          <boxGeometry args={[width - 0.3, 0.02, depth]} />
        </mesh>
      )}
      <group position={[edgeX, 0, 0]}>
        <mesh position={[0, 0.55, 0]} material={kit.ti} castShadow>
          <boxGeometry args={[0.32, 0.22, depth]} />
        </mesh>
        <mesh position={[0, 0.69, 0]} material={kit.light(accent, active ? 2.4 : 1.4)}>
          <boxGeometry args={[0.34, 0.06, depth]} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, -0.4, (side * depth) / 2]} material={kit.ti} castShadow>
            <boxGeometry args={[0.4, 2.1, 0.4]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

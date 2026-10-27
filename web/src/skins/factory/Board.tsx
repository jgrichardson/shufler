import type { DistrictBandProps, LaneProps, RampProps } from '../api';
import { glowMat, useKit } from './kit';

const DECK_W = 2.0;
const keelGlow = glowMat(2.2, 1.7, 1.1);

/** Lavender-grey deck with a painted domain stripe, steel rails, and a keel with a warm light under each district. */
export function Lane({ x0, x1, color, supports }: LaneProps) {
  const kit = useKit();
  const len = x1 - x0;
  const mid = (x0 + x1) / 2;
  return (
    <group>
      <mesh position={[mid, -0.45, 0]} material={kit.deck} castShadow receiveShadow>
        <boxGeometry args={[len, 0.36, DECK_W]} />
      </mesh>
      <mesh position={[mid, -0.26, 0]} material={kit.tint(color, 0.6)} receiveShadow>
        <boxGeometry args={[len, 0.04, 0.7]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[mid, -0.12, (side * DECK_W) / 2]} material={kit.rail}>
          <boxGeometry args={[len, 0.1, 0.08]} />
        </mesh>
      ))}
      {supports.map((x) => (
        <group key={x} position={[x, -0.6, 0]}>
          <mesh position={[0, -0.6, 0]} material={kit.deck} castShadow>
            <coneGeometry args={[0.7, 1.4, 6]} />
          </mesh>
          <mesh position={[0, -1.4, 0]} material={keelGlow}>
            <sphereGeometry args={[0.13, 6, 4]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Deck-coloured bridge from the island up to its lane, with the domain stripe. */
export function Ramp({ length, color }: RampProps) {
  const kit = useKit();
  return (
    <group>
      <mesh material={kit.deck} castShadow receiveShadow>
        <boxGeometry args={[length, 0.3, 2.4]} />
      </mesh>
      <mesh position={[0, 0.17, 0]} material={kit.tint(color, 0.6)}>
        <boxGeometry args={[length, 0.03, 0.5]} />
      </mesh>
    </group>
  );
}

/** A translucent floor band under the column (alternating shade) and a thin bridge with a lit edge at its start. */
export function DistrictBand({ index, accent, width, depth, edgeX }: DistrictBandProps) {
  const kit = useKit();
  return (
    <group>
      <mesh position={[0, -1.4, 0]} material={kit.bands[index % 2]} receiveShadow>
        <boxGeometry args={[width - 0.3, 0.12, depth]} />
      </mesh>
      <group position={[edgeX, 0, 0]}>
        <mesh position={[0, 0.55, 0]} material={kit.bridge} castShadow>
          <boxGeometry args={[0.32, 0.22, depth]} />
        </mesh>
        <mesh position={[0, 0.69, 0]} material={kit.light(accent, 1.4)}>
          <boxGeometry args={[0.34, 0.06, depth]} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, -0.4, (side * depth) / 2]} material={kit.bridge} castShadow>
            <boxGeometry args={[0.4, 2.1, 0.4]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

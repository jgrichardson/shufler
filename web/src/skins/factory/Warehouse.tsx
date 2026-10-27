import { Beam, RACK_DEPTH, RACK_LEN, SHELF_Y, WAREHOUSE_WALL_H, type DockProps, type RackProps, type WarehouseShellProps } from '../api';
import { Platform } from './Island';
import { useKit } from './kit';

/** The hall: slab, back and far walls, an open front on slim columns, sawtooth roof over the back with lit glazing. */
function Hall({ g, deployed }: { g: WarehouseShellProps['g']; deployed: number }) {
  const kit = useKit();
  const H = WAREHOUSE_WALL_H;
  const depth = g.backX - g.frontX;
  const roofW = g.backX - g.roofFromX;
  const roofCx = (g.roofFromX + g.backX) / 2;
  const teeth = Math.max(2, Math.round(g.length / 5));
  const pitch = g.length / teeth;
  const rise = 1.9;
  const slope = Math.atan2(rise, pitch);
  const cols = Math.max(2, Math.round(g.length / 6));
  return (
    <group>
      <mesh position={[g.cx, g.floor - 0.15, g.cz]} material={kit.whSlab} receiveShadow castShadow>
        <boxGeometry args={[depth + 1, 0.3, g.length + 1]} />
      </mesh>
      {/* back wall and the far end wall; the near end stays open towards the camera */}
      <mesh position={[g.backX, g.floor + H / 2, g.cz]} material={kit.whWall} castShadow receiveShadow>
        <boxGeometry args={[0.4, H, g.length]} />
      </mesh>
      <mesh position={[g.cx, g.floor + H / 2, g.zMin]} material={kit.whWall} castShadow>
        <boxGeometry args={[depth, H, 0.4]} />
      </mesh>
      {/* warm light strips along the back wall and under the roof edge */}
      <mesh position={[g.backX - 0.25, g.floor + H - 0.6, g.cz]} material={kit.whGlow}>
        <boxGeometry args={[0.06, 0.18, g.length - 1]} />
      </mesh>
      <mesh position={[g.roofFromX + 0.2, g.floor + H - 0.25, g.cz]} material={kit.whGlow}>
        <boxGeometry args={[0.1, 0.12, g.length - 1]} />
      </mesh>
      {/* front columns, fascia and open rafters */}
      {Array.from({ length: cols + 1 }, (_, i) => g.zMin + (i * g.length) / cols).map((z) => (
        <group key={z}>
          <mesh position={[g.frontX, g.floor + H / 2, z]} material={kit.whTrim} castShadow>
            <boxGeometry args={[0.32, H, 0.32]} />
          </mesh>
          <mesh position={[(g.frontX + g.roofFromX) / 2, g.floor + H, z]} material={kit.whTrim}>
            <boxGeometry args={[g.roofFromX - g.frontX, 0.18, 0.16]} />
          </mesh>
        </group>
      ))}
      <mesh position={[g.frontX, g.floor + H, g.cz]} material={kit.whTrim} castShadow>
        <boxGeometry args={[0.4, 0.34, g.length + 0.4]} />
      </mesh>
      {/* sawtooth roof: each tooth slopes up toward the far end, its glazed face looks at the camera */}
      {Array.from({ length: teeth }, (_, i) => {
        const zHigh = g.zMin + i * pitch;
        const zLow = zHigh + pitch;
        return (
          <group key={i}>
            <mesh position={[roofCx, g.floor + H + rise / 2, (zHigh + zLow) / 2]} rotation={[-slope, 0, 0]} material={kit.whRoof} castShadow receiveShadow>
              <boxGeometry args={[roofW, 0.14, Math.hypot(pitch, rise)]} />
            </mesh>
            {i > 0 && (
              <mesh position={[roofCx, g.floor + H + rise / 2, zHigh]} material={kit.whGlazing}>
                <boxGeometry args={[roofW - 0.2, rise, 0.06]} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* roof lantern: carries the gold "deployed this week" beam */}
      <group position={[roofCx, g.floor + H + rise + 0.1, g.cz]}>
        <mesh material={kit.whTrim} castShadow>
          <boxGeometry args={[2.2, 0.25, 2.2]} />
        </mesh>
        <mesh position={[0, 0.75, 0]} material={kit.whGlazing}>
          <boxGeometry args={[1.6, 1.2, 1.6]} />
        </mesh>
        <mesh position={[0, 1.55, 0]} rotation={[0, Math.PI / 4, 0]} material={kit.whRoof} castShadow>
          <coneGeometry args={[1.45, 0.8, 4]} />
        </mesh>
        {deployed > 0 && (
          <group position={[0, 2.0, 0]}>
            <Beam color={kit.p.deployBeam} height={110} radius={0.6} intensity={0.5} />
          </group>
        )}
      </group>
    </group>
  );
}

/** The cream warehouse on its own grass island, with the landing ramp from the end of the lanes. */
export function WarehouseShell({ g, deployed, ramp }: WarehouseShellProps) {
  const kit = useKit();
  return (
    <group>
      <group position={[g.island.cx, g.floor - 0.3, g.cz]}>
        <Platform radius={g.island.radius} seed={77} stretch={g.island.stretch} detail={false} />
      </group>
      <mesh position={ramp.position} rotation={[0, 0, ramp.rotationZ]} material={kit.whRamp} castShadow>
        <boxGeometry args={ramp.size} />
      </mesh>
      <Hall g={g} deployed={deployed} />
    </group>
  );
}

/** Rack frame in the domain colour with three wooden shelves; drawn at the rack's front-left corner on the floor. */
export function Rack({ color }: RackProps) {
  const kit = useKit();
  const frame = kit.tint(color, 0.5, 0.2);
  const height = SHELF_Y[SHELF_Y.length - 1] + 1.3;
  const posts = Array.from({ length: 4 }, (_, i) => (i * RACK_LEN) / 3);
  return (
    <group>
      {posts.flatMap((x) =>
        [-1, 1].map((side) => (
          <mesh key={`${x}${side}`} position={[x, height / 2, (side * RACK_DEPTH) / 2]} material={frame} castShadow>
            <boxGeometry args={[0.14, height, 0.14]} />
          </mesh>
        )),
      )}
      {SHELF_Y.map((y) => (
        <mesh key={y} position={[RACK_LEN / 2, y, 0]} material={kit.whShelf} receiveShadow castShadow>
          <boxGeometry args={[RACK_LEN + 0.2, 0.08, RACK_DEPTH + 0.1]} />
        </mesh>
      ))}
      {/* top rails and shelf edges in the domain colour, so the rack reads from above without hiding the crates */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[RACK_LEN / 2, height, (side * RACK_DEPTH) / 2]} material={frame}>
          <boxGeometry args={[RACK_LEN + 0.2, 0.14, 0.16]} />
        </mesh>
      ))}
      {SHELF_Y.map((y) => (
        <mesh key={`edge${y}`} position={[RACK_LEN / 2, y + 0.02, RACK_DEPTH / 2 + 0.06]} material={frame}>
          <boxGeometry args={[RACK_LEN + 0.2, 0.12, 0.06]} />
        </mesh>
      ))}
    </group>
  );
}

/** Loading bay: slab, a roller conveyor on legs and the orange-framed bay door into the hall. */
export function Dock({ g, bay: b }: DockProps) {
  const kit = useKit();
  const rollers = Math.floor(b.len / 0.55);
  return (
    <group>
      <mesh position={[b.cx, g.floor + 0.05, b.z]} material={kit.whSlab} castShadow receiveShadow>
        <boxGeometry args={[b.len + 0.6, 0.6, 6]} />
      </mesh>
      {/* conveyor bed on legs, rollers across it */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[b.cx, b.beltY - 0.12, b.z + side * 1.05]} material={kit.whSteel} castShadow>
          <boxGeometry args={[b.len, 0.2, 0.12]} />
        </mesh>
      ))}
      {Array.from({ length: 4 }, (_, i) => b.x0 + 0.4 + (i * (b.len - 0.8)) / 3).map((x) => (
        <mesh key={x} position={[x, (g.floor + b.beltY) / 2, b.z]} material={kit.whSteel}>
          <boxGeometry args={[0.12, b.beltY - g.floor, 1.9]} />
        </mesh>
      ))}
      {Array.from({ length: rollers }, (_, i) => b.x0 + 0.3 + i * 0.55).map((x) => (
        <mesh key={x} position={[x, b.beltY - 0.06, b.z]} rotation={[Math.PI / 2, 0, 0]} material={kit.whRoller}>
          <cylinderGeometry args={[0.11, 0.11, 2.0, 8]} />
        </mesh>
      ))}
      {/* bay door into the warehouse: orange frame, roller door half up */}
      <group position={[g.frontX, g.floor, b.z]}>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, 1.9, side * 1.6]} material={kit.whDoor} castShadow>
            <boxGeometry args={[0.36, 3.8, 0.3]} />
          </mesh>
        ))}
        <mesh position={[0, 3.9, 0]} material={kit.whDoor} castShadow>
          <boxGeometry args={[0.4, 0.4, 3.6]} />
        </mesh>
        <mesh position={[0, 3.2, 0]} material={kit.whDoorPanel}>
          <boxGeometry args={[0.1, 1.0, 2.9]} />
        </mesh>
      </group>
    </group>
  );
}

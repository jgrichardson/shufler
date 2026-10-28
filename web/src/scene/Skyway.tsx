import { useEffect, useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Phase } from '../types';
import { PHASES } from '../lib/domains';
import { PHASE_ACCENT } from '../lib/colors';
import { dispatch } from '../store';
import { useSkin } from '../skins/store';
import { MorphFade, MorphShift, MorphSqueeze } from './MorphFade';
import { Dimmable } from './Dimmable';
import { strip } from './StripProjector';
import { outside, type Focus } from './focus';
import { BAND_W, LANDMARK, RAMP_END_X, SKY_Y, skywayEndX, cellX, gateArchX, type SceneLayout } from './layout';
import { BOULEVARD_SINK, islandsK, morphK } from './morph';

/** Ramps fade with their row islands in Pipeline mode, and with the boulevard under big islands. */
const rampFade = () => Math.max(morphK(), islandsK());

/** Bridge from the island's edge up to the start of its lane. */
function Ramp({ from, z, color }: { from: [number, number]; z: number; color: string }) {
  const { Ramp: Body } = useSkin().components;
  const [x0, y0] = from;
  const x1 = RAMP_END_X + 0.5;
  const y1 = SKY_Y - 0.45;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const angle = Math.atan2(y1 - y0, x1 - x0);
  return (
    <group position={[(x0 + x1) / 2, (y0 + y1) / 2, z]} rotation={[0, 0, angle]}>
      <Body length={len} color={color} />
    </group>
  );
}

function Gate({ phase, zBack, active, lit }: { phase: Exclude<Phase, 'shipped'>; zBack: number; active: boolean; lit: boolean }) {
  const skin = useSkin();
  const { Landmark } = skin.components;
  const accent = PHASE_ACCENT[phase];
  const [hovered, setHovered] = useState(false);
  useEffect(() => () => strip.cells.get(phase)?.classList.remove('is-hot'), [phase]);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(hovered ? 3.2 : active ? 2.4 : 1.4), toneMapped: false }), [accent, active, hovered]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // gone with the boulevard under big islands
    if (islandsK() > 0.5) return;
    e.stopPropagation();
    dispatch({ type: 'select', selection: { kind: 'gate', phase } });
  };
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    if (islandsK() > 0.5) return;
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
    setHovered(true);
    // the landmark lights its column tag, so hover names what a click selects
    strip.cells.get(phase)?.classList.add('is-hot');
  };
  const onOut = () => {
    document.body.style.cursor = '';
    setHovered(false);
    strip.cells.get(phase)?.classList.remove('is-hot');
  };
  return (
    <group position={[cellX(phase), SKY_Y - 0.5, 0]} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
      <group position={[0, -0.2, zBack - LANDMARK.back]} scale={skin.scene.landmarkScale ?? LANDMARK.scale}>
        <Landmark phase={phase} accent={accent} active={active} lit={lit} />
      </group>
      {/* column marker at the back edge of the board */}
      <mesh position={[0, 0.02, zBack + 0.6]} material={glowMat}>
        <boxGeometry args={[12.2, 0.06, 0.18]} />
      </mesh>
    </group>
  );
}

export function Skyway({ layout, gateSelected, litPhases, ramps = true, focus }: { layout: SceneLayout; gateSelected: Phase | null; litPhases: Set<string>; ramps?: boolean; focus: Focus | null }) {
  const { Lane, DistrictBand } = useSkin().components;
  const zBack = layout.bounds.minZ - 2.4;
  const bandFront = layout.bounds.maxZ + 3.5;
  const bandBack = Math.min(zBack - 1, layout.pipe.backZ);
  const end = skywayEndX();
  const supports = useMemo(() => Array.from({ length: Math.max(1, Math.floor((end - RAMP_END_X - 7) / BAND_W) + 1) }, (_, i) => RAMP_END_X + 7 + i * BAND_W), [end]);
  const offPhase = (p: Phase) => outside(focus?.phases, p, focus);
  const offLane = (i: number | null) => outside(focus?.lanes, i, focus);
  return (
    <group>
      {/* the boulevard steps aside for big islands */}
      <MorphFade amount={islandsK} sink={BOULEVARD_SINK} vanish>
      {PHASES.map((p, i) => (
        <Dimmable key={p} on={offPhase(p)}>
          <group position={[cellX(p), SKY_Y, (bandFront + bandBack) / 2]}>
            <DistrictBand phase={p} index={i} accent={PHASE_ACCENT[p]} width={BAND_W} depth={bandFront - bandBack} edgeX={gateArchX(p) - cellX(p)} active={gateSelected === p} />
          </group>
        </Dimmable>
      ))}
      <MorphSqueeze midZ={layout.pipe.midZ} scale={layout.pipe.laneScale}>
        {layout.lanes.map(({ id, domain, z }, i) => (
          <Dimmable key={id} on={offLane(i)}>
            <group position={[0, SKY_Y, z]}>
              <Lane x0={RAMP_END_X} x1={end} color={domain.color} supports={supports} />
            </group>
          </Dimmable>
        ))}
      </MorphSqueeze>
      <MorphShift dz={layout.pipe.backZ - zBack}>
        {PHASES.map((p) => (
          <Dimmable key={p} on={offPhase(p)}>
            <Gate phase={p} zBack={zBack} active={gateSelected === p} lit={litPhases.has(p)} />
          </Dimmable>
        ))}
      </MorphShift>
      </MorphFade>
      {ramps && (
        <MorphFade amount={rampFade}>
          {layout.islands
            .filter((i) => i.lane != null)
            .map((isl) => (
              <Dimmable key={isl.id} on={offLane(isl.lane)}>
                <Ramp from={[isl.center[0] + isl.radius * isl.stretch * 0.86, isl.top + 0.05]} z={isl.center[2]} color={isl.color} />
              </Dimmable>
            ))}
        </MorphFade>
      )}
    </group>
  );
}

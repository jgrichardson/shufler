import { useEffect, useMemo, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { selectLibrary, useWorld } from '../store';
import { owedSessions } from '../lib/library';
import { useSkin } from '../skins/store';
import { useLibDrag } from '../ui/library/drag';
import { GroundRing, useSelectRing } from './Building';
import { beamAvoid } from './Beam';
import { Dimmable } from './Dimmable';
import { HoverHalo, HoverLift } from './Hover';
import { MorphFade } from './MorphFade';
import { GenericLibrary } from './GenericLibrary';
import { morphK } from './morph';
import { LIBRARY, libraryPos, type SceneLayout } from './layout';

/** The DOM name tag over the library, placed every frame below. */
export const libTag = { el: null as HTMLElement | null };

/** Keep clear of the top bar and layer bar. */
const TOP_MIN = 104;

/** Projects the library's name tag to just above the building; hidden in Pipeline mode and when off screen. */
function TagProjector({ pos }: { pos: [number, number, number] }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const el = libTag.el;
    if (!el) return;
    // the base first: when even that is under the top bar, the building is off screen
    v.set(pos[0], pos[1], pos[2]).project(camera);
    const baseY = (-v.y * 0.5 + 0.5) * size.height;
    v.set(pos[0], pos[1] + LIBRARY.height * LIBRARY.scale + 1.5, pos[2]).project(camera);
    const w = el.offsetWidth || 110;
    const h = el.offsetHeight || 30;
    const x = (v.x * 0.5 + 0.5) * size.width - w / 2;
    const y = Math.max(TOP_MIN, (-v.y * 0.5 + 0.5) * size.height - h);
    const show = morphK() < 0.5 && v.z < 1 && baseY > TOP_MIN + h && baseY < size.height && x > -w && x < size.width;
    el.style.visibility = show ? 'visible' : 'hidden';
    if (show) el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  });
  return null;
}

/**
 * The context library: a landmark back-left of the board. The skin draws it (or the generic one stands in);
 * the core places it, greys it out with the focus, fades it in Pipeline mode and selects it on click.
 */
export function Library({ layout, dimmed, detail }: { layout: SceneLayout; dimmed: boolean; detail: boolean }) {
  const Body = useSkin().components.Library ?? GenericLibrary;
  const items = useWorld((s) => s.snapshot?.library?.items ?? 0);
  const owed = useWorld((s) => owedSessions(s.snapshot?.library?.owed));
  const active = useWorld((s) => s.selection?.kind === 'library');
  const dragging = useLibDrag((s) => !!s.itemIds);
  const [hovered, setHovered] = useState(false);
  const pos = useMemo(() => libraryPos(layout), [layout]);
  const ring = useSelectRing();
  // need-me beams fade where they pass in front of the building
  useEffect(() => {
    beamAvoid.pos.value.set(...pos);
    beamAvoid.height.value = (LIBRARY.height + 1) * LIBRARY.scale;
    beamAvoid.radius.value = LIBRARY.radius * 0.75;
    return () => void (beamAvoid.radius.value = 0);
  }, [pos]);
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
    setHovered(true);
  };
  const onOut = () => {
    document.body.style.cursor = '';
    setHovered(false);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectLibrary();
  };
  return (
    <>
      <TagProjector pos={pos} />
      <MorphFade>
        <Dimmable on={dimmed}>
          <group position={pos} scale={LIBRARY.scale}>
            <group onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
              <HoverLift on={hovered && !dimmed} lift={0.3} grow={0.03}>
                <Body items={items} owed={owed} active={active} hovered={hovered} dragging={dragging} detail={detail} />
              </HoverLift>
            </group>
            {active && <GroundRing color={ring} radius={4.8} spin={false} pulse />}
            <HoverHalo on={hovered && !active && !dimmed} radius={4.8} />
          </group>
        </Dimmable>
      </MorphFade>
    </>
  );
}

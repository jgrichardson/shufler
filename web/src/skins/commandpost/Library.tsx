import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type LibraryProps } from '../api';
import { Bins, GROUND_Y, MAP_TILE, box, chunk, lettered, post, roundedRect, stencilText, strut, useKit, v3 } from './kit';

/*
 * The context library is the signals hut: a low radio building on its own pad with a radome on the roof
 * and a dish on a mast beside it. Each library item lights one plotting screen along the front wall, up to
 * what fits. While sessions are owed pinned context, a beacon on the mast pulses; the dish turns slowly,
 * and faster while a card is dragged out of the library.
 */

const SCALE = 2.5;
const ORIGIN_Y = 4.8;
const FLOOR = (GROUND_Y - ORIGIN_Y) / SCALE - 0.02;
const SCREENS = 8;

export function Library({ items, owed, active, hovered, dragging }: LibraryProps) {
  const kit = useKit();
  const geo = useMemo(() => {
    const b = new Bins();
    const { p } = kit;
    // the pad
    const pad = new THREE.ExtrudeGeometry(roundedRect(8.6, 8.0, 1.4), { depth: -FLOOR, bevelEnabled: false, curveSegments: 5 });
    pad.rotateX(Math.PI / 2);
    const pos = pad.getAttribute('position') as THREE.BufferAttribute;
    const uv = pad.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) * SCALE) / MAP_TILE, (-pos.getZ(i) * SCALE) / MAP_TILE);
    // the hut
    b.paint('v', chunk(5.4, 2.3, 3.0, 0.1).translate(-0.4, 0, -0.6), p.khaki);
    b.paint('v', chunk(5.7, 0.22, 3.3, 0.06).translate(-0.4, 2.3, -0.6), p.oliveDark);
    b.paint('v', box(0.8, 1.6, 0.06, 1.75, 0.8, 0.92), p.oliveDark);
    // the screens' frame along the front wall
    b.paint('v', box(3.3, 0.9, 0.06, -1.15, 1.35, 0.92), p.bezel);
    // the radome's drum on the roof
    b.paint('v', new THREE.CylinderGeometry(0.95, 1.05, 0.4, 16).translate(-1.5, 2.72, -0.8), p.oliveDark);
    // the dish mast, with its ladder rungs
    b.paint('v', post(3.2, -1.6, 0, 5.2, 0.12, 8), p.steel);
    for (let y = 0.5; y < 5; y += 0.5) b.paint('v', box(0.3, 0.04, 0.04, 3.2, y, -1.45), p.steel);
    // the beacon's bezel at the top of the mast
    b.paint('v', new THREE.CylinderGeometry(0.34, 0.28, 0.3, 12).translate(3.2, 5.95, -1.6), p.bezel);
    // a generator and a fuel drum by the wall
    b.paint('v', chunk(1.0, 0.7, 0.7, 0.05).translate(-3.6, 0, 0.4), p.olive);
    b.paint('v', new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12).translate(-3.5, 0.4, 1.4), p.oliveDark);
    // cable from the hut to the mast
    b.paint('v', strut(v3(2.3, 2.0, -1.4), v3(3.1, 3.4, -1.6), 0.04, 4), p.tyre);
    const screens = Array.from({ length: SCREENS }, (_, i) => box(0.32, 0.6, 0.03, -2.6 + (i % 8) * 0.415, 1.35, 0.96));
    return { m: b.merged(), pad, screens };
  }, [kit]);
  const mats = useMemo(() => [kit.mapTop, kit.cliff], [kit]);
  const strength = active ? 2.6 : hovered || dragging ? 2.1 : kit.light ? 1.1 : 1.6;
  const on = kit.glow(kit.p.screen, strength);
  const label = useMemo(
    () =>
      lettered(256, 64, (g, w, h) => {
        g.fillStyle = kit.p.olive;
        g.fillRect(0, 0, w, h);
        stencilText(g, 'SIGNALS', w / 2, h / 2 + 2, 40, kit.p.stencil, { bg: kit.p.olive, spacing: 6 });
      }),
    [kit],
  );
  const dish = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    if (dish.current && !reducedMotion()) dish.current.rotation.y += dt * (dragging ? 2.4 : 0.35);
    if (beacon.current) beacon.current.scale.setScalar(owed > 0 && !reducedMotion() ? 1 + 0.25 * Math.sin(clock.elapsedTime * 3) : 1);
  });
  return (
    <group>
      <mesh geometry={geo.pad} material={mats} castShadow receiveShadow />
      <mesh geometry={geo.m.v} material={kit.vcol} castShadow receiveShadow />
      {geo.screens.map((s, i) => (
        <mesh key={i} geometry={s} material={i < items ? on : kit.bezel} />
      ))}
      <mesh position={[-1.5, 3.6, -0.8]} material={kit.painted(kit.p.stencil, 0.45)} castShadow>
        <sphereGeometry args={[1.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 1.7]} />
      </mesh>
      <mesh position={[0.4, 2.05, 0.95]}>
        <planeGeometry args={[1.8, 0.45]} />
        <meshStandardMaterial map={label} roughness={0.7} emissive="#ffffff" emissiveMap={label} emissiveIntensity={kit.light ? 0.04 : 0.3} />
      </mesh>
      <group ref={dish} position={[3.2, 5.2, -1.6]}>
        <mesh position={[0, 0.2, 0.25]} rotation={[-1.1, 0, 0]} material={kit.steel} castShadow>
          <sphereGeometry args={[0.9, 18, 8, 0, Math.PI * 2, 0, 0.85]} />
        </mesh>
      </group>
      <mesh ref={beacon} position={[3.2, 6.2, -1.6]} material={kit.glow(owed > 0 ? '#ff6b4a' : kit.p.screen, owed > 0 ? 2.8 : 1.2)}>
        <sphereGeometry args={[0.28, 14, 10]} />
      </mesh>
    </group>
  );
}

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type LibraryProps } from '../api';
import { Bins, FLOOR_Y, box, useKit } from './kit';

/*
 * The context library is the dealing shoe: a smoked-glass shoe on a walnut and brass plinth, holding the
 * deck of context cards. Each library item lights one card's edge inside the shoe; the top card waits at the
 * mouth, ready to deal. When sessions are owed pinned context, a lamp on the shoe's crest pulses.
 */

const SCALE = 2.5;
const ORIGIN_Y = 4.8;
const FLOOR = (FLOOR_Y - ORIGIN_Y) / SCALE - 0.02;
const CARDS = 14;

/** Side profile of the shoe (z along its length, y up), extruded across its width. */
function shoeGeometry(width: number) {
  const s = new THREE.Shape();
  s.moveTo(-2.7, 0);
  s.lineTo(2.3, 0);
  s.lineTo(2.3, 0.9);
  s.lineTo(1.7, 1.55);
  s.lineTo(-2.7, 2.6);
  s.lineTo(-2.7, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  // shape x runs along the shoe (world z), the extrusion across it (world x)
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

export function Library({ items, owed, active, hovered, dragging }: LibraryProps) {
  const kit = useKit();
  const width = 3.0;
  const geo = useMemo(() => {
    const b = new Bins();
    b.add('woodDark', new THREE.CylinderGeometry(4.3, 4.5, -FLOOR, 48).translate(0, FLOOR / 2, 0));
    b.add('felt', new THREE.CylinderGeometry(4.05, 4.05, 0.06, 48).translate(0, 0.03, 0));
    b.add('brass', new THREE.TorusGeometry(4.18, 0.13, 8, 64).rotateX(Math.PI / 2).translate(0, 0.02, 0));
    // walnut sled under the shoe and brass end plates
    b.add('wood', box(width + 0.5, 0.35, 5.6, 0, 0.18, -0.2, 0.5));
    b.add('brass', box(width + 0.24, 2.7, 0.12, 0, 0.35 + 1.33, -2.95));
    b.add('brass', box(width + 0.24, 0.12, 5.2, 0, 0.42, -0.2));
    // the mouth's roller
    b.add('brass', new THREE.CylinderGeometry(0.12, 0.12, width - 0.2, 12).rotateZ(Math.PI / 2).translate(0, 1.38, 2.05));
    // the crest: a brass finial for the owed lamp
    b.add('brass', new THREE.CylinderGeometry(0.16, 0.24, 0.5, 12).translate(0, 3.1, -2.4));
    // cards inside, leaning toward the mouth
    const cards: THREE.BufferGeometry[] = [];
    const edges: THREE.BufferGeometry[] = [];
    for (let i = 0; i < CARDS; i++) {
      const z = -2.3 + i * 0.27;
      const top = 2.25 - i * 0.065;
      const card = box(width - 0.35, top - 0.5, 0.05, 0, 0.5 + (top - 0.5) / 2, 0).rotateX(0.42).translate(0, 0.0, z);
      cards.push(card);
      edges.push(box(width - 0.35, 0.06, 0.07, 0, top + 0.02, 0).rotateX(0.42).translate(0, -0.25, z + 0.45));
    }
    // the next card, half dealt from the mouth
    const out = box(width - 0.5, 0.05, 1.8, 0, 0, 0).rotateX(-0.42).translate(0, 1.0, 2.6);
    return { m: b.merged(), cards, edges, out, shoe: shoeGeometry(width) };
  }, []);
  const strength = active ? 2.6 : hovered || dragging ? 2.1 : 1.6;
  const edgeLit = kit.glow(kit.p.bokeh, strength);
  const glass = useMemo(() => {
    const m = kit.glass.clone();
    m.transparent = true;
    m.opacity = kit.light ? 0.45 : 0.4;
    m.depthWrite = false;
    return m;
  }, [kit.glass, kit.light]);
  const lamp = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (lamp.current) lamp.current.scale.setScalar(owed > 0 && !reducedMotion() ? 1 + 0.25 * Math.sin(clock.elapsedTime * 3) : 1);
  });
  return (
    <group>
      <mesh geometry={geo.m.woodDark} material={kit.woodDark} castShadow receiveShadow />
      <mesh geometry={geo.m.felt} material={kit.felt} receiveShadow />
      <mesh geometry={geo.m.wood} material={kit.wood} castShadow receiveShadow />
      <mesh geometry={geo.m.brass} material={kit.brass} castShadow />
      {geo.cards.map((c, i) => (
        <mesh key={i} geometry={c} material={kit.ivory} />
      ))}
      {geo.edges.slice(0, Math.min(items, CARDS)).map((e, i) => (
        <mesh key={i} geometry={e} material={edgeLit} />
      ))}
      <mesh geometry={geo.out} material={kit.ivory} castShadow />
      <mesh geometry={geo.shoe} material={glass} renderOrder={2} />
      <mesh ref={lamp} position={[0, 3.55, -2.4]} material={kit.glow(owed > 0 ? '#ff6b4a' : kit.p.bokeh, owed > 0 ? 2.8 : 1.2)}>
        <sphereGeometry args={[0.32, 16, 12]} />
      </mesh>
    </group>
  );
}

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { domainDef, rng, type SessionProps } from '../api';
import { stripedTent, useKit } from './kit';

const FLOOR_H = 1.0;
const windowGeo = new THREE.PlaneGeometry(0.2, 0.42);
const windowMat = new THREE.MeshBasicMaterial({ toneMapped: false });
const lampGeo = new THREE.SphereGeometry(0.2, 14, 10);
const bulbGeo = new THREE.SphereGeometry(0.055, 6, 4);

/** Arched windows round the drum, one ring per floor; the lit share follows the session's activity. */
function Windows({ r, floors, base, lit, seed, colour, active, stalled }: { r: number; floors: number; base: number; lit: number; seed: number; colour: string; active: boolean; stalled: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { p } = useKit();
  const slots = useMemo(() => {
    const rand = rng(seed);
    const out: { m: THREE.Matrix4; lit: boolean }[] = [];
    const per = 8;
    const q = new THREE.Quaternion();
    for (let f = 0; f < floors; f++)
      for (let i = 0; i < per; i++) {
        const a = ((i + (f % 2) * 0.5) / per) * Math.PI * 2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
        const pos = new THREE.Vector3(Math.sin(a) * (r + 0.012), base + 0.5 + f * FLOOR_H, Math.cos(a) * (r + 0.012));
        out.push({ m: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)), lit: rand() < lit });
      }
    return out;
  }, [r, floors, base, lit, seed]);
  const on = useMemo(() => new THREE.Color(colour).multiplyScalar(active ? 2.4 : 1.4), [colour, active]);
  const off = useMemo(() => new THREE.Color(p.windowOff), [p.windowOff]);
  const tmp = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    slots.forEach((s, i) => {
      mesh.setMatrixAt(i, s.m);
      mesh.setColorAt(i, s.lit ? on : off);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [slots, on, off]);
  useFrame(() => {
    const mesh = ref.current;
    if (!stalled || !mesh || Math.random() > 0.2) return;
    const i = Math.floor(Math.random() * slots.length);
    mesh.setColorAt(i, Math.random() > 0.5 ? tmp.copy(on).multiplyScalar(0.6) : off);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[windowGeo, windowMat, slots.length]} />;
}

/** Marquee bulbs round the eave: lit while the session works, a dull glass ring when it rests. */
function EaveBulbs({ r, y, on }: { r: number; y: number; on: boolean }) {
  const kit = useKit();
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = 16;
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      mesh.setMatrixAt(i, m.makeTranslation(Math.sin(a) * r, y, Math.cos(a) * r));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [r, y]);
  return <instancedMesh ref={ref} args={[bulbGeo, on ? kit.glow(kit.p.bulb, kit.light ? 1.4 : 2.6) : kit.trim, n]} />;
}

/**
 * A session as a park pavilion: a round stucco drum with arched windows (one ring per floor, so it grows
 * with the work it owns), a band and a striped tent roof in its land's colour, marquee bulbs at the eave,
 * and the status lamp on the finial.
 */
export function Session({ station, shape, height: bodyH, lampColor, active, stalled, closed, selected, hovered, detail, seed }: SessionProps) {
  const kit = useKit();
  const { p } = kit;
  const land = domainDef(station.domain).color;
  const r = Math.min(shape.width, shape.depth) * 0.42;
  const plinthH = 0.18;
  const roofH = Math.max(0.75, r * 0.95);
  // the drum takes what the roof leaves of the core's body height
  const drumH = Math.max(0.85, bodyH - plinthH - roofH * 0.6);
  const floors = Math.max(1, Math.round(drumH / FLOOR_H));
  const top = plinthH + drumH;
  const geo = useMemo(
    () => ({
      plinth: new THREE.CylinderGeometry(r * 1.18, r * 1.24, plinthH, 28).translate(0, plinthH / 2, 0),
      drum: new THREE.CylinderGeometry(r, r, drumH, 28).translate(0, plinthH + drumH / 2, 0),
      band: new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.18, 28).translate(0, top - 0.09, 0),
      tent: stripedTent(r * 1.22, roofH, 12, land, p.canopy, 0.14).translate(0, top, 0),
      finial: new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6).translate(0, top + roofH + 0.27, 0),
      door: new THREE.PlaneGeometry(0.42, 0.62).translate(0, plinthH + 0.31, r + 0.015),
    }),
    [r, drumH, top, roofH, land, p.canopy],
  );
  const lampRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!lampRef.current || !stalled) return;
    lampRef.current.visible = Math.sin(clock.elapsedTime * 2.2) > -0.2;
  });
  const emissive = hovered || selected ? lampColor : '#000000';
  const stucco = useMemo(() => {
    if (!hovered && !selected && !closed && !shape.shuttered) return kit.stucco;
    const m = kit.stucco.clone();
    if (closed) m.color.multiplyScalar(0.5);
    if (shape.shuttered) m.color.lerp(new THREE.Color('#8a8496'), 0.5);
    m.emissive.set(emissive);
    m.emissiveIntensity = hovered || selected ? 0.14 : 0;
    return m;
  }, [kit.stucco, hovered, selected, closed, shape.shuttered, emissive]);
  const working = active && !closed;
  const lampY = top + roofH + 0.62;
  return (
    <group>
      <mesh geometry={geo.plinth} material={kit.curb} castShadow receiveShadow />
      <mesh geometry={geo.drum} material={stucco} castShadow receiveShadow />
      <mesh geometry={geo.band} material={kit.painted(land, 0.4)} castShadow />
      <mesh geometry={geo.tent} material={kit.vcol} castShadow receiveShadow />
      <mesh geometry={geo.finial} material={kit.gold} />
      <mesh geometry={geo.door} material={kit.glow(p.window, working ? 1.2 : 0.3)} />
      {!closed && !shape.shuttered && (
        <Windows r={r} floors={floors} base={plinthH} lit={shape.litFraction} seed={seed} colour={p.window} active={active} stalled={stalled} />
      )}
      {detail && <EaveBulbs r={r * 1.2} y={top - 0.16} on={working} />}
      {station.note?.state !== 'done' && !closed && <mesh ref={lampRef} geometry={lampGeo} position={[0, lampY, 0]} material={kit.glow(lampColor, 2.8)} />}
    </group>
  );
}

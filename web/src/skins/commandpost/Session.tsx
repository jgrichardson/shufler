import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion, type SessionProps } from '../api';
import { Bins, box, chunk, lettered, post, stencilText, strut, useKit, v3, type Kit } from './kit';

/*
 * A Claude Code session is a command tent: a ridge tent with guy ropes and an open front flap, warm inside
 * while it works, beside an antenna mast that carries the status lamp in a dark bezel (so the lamp reads on
 * sand by day) and a windsock. A taller session gets a wall tent with higher sides. A Codex session is an
 * ops cabin instead: a container office, stacked one per storey, with a roof dish that turns while it
 * works, so the two harnesses read apart without new colours. Closed: flaps down, no lamp, no glow.
 * Stalled: the lamp blinks slowly and a warning triangle stands in front. On hold: a STANDBY board.
 */

const plates = new Map<string, THREE.Texture | null>();
function standby(kit: Kit): THREE.Texture | null {
  const key = `${kit.p.olive}|${kit.p.stencil}`;
  if (plates.has(key)) return plates.get(key)!;
  const t = lettered(256, 96, (g, w, h) => {
    g.fillStyle = kit.p.bezel;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = kit.p.stencil;
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
    stencilText(g, 'STANDBY', w / 2, h / 2 + 2, 44, kit.p.stencil, { bg: kit.p.bezel, spacing: 6 });
  });
  plates.set(key, t);
  return t;
}

/** The mast: a steel pole with a dark bezel cup at the top for the lamp, and a windsock arm. */
function mastParts(bins: Bins, kit: Kit, x: number, z: number, top: number) {
  bins.paint('v', post(x, z, 0, top, 0.05, 6), kit.p.steel);
  bins.paint('v', new THREE.CylinderGeometry(0.16, 0.2, 0.12, 8).translate(x, 0.06, z), kit.p.oliveDark);
  // the bezel: a dark cup round the lamp, with a hood
  bins.paint('v', new THREE.CylinderGeometry(0.3, 0.24, 0.26, 14).translate(x, top + 0.08, z), kit.p.bezel);
  bins.paint('v', new THREE.CylinderGeometry(0.34, 0.34, 0.05, 14).translate(x, top + 0.48, z), kit.p.bezel);
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) bins.paint('v', post(x + Math.cos(a) * 0.27, z + Math.sin(a) * 0.27, top + 0.2, top + 0.48, 0.025, 4), kit.p.bezel);
  // a whip antenna above
  bins.paint('v', post(x, z, top + 0.5, top + 1.05, 0.015, 4), kit.p.steel);
}

/** The ridge tent (or a wall tent when tall): profile across x, run along z, front at +z. */
function tentParts(bins: Bins, kit: Kit, w: number, d: number, wallH: number, ridgeH: number, closed: boolean) {
  const prof = new THREE.Shape([
    new THREE.Vector2(-w / 2, 0),
    new THREE.Vector2(w / 2, 0),
    new THREE.Vector2(w / 2, wallH),
    new THREE.Vector2(0, ridgeH),
    new THREE.Vector2(-w / 2, wallH),
  ]);
  const g = new THREE.ExtrudeGeometry(prof, { depth: d, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
  g.translate(0, 0, -d / 2);
  g.computeVertexNormals();
  bins.paint('v', g, kit.p.canvasTent);
  // seams and the ridge pole
  bins.paint('v', box(0.05, 0.05, d + 0.25, 0, ridgeH + 0.03, 0), kit.p.timber);
  for (const z of [-d / 2 - 0.08, d / 2 + 0.08]) bins.paint('v', post(0, z, 0, ridgeH + 0.08, 0.03, 5), kit.p.timber);
  // guy ropes from the eaves to pegs
  for (const sx of [-1, 1])
    for (const fz of [-0.35, 0.35]) {
      const a = v3((sx * w) / 2, wallH, fz * d);
      const b = v3(sx * (w / 2 + 0.55), 0.02, fz * d * 1.15);
      bins.paint('v', strut(a, b, 0.012, 3), kit.p.khaki);
      bins.paint('v', box(0.06, 0.08, 0.06, b.x, 0.04, b.z), kit.p.timber);
    }
  // a timber floor that shows at the edges
  bins.paint('v', box(w + 0.3, 0.06, d + 0.5, 0, 0.03, 0.08), kit.p.timber);
  if (closed) {
    // the flap down and tied
    const flap = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-w * 0.28, 0.05), new THREE.Vector2(w * 0.28, 0.05), new THREE.Vector2(0, Math.min(ridgeH - 0.1, wallH + 0.5))]));
    bins.paint('v', flap.translate(0, 0, d / 2 + 0.045), new THREE.Color(kit.p.canvasTent).multiplyScalar(0.85));
  } else {
    // the flap rolled up either side of the door
    for (const s of [-1, 1]) bins.paint('v', new THREE.CylinderGeometry(0.06, 0.06, Math.min(ridgeH - 0.2, wallH + 0.3), 6).translate(s * w * 0.3, Math.min(ridgeH - 0.2, wallH + 0.3) / 2 + 0.04, d / 2 + 0.08), new THREE.Color(kit.p.canvasTent).multiplyScalar(0.8));
  }
}

/** The door opening (a triangle that lights warm while the session works). */
function doorGeometry(w: number, wallH: number, ridgeH: number, d: number) {
  const h = Math.min(ridgeH - 0.12, wallH + 0.5);
  return new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-w * 0.26, 0.06), new THREE.Vector2(w * 0.26, 0.06), new THREE.Vector2(0, h)])).translate(0, 0, d / 2 + 0.05);
}

/** A stack of container offices, one per storey, with a ladder and a door and window on each. */
function cabinParts(bins: Bins, kit: Kit, w: number, d: number, floors: number, unit: number, lit: THREE.BufferGeometry[]) {
  for (let f = 0; f < floors; f++) {
    const y = f * unit;
    const tone = f % 2 ? kit.p.khaki : kit.p.olive;
    bins.paint('v', chunk(w, unit - 0.04, d, 0.05).translate(0, y, 0), tone);
    // corrugation ribs on the front
    for (let i = 0; i < 7; i++) bins.paint('v', box(0.04, unit - 0.2, 0.03, -w / 2 + 0.2 + (i * (w - 0.4)) / 6, y + unit / 2, d / 2 + 0.01), new THREE.Color(tone).multiplyScalar(0.8));
    bins.paint('v', box(0.36, unit * 0.68, 0.04, -w * 0.28, y + unit * 0.36, d / 2 + 0.03), kit.p.oliveDark);
    lit.push(box(w * 0.34, unit * 0.32, 0.03, w * 0.18, y + unit * 0.55, d / 2 + 0.035));
  }
  // a ladder up the side
  const top = floors * unit;
  for (const s of [-0.16, 0.16]) bins.paint('v', box(0.04, top, 0.04, w / 2 + 0.06, top / 2, s), kit.p.steel);
  for (let y = 0.25; y < top; y += 0.3) bins.paint('v', box(0.04, 0.03, 0.34, w / 2 + 0.06, y, 0), kit.p.steel);
}

/** A slowly turning part (dish, windsock), still when idle or on reduced motion. */
function Spinner({ on, speed, position, children }: { on: boolean; speed: number; position: [number, number, number]; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g || !on || reducedMotion()) return;
    g.rotation.y += dt * speed;
    g.rotation.z = Math.sin(clock.elapsedTime * 3.1) * 0.05;
  });
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

export function Session({ station, shape, height: bodyH, lampColor, active, stalled, closed, selected, hovered }: SessionProps) {
  const kit = useKit();
  const codex = station.harness === 'codex';
  const done = station.note?.state === 'done';
  const w = shape.width * 0.8;
  const d = shape.depth * 0.82;
  const floors = Math.max(1, shape.floors);
  const working = active && !closed;
  // the mast stands at the back right, its lamp just above the body height the core anchors to
  const mastX = w / 2 + 0.15;
  const mastZ = -d / 2 + 0.1;
  const lampY = bodyH + 0.08;
  const geo = useMemo(() => {
    const bins = new Bins();
    const lit: THREE.BufferGeometry[] = [];
    let door: THREE.BufferGeometry | null = null;
    let roof = 0;
    if (codex) {
      const unit = Math.max(0.9, (bodyH - 0.3) / floors);
      cabinParts(bins, kit, w, d * 0.92, floors, unit, lit);
      roof = floors * unit;
      // the dish's stand on the roof
      bins.paint('v', post(-w * 0.15, 0, roof, roof + 0.25, 0.05, 6), kit.p.steel);
    } else {
      const wallH = floors === 1 ? 0.32 : 0.35 + (floors - 1) * 0.62;
      const ridgeH = Math.min(bodyH - 0.1, wallH + 0.72);
      tentParts(bins, kit, w, d, wallH, ridgeH, closed || shape.shuttered);
      door = doorGeometry(w, wallH, ridgeH, d);
      // a band round a tall wall tent, so the extra height reads as a second storey of canvas
      if (floors > 1) for (const s of [-1, 1]) bins.paint('v', box(0.02, 0.06, d, (s * (w + 0.09)) / 2, wallH * 0.55, 0), kit.p.oliveDark);
      // a map table and a crate outside the door
      bins.paint('v', box(0.55, 0.05, 0.36, -w * 0.38, 0.42, d / 2 + 0.55), kit.p.timber);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) bins.paint('v', post(-w * 0.38 + sx * 0.22, d / 2 + 0.55 + sz * 0.13, 0, 0.4, 0.02, 4), kit.p.timber);
      bins.paint('v', chunk(0.36, 0.3, 0.3, 0.03).translate(w * 0.36, 0, d / 2 + 0.5), kit.p.olive);
      roof = ridgeH;
    }
    mastParts(bins, kit, mastX, mastZ, lampY - 0.08);
    if (stalled && !closed) {
      // a warning triangle on a stand in front
      const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.22, 0), new THREE.Vector2(0.22, 0), new THREE.Vector2(0, 0.38)]));
      bins.paint('v', tri.translate(w * 0.05, 0.12, d / 2 + 0.9), kit.p.stencil);
      bins.paint('v', box(0.5, 0.48, 0.02, w * 0.05, 0.3, d / 2 + 0.88), kit.p.bezel);
      bins.paint('v', box(0.04, 0.14, 0.04, w * 0.05, 0.07, d / 2 + 0.85), kit.p.steel);
    }
    const m = bins.merged();
    const litG = lit.length ? new Bins() : null;
    if (litG) for (const g of lit) litG.add('l', g);
    return { body: m.v, door, lit: litG ? litG.merged().l : null, roof };
  }, [kit, codex, w, d, floors, bodyH, lampY, mastX, mastZ, closed, stalled, shape.shuttered]);

  const body = useMemo(() => {
    if (!hovered && !selected && !closed) return kit.vcol;
    const m = kit.vcol.clone();
    if (closed) m.color.multiplyScalar(0.75);
    if (hovered || selected) {
      m.emissive.set(lampColor);
      m.emissiveIntensity = 0.1;
    }
    return m;
  }, [kit.vcol, hovered, selected, closed, lampColor]);

  const lampRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!lampRef.current) return;
    // stalled: a slow blink, well under 1 Hz
    lampRef.current.visible = !stalled || reducedMotion() || Math.sin(clock.elapsedTime * 2.2) > -0.2;
  });

  const glowK = closed ? 0 : kit.light ? (working ? 0.9 : 0.5) : working ? 2.0 : shape.litFraction > 0.3 ? 1.2 : 0.55;
  const inside = closed ? kit.bezel : kit.glow(kit.p.window, glowK);
  const plate = shape.shuttered ? standby(kit) : null;
  return (
    <group>
      <mesh geometry={geo.body} material={body} castShadow receiveShadow />
      {geo.door && !closed && !shape.shuttered && <mesh geometry={geo.door} material={inside} />}
      {geo.lit && <mesh geometry={geo.lit} material={inside} />}
      {codex ? (
        <Spinner on={working} speed={0.8} position={[-w * 0.15, geo.roof + 0.3, 0]}>
          <mesh rotation={[-0.9, 0, 0]} material={kit.steel} castShadow>
            <sphereGeometry args={[0.42, 16, 8, 0, Math.PI * 2, 0, 0.9]} />
          </mesh>
          <mesh position={[0, 0.12, 0.1]} material={kit.oliveDark}>
            <cylinderGeometry args={[0.03, 0.03, 0.4, 5]} />
          </mesh>
        </Spinner>
      ) : (
        <Spinner on={working} speed={0.5} position={[mastX, lampY - 0.55, mastZ]}>
          <mesh position={[0.28, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={kit.painted(kit.p.stencil, 0.8)}>
            <coneGeometry args={[0.09, 0.42, 8, 1, true]} />
          </mesh>
        </Spinner>
      )}
      {plate && (
        <mesh position={[0, Math.min(0.7, geo.roof * 0.45), d / 2 + 0.12]}>
          <planeGeometry args={[w * 0.72, w * 0.27]} />
          <meshStandardMaterial map={plate} roughness={0.7} emissive="#ffffff" emissiveMap={plate} emissiveIntensity={kit.light ? 0.05 : 0.3} />
        </mesh>
      )}
      {!done && !closed && (
        <mesh ref={lampRef} position={[mastX, lampY + 0.22, mastZ]} material={kit.glow(lampColor, 2.8)}>
          <sphereGeometry args={[0.2, 14, 10]} />
        </mesh>
      )}
    </group>
  );
}

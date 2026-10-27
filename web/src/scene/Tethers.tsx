import { useEffect, useMemo, useRef, useState } from 'react';
import type { Station } from '../types';
import { COURIER_AFTER_DISPATCH_MS, recentlyDispatched, usePulses, type Pulse } from './pulses';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorld } from '../store';
import { usePrefs } from '../ui/prefs';
import { domainDef } from '../lib/domains';
import { buildingShape, bodyHeight } from './Building';
import type { SceneLayout } from './layout';
import { podPositions } from './Pods';

const MAX = 48;
const SEG = 20;

/**
 * Ownership tethers: building roof to pod. Solid to the session's focus item, dashed to its
 * other items. Drawn for the hovered or selected pod or session; for every red pod too when the redArcsAlways pref is on.
 */
export function Tethers({ layout, redIds }: { layout: SceneLayout; redIds: Set<string> }) {
  const pool = useMemo(() => {
    return Array.from({ length: MAX }, () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
      const solid = new THREE.LineBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95 });
      const dashed = new THREE.LineDashedMaterial({ toneMapped: false, transparent: true, opacity: 0.9, dashSize: 0.6, gapSize: 0.45 });
      const line = new THREE.Line(geo, solid);
      line.frustumCulled = false;
      line.visible = false;
      return { line, solid, dashed };
    });
  }, []);
  const group = useRef<THREE.Group>(null);
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  const mid = useMemo(() => new THREE.Vector3(), []);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(a, mid, b), [a, mid, b]);

  useFrame(() => {
    const { hover, selection, snapshot } = useWorld.getState();
    if (!snapshot) return;
    const stationById = new Map(snapshot.stations.map((s) => [s.id, s]));
    const show = new Set<string>();
    const focusStations = new Set<string>();
    if (hover?.kind === 'item') show.add(hover.id);
    if (selection?.kind === 'item') show.add(selection.id);
    if (hover?.kind === 'station') focusStations.add(hover.id);
    if (selection?.kind === 'station') focusStations.add(selection.id);
    if (usePrefs.getState().redArcsAlways) for (const id of redIds) show.add(id);
    let n = 0;
    for (const w of snapshot.workpieces) {
      const owners = w.station_ids.filter((sid) => show.has(w.id) || focusStations.has(sid));
      if (!owners.length) continue;
      const p = podPositions.get(w.id);
      if (!p) continue;
      const bright = selection?.kind === 'item' ? selection.id === w.id : hover?.kind === 'item' ? hover.id === w.id : true;
      for (const sid of owners) {
        const st = stationById.get(sid);
        const bl = layout.buildings.get(sid);
        if (!st || !bl || n >= MAX) continue;
        const owned = st.workpiece_ids.length;
        const h = bodyHeight(buildingShape(st, owned)) + 0.4;
        a.set(bl.pos[0], bl.pos[1] + h, bl.pos[2]);
        b.set(p.x, p.y + 1.0, p.z);
        if (!Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z)) continue;
        mid.addVectors(a, b).multiplyScalar(0.5);
        mid.y += 4 + a.distanceTo(b) * 0.12;
        const pts = curve.getPoints(SEG);
        const slot = pool[n++];
        const attr = slot.line.geometry.getAttribute('position') as THREE.BufferAttribute;
        pts.forEach((pt, i) => attr.setXYZ(i, pt.x, pt.y, pt.z));
        attr.needsUpdate = true;
        const isFocus = st.focus_workpiece_id === w.id;
        const mat = isFocus ? slot.solid : slot.dashed;
        const col = redIds.has(w.id) ? new THREE.Color('#ff6b5c') : new THREE.Color(domainDef(w.domain).color);
        mat.color.copy(col).multiplyScalar(bright ? 2.2 : 1.2);
        mat.opacity = bright ? 0.95 : 0.55;
        slot.line.material = mat;
        if (!isFocus) slot.line.computeLineDistances();
        slot.line.visible = true;
      }
    }
    for (let i = n; i < MAX; i++) pool[i].line.visible = false;
  });

  return (
    <group ref={group}>
      {pool.map((p, i) => (
        <primitive key={i} object={p.line} />
      ))}
    </group>
  );
}

const courierGeo = new THREE.BoxGeometry(0.7, 0.12, 0.45);
const trailGeo = new THREE.ConeGeometry(0.12, 1.2, 6);
trailGeo.rotateZ(Math.PI / 2);
trailGeo.translate(-0.8, 0, 0);

/** Each active session sends a flat domain-coloured courier to hover over its focus item. */
export function Couriers({ layout }: { layout: SceneLayout }) {
  const snapshot = useWorld((s) => s.snapshot);
  const pulses = usePulses((s) => s.pulses);
  const [, setTick] = useState(0);
  const dispatched = recentlyDispatched(pulses);
  useEffect(() => {
    // recall the courier once the post-dispatch window closes
    if (!pulses.length) return;
    const id = setTimeout(() => setTick((n) => n + 1), COURIER_AFTER_DISPATCH_MS + 50);
    return () => clearTimeout(id);
  }, [pulses]);
  const active = useMemo(
    () => (snapshot?.stations ?? []).filter((s) => (s.activity.status === 'active' || dispatched.has(s.id)) && podFor(s) && layout.buildings.has(s.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot?.stations, layout, [...dispatched].join()],
  );
  return (
    <group>
      {active.map((s) => (
        <Courier key={s.id} stationId={s.id} itemId={podFor(s)!} color={domainDef(s.domain).color} home={layout.buildings.get(s.id)!.pos} />
      ))}
    </group>
  );
}

function Courier({ itemId, color, home }: { stationId: string; itemId: string; color: string; home: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(home[0], home[1] + 4, home[2]));
  const glow = useMemo(() => new THREE.Color(color).multiplyScalar(1.8), [color]);
  const seed = useRef(Math.random() * 10);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    const p = podPositions.get(itemId);
    const t = clock.elapsedTime + seed.current;
    const target = p ? new THREE.Vector3(p.x + Math.cos(t * 0.8) * 0.9, p.y + 3.2 + Math.sin(t * 1.3) * 0.2, p.z + Math.sin(t * 0.8) * 0.9) : new THREE.Vector3(home[0], home[1] + 4, home[2]);
    const prev = pos.current.clone();
    pos.current.lerp(target, 1 - Math.exp(-dt * 1.2));
    g.position.copy(pos.current);
    const v = pos.current.clone().sub(prev);
    if (v.lengthSq() > 1e-6) g.rotation.y = Math.atan2(-v.z, v.x);
  });
  return (
    <group ref={ref}>
      <mesh geometry={courierGeo}>
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      <mesh geometry={trailGeo}>
        <meshBasicMaterial color={glow} toneMapped={false} transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

/** The pod a session is working on: its focus item, else the first item it owns that is on the board. */
function podFor(s: Station): string | null {
  return s.focus_workpiece_id ?? s.workpiece_ids.find((id) => podPositions.has(id)) ?? null;
}

const beadGeo = new THREE.SphereGeometry(0.6, 14, 10);
const PULSE_SECONDS = 1.1;

/** A bright bead runs the tether from the building to the pod when a dispatch lands, then flashes. */
export function TetherPulses({ layout }: { layout: SceneLayout }) {
  const pulses = usePulses((s) => s.pulses);
  return (
    <group>
      {pulses.map((p) => (
        <TetherPulse key={p.id} pulse={p} layout={layout} />
      ))}
    </group>
  );
}

function TetherPulse({ pulse, layout }: { pulse: Pulse; layout: SceneLayout }) {
  const ref = useRef<THREE.Mesh>(null);
  const clear = usePulses((s) => s.clear);
  const t = useRef(0);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()), []);
  const { color, station } = useMemo(() => {
    const st = useWorld.getState().snapshot?.stations.find((x) => x.id === pulse.stationId);
    return { station: st, color: new THREE.Color(st ? domainDef(st.domain).color : '#cfe8ff').multiplyScalar(3) };
  }, [pulse.stationId]);
  useFrame((_, dt) => {
    const m = ref.current;
    const bl = layout.buildings.get(pulse.stationId);
    if (!m || !bl || !station) return;
    t.current += dt / PULSE_SECONDS;
    const h = bodyHeight(buildingShape(station, station.workpiece_ids.length)) + 0.4;
    const itemId = podFor(station);
    const p = itemId ? podPositions.get(itemId) : undefined;
    curve.v0.set(bl.pos[0], bl.pos[1] + h, bl.pos[2]);
    if (p) curve.v2.set(p.x, p.y + 1, p.z);
    else curve.v2.copy(curve.v0).setY(curve.v0.y + 6);
    curve.v1.addVectors(curve.v0, curve.v2).multiplyScalar(0.5);
    curve.v1.y += 4 + curve.v0.distanceTo(curve.v2) * 0.12;
    const k = Math.min(1, t.current);
    m.position.copy(curve.getPoint(k));
    // swell on arrival
    const flash = t.current > 1 ? 1 + (t.current - 1) * 6 : 1;
    m.scale.setScalar(flash);
    (m.material as THREE.MeshBasicMaterial).opacity = t.current > 1 ? Math.max(0, 1 - (t.current - 1) * 3) : 1;
    if (t.current > 1.35) clear(pulse.id);
  });
  return (
    <mesh ref={ref} geometry={beadGeo}>
      <meshBasicMaterial color={color} toneMapped={false} transparent />
    </mesh>
  );
}

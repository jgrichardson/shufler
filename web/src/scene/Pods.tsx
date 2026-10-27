import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type GroupProps, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Phase, Workpiece } from '../types';
import { BALL_COLOR, CI_COLOR, REVIEWER_COLOR } from '../lib/colors';
import { domainDef } from '../lib/domains';
import { dispatch } from '../store';
import { Beam } from './Beam';
import { GroundRing, useSelectRing } from './Building';
import { Dimmable } from './Dimmable';
import { HitProxy, HoverHalo, HoverLift } from './Hover';
import { outside, type Focus } from './focus';
import { useSkin } from '../skins/store';
import type { PodKind } from '../skins/types';

const PARKED_GREY = '#5d6570';
import type { PodSlot, SceneLayout } from './layout';
import { MORPH_SECONDS, PIPE_SINK, morphK } from './morph';
import { cellX, SKY_Y } from './layout';
import { isBackwards, journeySeconds, journeyStops } from './journey';
import { REDUCED_SECONDS, reducedMotion } from '../ui/motionPrefs';
import { useRides } from './rides';
import { skippingReplay } from '../ui/catchUp';
import { podRing, podShowsNumber, type LabelMode, type Layers } from '../ui/layers';
import { uniqueById } from './layout';

/** Live world positions of pods, written every frame, read by tethers, couriers and the camera. */
export const podPositions = new Map<string, THREE.Vector3>();

/** Last position each pod was drawn at; survives unmount so a shipped pod can start its ride to the warehouse there. */
export const lastPodPos = new Map<string, [number, number, number]>();

const SIZE_SCALE = { S: 1.25, M: 1.55, L: 1.85 } as const;

const KINDS = new Set<PodKind>(['pr', 'issue', 'data_fix', 'plan', 'docs']);
const lampGeo = new THREE.SphereGeometry(0.17, 12, 8);

/** Height of the lamp above the pod origin, per kind. */
const LAMP_Y = { pr: 1.25, issue: 0.55, data_fix: 1.45, plan: 1.3, docs: 0.65, branch: 1.25 } as const;

const AMBER = new THREE.Color('#ffb02e').multiplyScalar(3);
/** Unit-length streak that extends backwards (−x) from the pod; scaled per frame. */
const trailGeo = (() => {
  const g = new THREE.BoxGeometry(1, 0.16, 0.5);
  g.translate(-0.5, 0, 0);
  return g;
})();

interface Motion {
  path: THREE.Vector3[];
  t: number;
  arc: number;
  dur: number;
  journey?: boolean;
  back?: boolean;
}

function simpleMove(from: THREE.Vector3, to: THREE.Vector3, arc: number, dur: number): Motion {
  return { path: [from.clone(), to.clone()], t: 0, arc, dur };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface PodProps {
  wp: Workpiece;
  slot: PodSlot;
  selected: boolean;
  red: boolean;
  dimmed: boolean;
  detail: boolean;
  pipeline: boolean;
  /** Calm overview marker: a flat domain-coloured dot instead of the full capsule. */
  dot: boolean;
  /** Red sky beam over needs-me pods (Beams layer). */
  beam: boolean;
  ring: 'red' | 'amber' | null;
}

const RING_COLOR = { red: '#e74c3c', amber: '#f39c12' } as const;

function podTarget(slot: PodSlot, pipeline: boolean): THREE.Vector3 {
  if (pipeline && slot.pipePos) return new THREE.Vector3(...slot.pipePos);
  if (pipeline && slot.parked) return new THREE.Vector3(slot.pos[0], slot.pos[1] - PIPE_SINK, slot.pos[2]);
  return new THREE.Vector3(...slot.pos);
}

function PodImpl({ wp, slot, selected, red, dimmed, detail, pipeline, dot, beam, ring }: PodProps) {
  const group = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.Mesh>(null);
  const target = useMemo(() => podTarget(slot, pipeline), [slot, pipeline]);
  const wasPipeline = useRef(pipeline);
  const prevSlot = useRef<{ phase: Phase; lane: number; parked: boolean }>({ phase: slot.phase, lane: slot.lane, parked: slot.parked });
  const motion = useRef<Motion | null>(null);
  const trail = useRef<THREE.Mesh>(null);
  const lampMat = useRef<THREE.MeshBasicMaterial>(null);
  const lastPos = useRef(new THREE.Vector3());
  const current = useRef<THREE.Vector3 | null>(null);
  const { PodBody } = useSkin().components;
  const selectRing = useSelectRing();
  const [hovered, setHovered] = useState(false);
  const kind: PodKind = wp.kind === 'branch' ? 'pr' : KINDS.has(wp.kind as PodKind) ? (wp.kind as PodKind) : 'issue';
  const base = SIZE_SCALE[wp.size] ?? 1.55;
  const scale = dot ? 1.5 : detail ? base : Math.min(2.0, base * 1.35);
  const domainColor = domainDef(wp.domain).color;
  const hull = useMemo(() => (wp.parked ? `#${new THREE.Color(domainColor).lerp(new THREE.Color(PARKED_GREY), 0.6).getHexString()}` : domainColor), [domainColor, wp.parked]);
  const ballColor = BALL_COLOR[wp.ball.who];
  const lampColor = useMemo(
    () => new THREE.Color(wp.parked || dimmed ? '#4f5762' : ballColor).multiplyScalar(wp.parked || dimmed ? 1 : selected ? 3.2 : 2.5),
    [ballColor, wp.parked, dimmed, selected],
  );

  useEffect(() => {
    const cur = current.current;
    if (!cur) {
      // first appearance: rise from just below the slot
      current.current = target.clone();
      motion.current = simpleMove(target.clone().add(new THREE.Vector3(0, -3, 0)), target, 0, 1.2);
      return;
    }
    const modeSwitch = wasPipeline.current !== pipeline;
    wasPipeline.current = pipeline;
    const prev = prevSlot.current;
    prevSlot.current = { phase: slot.phase, lane: slot.lane, parked: slot.parked };
    if (cur.distanceTo(target) < 0.01) return;
    const reduced = reducedMotion() || skippingReplay();
    if (modeSwitch) {
      motion.current = simpleMove(cur, target, 0.8, reduced ? REDUCED_SECONDS : MORPH_SECONDS);
      return;
    }
    const stops = !pipeline && !prev.parked && !slot.parked && prev.lane === slot.lane ? journeyStops(prev.phase, slot.phase) : [];
    if (stops.length) {
      // a journey along the lane, pausing a beat at each district it crosses
      const path = [cur.clone(), ...stops.slice(0, -1).map((p) => new THREE.Vector3(cellX(p), SKY_Y, cur.z)), target.clone()];
      motion.current = { path, t: 0, arc: 0, dur: journeySeconds(stops.length, reduced), journey: true, back: isBackwards(prev.phase, slot.phase) };
      return;
    }
    const laneChange = Math.abs(cur.z - target.z) > 1;
    motion.current = simpleMove(cur, target, laneChange ? 3.5 : 0.6, reduced ? REDUCED_SECONDS : laneChange ? 0.8 : 1.2);
  }, [target, pipeline, slot.phase, slot.lane, slot.parked]);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g || !current.current) return;
    const m = motion.current;
    lastPos.current.copy(current.current);
    if (m) {
      m.t = Math.min(1, m.t + dt / m.dur);
      const segs = m.path.length - 1;
      const u = m.t * segs;
      const i = Math.min(segs - 1, Math.floor(u));
      const k = ease(u - i);
      current.current.lerpVectors(m.path[i], m.path[i + 1], k);
      current.current.y += Math.sin(Math.PI * k) * m.arc;
      if (m.t >= 1) motion.current = null;
    }
    g.position.copy(current.current);
    const tr = trail.current;
    if (tr) {
      const dx = current.current.x - lastPos.current.x;
      const on = !!m?.journey && Math.abs(dx) > 1e-4;
      tr.visible = on;
      if (on) {
        // stretch behind the pod in proportion to its speed
        const len = Math.min(6, (Math.abs(dx) / Math.max(dt, 1e-3)) * 0.45);
        tr.scale.set(len, 1, 1);
        tr.rotation.y = dx > 0 ? 0 : Math.PI;
      }
    }
    if (lampMat.current) {
      const flicker = !!m?.back && Math.sin(clock.elapsedTime * 16) > 0;
      lampMat.current.color.copy(flicker ? AMBER : lampColor);
    }
    const pos = podPositions.get(wp.id) ?? new THREE.Vector3();
    podPositions.set(wp.id, pos.copy(current.current));
    lastPodPos.set(wp.id, [current.current.x, current.current.y, current.current.z]);
    if (lamp.current) {
      const t = clock.elapsedTime;
      let s = 1;
      if (red) s = 0.85 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4));
      lamp.current.scale.setScalar(s);
      lamp.current.visible = wp.stuck ? Math.sin(t * 1.6) > -0.3 : true;
    }
  });

  useEffect(() => () => void podPositions.delete(wp.id), [wp.id]);

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
    setHovered(true);
    dispatch({ type: 'hover', hover: { kind: 'item', id: wp.id, x: e.clientX, y: e.clientY } });
  };
  const onOut = () => {
    document.body.style.cursor = '';
    setHovered(false);
    dispatch({ type: 'hover', hover: null });
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    dispatch({ type: 'select', selection: { kind: 'item', id: wp.id } });
  };

  const lampY = LAMP_Y[kind] * scale;
  const inReview = wp.phase === 'review';

  return (
    <Dimmable on={dimmed}>
      <group ref={group}>
        <group scale={!dot && selected ? scale * 1.12 : scale} onPointerOver={onOver} onPointerMove={onOver} onPointerOut={onOut} onClick={onClick}>
          <HoverLift on={hovered && !dimmed} lift={0.35} grow={0.08}>
            <PodBody
              kind={kind}
              hull={hull}
              domainColor={domainColor}
              ballColor={ballColor}
              dot={dot}
              detail={detail}
              pips={inReview && detail ? { reviewer: REVIEWER_COLOR[wp.reviewer], ci: CI_COLOR[wp.ci] } : undefined}
            />
          </HoverLift>
          <HitProxy radius={dot ? 1.5 : 1.8} y={dot ? 0.3 : 0.6} />
        </group>
        {!dot && (
          // rides up with the hovered body so the grown pod never swallows it
          <HoverLift on={hovered && !dimmed} lift={(0.35 + LAMP_Y[kind] * 0.08) * scale} grow={0}>
            <mesh ref={lamp} geometry={lampGeo} position={[0, lampY + 0.12, 0]}>
              <meshBasicMaterial ref={lampMat} color={lampColor} toneMapped={false} />
            </mesh>
          </HoverLift>
        )}
        <mesh ref={trail} geometry={trailGeo} position={[0, 0.55 * scale, 0]} visible={false}>
          <meshBasicMaterial color={new THREE.Color(domainColor).multiplyScalar(1.6)} toneMapped={false} transparent opacity={0.5} depthWrite={false} />
        </mesh>
        {red && beam && !wp.parked && (
          <group position={[0, (dot ? 0.4 : lampY) + 0.2, 0]}>
            <Beam color="#e74c3c" pulse intensity={1.0} radius={0.4} height={70} />
          </group>
        )}
        {ring && <GroundRing color={RING_COLOR[ring]} radius={(dot ? 0.95 : 1.25) * scale} spin={ring === 'red'} />}
        {selected && <GroundRing color={selectRing} radius={1.6 * scale} spin={false} pulse />}
        <HoverHalo on={hovered && !selected && !dimmed} radius={(dot ? 1.1 : 1.45) * scale} />
      </group>
    </Dimmable>
  );
}

const Pod = memo(PodImpl);

export function Pods({
  layout,
  workpieces,
  selectedId,
  redIds,
  focus,
  detail,
  pipeline = false,
  zoomed = true,
  labels = 'auto',
  layers = { needs: true, conflicts: true, beams: true },
}: {
  layout: SceneLayout;
  workpieces: Workpiece[];
  selectedId: string | null;
  redIds: Set<string>;
  focus: Focus | null;
  detail: boolean;
  pipeline?: boolean;
  zoomed?: boolean;
  labels?: LabelMode;
  layers?: Pick<Layers, 'needs' | 'conflicts' | 'beams'>;
}) {
  useDepartures(layout, workpieces);
  const { Crate } = useSkin().components;
  return (
    <group>
      {uniqueById(workpieces).map((wp) => {
        const slot = layout.pods.get(wp.id);
        if (!slot || (slot.hidden && !pipeline)) return null;
        const red = redIds.has(wp.id);
        const selected = selectedId === wp.id;
        const dot = !pipeline && !podShowsNumber({ labels, zoomed, selected });
        return (
          <Pod
            key={wp.id}
            wp={wp}
            slot={slot}
            selected={selected}
            red={red}
            dimmed={outside(focus?.items, wp.id, focus)}
            detail={detail || pipeline}
            pipeline={pipeline}
            dot={dot}
            beam={layers.beams && layers.needs}
            ring={podRing(red, wp.mergeable === 'CONFLICTING', layers)}
          />
        );
      })}
      {layout.crates.map((c) => (
        <Dimmable key={`${c.lane}-${c.phase}`} on={!!focus && outside(focus.lanes, c.lane, focus) && outside(focus.phases, c.phase, focus)}>
          <CrateGroup
            position={c.pos}
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'select', selection: { kind: 'gate', phase: c.phase } });
            }}
          >
            {[0, 1].map((k) => (
              <group key={k} position={[0, k * 1.12, 0]} rotation={[0, k * 0.3, 0]} scale={1.1}>
                <Crate domain={layout.lanes[c.lane]?.domain.id ?? ''} color={domainDef(layout.lanes[c.lane]?.domain.id).color} />
              </group>
            ))}
          </CrateGroup>
        </Dimmable>
      ))}
    </group>
  );
}

/** Overflow crates shrink away in Pipeline mode, where every item gets its own kanban slot. */
function CrateGroup({ children, ...props }: GroupProps) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const s = 1 - morphK();
    g.scale.setScalar(Math.max(0.001, s));
    g.visible = s > 0.01;
  });
  return (
    <group ref={ref} {...props}>
      {children}
    </group>
  );
}

/** Starts a ride to the dock and warehouse for every pod that left the board because it shipped. */
function useDepartures(layout: SceneLayout, workpieces: Workpiece[]) {
  const prev = useRef<Map<string, PodSlot> | null>(null);
  const start = useRides((s) => s.start);
  useEffect(() => {
    const before = prev.current;
    prev.current = layout.pods;
    if (!before) return;
    const byId = new Map(workpieces.map((w) => [w.id, w]));
    for (const [id, slot] of before) {
      if (layout.pods.has(id) || slot.parked) continue;
      const w = byId.get(id);
      if (!w || w.phase !== 'shipped') continue;
      const from = lastPodPos.get(id) ?? slot.pos;
      start({ id, pr: w.pr, domain: w.domain, from: [...from] as [number, number, number], startedAt: performance.now() });
      lastPodPos.delete(id);
    }
  }, [layout, workpieces, start]);
}

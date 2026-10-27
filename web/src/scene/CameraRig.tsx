import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useWorld } from '../store';
import { PILE_DOCK } from '../store/reducer';
import { GATE_X, PHASES } from '../lib/domains';
import { needsOwnerIds, needsOwnerStations } from '../lib/derive';
import { LIBRARY, SKY_Y, libraryPos, skywayEndX, type SceneLayout } from './layout';
import { podPositions } from './Pods';
import { WAREHOUSE_WALL_H, bayGeometry, warehouseGeometry, warehouseRacks } from './warehouseLayout';
import { classifyWheel, keyNav, zoomFactor } from '../lib/navInput';

const IDLE_DRIFT_AFTER_MS = 14000;
/** Near-orthographic lens so district columns stay vertical on screen (round 1, item 2). */
export const FOV = 25;
/** Distances below were tuned for a 34° lens; keep the same framing at FOV. */
const FOV_K = Math.tan((34 * Math.PI) / 360) / Math.tan((FOV * Math.PI) / 360);
/** World extent the Overview frames: the row islands on the west, the warehouse on the east. */
const WORLD_MIN_X = -21;
const worldMaxX = () => skywayEndX() + 36;
/** Shared with the plate layer: Space held turns left-drag into a pan. */
export const nav = { space: false };
/** Share of the viewport covered by the right glass panel; the scene centre shifts left by half of it. */
export const PANEL_FRACTION = 0.28;
/** Hero direction: from front-left, looking along the skyway toward the dock. */
const UP = new THREE.Vector3(0, 1, 0);
/** Overview: no yaw, pitched down 55° over the boulevard. */
const PITCH = (55 * Math.PI) / 180;
const HERO_DIR = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH)).normalize();
const PIPE_DIR = new THREE.Vector3(0, 0.9, 0.44).normalize();
const PIPE_DIST = 210 * FOV_K;

/** Screen margins (px) the Overview keeps clear for the top bar, layer bar, strip and bottom bars. */
const FRAME_MARGIN = { top: 150, bottom: 100, side: 24, left: 236 };

/**
 * Frames the whole world axis-aligned: x across the screen, lanes stacked up it. Projects the
 * world's corners through a camera like the real one and steps distance and target until the
 * world fills the area left of the panel.
 */
export function overviewFrame(
  layout: SceneLayout | null,
  view: { width: number; height: number; panel: boolean } = { width: 1600, height: 1000, panel: true },
): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const minZ = layout ? layout.bounds.minZ - 16 : -90;
  const maxZ = layout ? layout.bounds.maxZ + 6 : 6;
  const cam = new THREE.PerspectiveCamera(FOV, view.width / Math.max(1, view.height), 1, 4000);
  cam.filmGauge = 35;
  cam.filmOffset = view.panel ? (PANEL_FRACTION / 2) * cam.getFilmWidth() : 0;
  cam.updateProjectionMatrix();
  const corners: THREE.Vector3[] = [];
  for (const x of [WORLD_MIN_X, worldMaxX()]) for (const z of [minZ, maxZ]) for (const y of [SKY_Y - 8, SKY_Y + 16]) corners.push(new THREE.Vector3(x, y, z));
  // usable rectangle in NDC
  const toNdcX = (px: number) => (px / view.width) * 2 - 1;
  const toNdcY = (py: number) => 1 - (py / view.height) * 2;
  const usableRight = view.width * (view.panel ? 1 - PANEL_FRACTION : 1) - FRAME_MARGIN.side;
  const box = { l: toNdcX(FRAME_MARGIN.left), r: toNdcX(usableRight), t: toNdcY(FRAME_MARGIN.top), b: toNdcY(view.height - FRAME_MARGIN.bottom) };
  const target = new THREE.Vector3((WORLD_MIN_X + worldMaxX()) / 2, SKY_Y - 2, (minZ + maxZ) / 2);
  let dist = 300;
  const v = new THREE.Vector3();
  for (let i = 0; i < 40; i++) {
    cam.position.copy(target).add(HERO_DIR.clone().multiplyScalar(dist));
    cam.lookAt(target);
    cam.updateMatrixWorld();
    let l = Infinity, r = -Infinity, t = -Infinity, b = Infinity;
    for (const c of corners) {
      v.copy(c).project(cam);
      l = Math.min(l, v.x);
      r = Math.max(r, v.x);
      t = Math.max(t, v.y);
      b = Math.min(b, v.y);
    }
    const scale = Math.max((r - l) / (box.r - box.l), (t - b) / (box.t - box.b));
    // centre the projected world in the usable box (world units per NDC unit at the target plane)
    const ndcPerUnitY = 1 / (dist * Math.tan((FOV * Math.PI) / 360));
    const ndcPerUnitX = ndcPerUnitY / cam.aspect;
    target.x -= ((box.l + box.r) / 2 - (l + r) / 2) / ndcPerUnitX;
    target.z += ((box.t + box.b) / 2 - (t + b) / 2) / ndcPerUnitY / Math.sin(PITCH);
    dist *= Math.pow(scale, 0.8);
    if (Math.abs(scale - 1) < 0.01) break;
  }
  return { target, pos: target.clone().add(HERO_DIR.clone().multiplyScalar(dist)) };
}

interface Flight {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  duration: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function frameBox(points: THREE.Vector3[], dir: THREE.Vector3, minDist = 40) {
  const box = new THREE.Box3().setFromPoints(points);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  return { target: center, pos: center.clone().add(dir.clone().multiplyScalar(Math.max(minDist, radius * 2.9 + 20) * FOV_K)) };
}

export function CameraRig({ layout }: { layout: SceneLayout | null }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, gl } = useThree();
  const flight = useRef<Flight | null>(null);
  const lastInteract = useRef(performance.now());
  const flySeq = useWorld((s) => s.flySeq);
  const presetSeq = useWorld((s) => s.presetSeq);
  const framed = useRef(false);
  const sway = useRef<{ base: THREE.Vector3; t: number } | null>(null);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.filmGauge = 35;
    cam.fov = FOV;
    cam.filmOffset = size.width > 900 ? (PANEL_FRACTION / 2) * cam.getFilmWidth() : 0;
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  const view = { width: size.width, height: size.height, panel: size.width > 900 };

  /** Moves camera and target together across the ground plane by screen-space pixels. */
  const panPixels = (dx: number, dy: number) => {
    const c = controls.current;
    if (!c) return;
    const cam = camera as THREE.PerspectiveCamera;
    const dist = camera.position.distanceTo(c.target);
    const unitsPerPx = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / size.height;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0).setY(0).normalize();
    const fwd = new THREE.Vector3().subVectors(c.target, camera.position).setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    // screen-down maps to toward the viewer; foreshortening stretches the vertical step
    const off = right.multiplyScalar(dx * unitsPerPx).add(fwd.multiplyScalar((-dy * unitsPerPx) / Math.max(0.35, Math.sin(PITCH))));
    camera.position.add(off);
    c.target.add(off);
    flight.current = null;
    lastInteract.current = performance.now();
  };

  /** Scales the camera distance; with a cursor, keeps the ground point under it fixed. */
  const zoomBy = (factor: number, clientX?: number, clientY?: number) => {
    const c = controls.current;
    if (!c) return;
    const dist = camera.position.distanceTo(c.target);
    const next = THREE.MathUtils.clamp(dist * factor, c.minDistance, c.maxDistance);
    const f = next / dist;
    let anchor: THREE.Vector3 | null = null;
    if (clientX != null && clientY != null) {
      const ndc = new THREE.Vector2((clientX / size.width) * 2 - 1, -(clientY / size.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -SKY_Y), hit)) anchor = hit;
    }
    const pivot = anchor ?? c.target.clone();
    camera.position.sub(pivot).multiplyScalar(f).add(pivot);
    c.target.sub(pivot).multiplyScalar(f).add(pivot);
    flight.current = null;
    lastInteract.current = performance.now();
  };

  useEffect(() => {
    const root = gl.domElement.closest('.app') ?? gl.domElement.parentElement;
    if (!root) return;
    const overScene = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el === gl.domElement || !!el.closest?.('.plates-layer') || !!el.closest?.('.district-strip'));
    };
    const onWheel = (e: WheelEvent) => {
      if (!overScene(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const w = e as WheelEvent & { wheelDeltaX?: number; wheelDeltaY?: number };
      if (classifyWheel(w) === 'pan') panPixels(e.deltaX, e.deltaY);
      else zoomBy(zoomFactor(e.deltaY * (e.deltaMode === 1 ? 33 : 1), e.ctrlKey), e.clientX, e.clientY);
    };
    const onContext = (e: MouseEvent) => {
      if (overScene(e.target)) e.preventDefault();
    };
    root.addEventListener('wheel', onWheel as EventListener, { capture: true, passive: false });
    root.addEventListener('contextmenu', onContext as EventListener);
    return () => {
      root.removeEventListener('wheel', onWheel as EventListener, { capture: true } as EventListenerOptions);
      root.removeEventListener('contextmenu', onContext as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, size.width, size.height]);

  useEffect(() => {
    const typingIn = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || !!el.closest?.('.xterm'));
    };
    const setSpace = (on: boolean) => {
      nav.space = on;
      const c = controls.current;
      if (c) c.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      document.body.classList.toggle('space-pan', on);
    };
    const onDown = (e: KeyboardEvent) => {
      if (typingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!nav.space) setSpace(true);
        return;
      }
      const k = keyNav(e.key);
      if (!k) return;
      e.preventDefault();
      if (k.pan) panPixels(k.pan[0] * 90, k.pan[1] * 90);
      if (k.zoom) zoomBy(k.zoom);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && nav.space) {
        e.preventDefault();
        setSpace(false);
      }
    };
    const onBlur = () => nav.space && setSpace(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);


  const fly = (toTarget: THREE.Vector3, toPos: THREE.Vector3, duration = 0.8) => {
    const c = controls.current;
    if (!c) return;
    flight.current = { fromPos: camera.position.clone(), fromTarget: c.target.clone(), toPos, toTarget, t: 0, duration };
    lastInteract.current = performance.now();
  };

  /** Fly so the target sits at the given distance, keeping roughly the current viewing direction. */
  const flyTo = (target: THREE.Vector3, distance: number) => {
    const c = controls.current;
    if (!c) return;
    const dir = new THREE.Vector3().subVectors(camera.position, c.target).normalize();
    dir.lerp(HERO_DIR, 0.35).normalize();
    if (dir.y < 0.45) dir.setY(0.45).normalize();
    fly(target, target.clone().add(dir.multiplyScalar(distance)));
  };

  useEffect(() => {
    if (!flySeq || !layout) return;
    const sel = useWorld.getState().selection;
    if (!sel) return;
    if (sel.kind === 'station') {
      const b = layout.buildings.get(sel.id);
      if (b) flyTo(new THREE.Vector3(b.pos[0], b.pos[1] + 2, b.pos[2]), 34 * FOV_K);
    } else if (sel.kind === 'item') {
      const p = podPositions.get(sel.id) ?? (layout.pods.get(sel.id) ? new THREE.Vector3(...layout.pods.get(sel.id)!.pos) : null);
      if (p) flyTo(p.clone(), 44 * FOV_K);
    } else if (sel.kind === 'domain') {
      const rows = layout.islands.filter((i) => layout.lanes[i.lane ?? -1]?.domain.id === sel.id);
      if (rows.length) {
        const endX = GATE_X[PHASES[PHASES.length - 1]];
        const pts = rows.flatMap((isl) => [new THREE.Vector3(...isl.center), new THREE.Vector3(endX, SKY_Y, isl.center[2])]);
        const f = frameBox(pts, HERO_DIR, 60);
        fly(f.target, f.pos);
      }
    } else if (sel.kind === 'pile') {
      const shipped = useWorld.getState().snapshot?.shipped ?? [];
      const racks = warehouseRacks(layout, shipped);
      const g = warehouseGeometry(layout, racks);
      const rack = racks.find((r) => r.domain === sel.id);
      if (sel.id === PILE_DOCK) {
        const b = bayGeometry(g);
        flyTo(new THREE.Vector3(b.cx, b.beltY, b.z), 32 * FOV_K);
      } else if (rack) {
        // the front of the domain's rack, where the newest crates sit
        flyTo(new THREE.Vector3(g.rackFrontX + 4, g.floor + 1.8, rack.z), 40 * FOV_K);
      } else {
        // the warehouse front: dock, open hall and every rack
        const pts = [new THREE.Vector3(bayGeometry(g).x0, g.floor, g.zMax), new THREE.Vector3(g.backX, g.floor + WAREHOUSE_WALL_H + 3, g.zMin)];
        const f = frameBox(pts, HERO_DIR, 45);
        fly(f.target, f.pos);
      }
    } else if (sel.kind === 'library') {
      // the library and the row column beside it, so the rows a card can be dropped on stay in view
      const [x, y, z] = libraryPos(layout);
      const r = LIBRARY.radius;
      const pts = [new THREE.Vector3(x - r, y - 2, z - r), new THREE.Vector3(x + r, y + LIBRARY.height * LIBRARY.scale, z + r)];
      for (const isl of layout.islands) pts.push(new THREE.Vector3(...isl.center));
      const f = frameBox(pts, HERO_DIR, 50);
      fly(f.target, f.pos);
    } else if (sel.kind === 'gate') {
      const x = GATE_X[sel.phase] + 1;
      const pts = [new THREE.Vector3(x - 8, SKY_Y, layout.bounds.maxZ + 3), new THREE.Vector3(x + 8, SKY_Y + 14, layout.bounds.minZ - 20)];
      const f = frameBox(pts, HERO_DIR, 55);
      fly(f.target, f.pos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flySeq]);

  useEffect(() => {
    if (!presetSeq || !layout) return;
    const { preset, snapshot } = useWorld.getState();
    if (preset === 'overview') {
      const f = overviewFrame(layout, view);
      fly(f.target, f.pos, 1.0);
    } else if (preset === 'needs' && snapshot) {
      const pts: THREE.Vector3[] = [];
      for (const id of needsOwnerIds(snapshot)) {
        const p = layout.pods.get(id);
        if (p) pts.push(new THREE.Vector3(...p.pos));
      }
      for (const id of needsOwnerStations(snapshot)) {
        const b = layout.buildings.get(id);
        if (b) pts.push(new THREE.Vector3(...b.pos));
      }
      if (pts.length) {
        const f = frameBox(pts, HERO_DIR, 50);
        fly(f.target, f.pos, 1.0);
      }
    } else if (preset === 'pipeline') {
      // kanban: near top-down over the nine district columns
      const target = new THREE.Vector3((GATE_X[PHASES[0]] + GATE_X[PHASES[PHASES.length - 1]]) / 2 + 1, SKY_Y, layout.pipe.midZ - 4);
      fly(target, target.clone().add(PIPE_DIR.clone().multiplyScalar(PIPE_DIST)), 1.0);
    } else if (preset === 'shipped') {
      const g = warehouseGeometry(layout, warehouseRacks(layout, useWorld.getState().snapshot?.shipped ?? []));
      // the dock and the whole warehouse
      const target = new THREE.Vector3(g.frontX - 2, 0, g.cz);
      fly(target, target.clone().add(new THREE.Vector3(-55, 95, 95).multiplyScalar(FOV_K)), 1.0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetSeq]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    if (!framed.current && layout) {
      // first frame once both the layout and the controls exist
      framed.current = true;
      const o = overviewFrame(layout, view);
      camera.position.copy(o.pos);
      c.target.copy(o.target);
    }
    if (import.meta.env.DEV) {
      const w = window as unknown as { __rig: unknown; __cam: unknown };
      w.__rig = { pos: camera.position.toArray().map(Math.round), target: c.target.toArray().map(Math.round) };
      w.__cam = (p: number[], t: number[]) => fly(new THREE.Vector3(...t), new THREE.Vector3(...p), 0.01);
    }
    const f = flight.current;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.duration);
      const k = ease(f.t);
      camera.position.lerpVectors(f.fromPos, f.toPos, k);
      c.target.lerpVectors(f.fromTarget, f.toTarget, k);
      if (f.t >= 1) flight.current = null;
    }
    const idle = performance.now() - lastInteract.current > IDLE_DRIFT_AFTER_MS;
    const { selection, pending, commandDrawer } = useWorld.getState();
    const swaying = idle && !selection && !f && !pending && !commandDrawer.open;
    if (swaying) {
      // slow sway of a few degrees around where the camera was left, never a full orbit
      if (!sway.current) sway.current = { base: camera.position.clone().sub(c.target), t: 0 };
      sway.current.t += dt;
      // small enough that the district columns stay upright
      const a = Math.sin(sway.current.t * 0.09) * 0.025;
      camera.position.copy(sway.current.base).applyAxisAngle(UP, a).add(c.target);
    } else if (sway.current) sway.current = null;
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={14}
      maxDistance={700}
      enableZoom={false}
      screenSpacePanning={false}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      minPolarAngle={0.2}
      maxPolarAngle={1.3}
      zoomSpeed={0.8}
      rotateSpeed={0.55}
      panSpeed={0.9}
      onStart={() => {
        flight.current = null;
        lastInteract.current = performance.now();
      }}
      onChange={() => {
        if (!flight.current && !sway.current) lastInteract.current = performance.now();
      }}
    />
  );
}

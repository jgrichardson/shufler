import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FOV, HORIZON_ROWS_TOP, PANEL_FRACTION, horizonFrame, overviewFrame } from '../src/scene/CameraRig';
import { HORIZON_FOV, HORIZON_MAX_POLAR, HORIZON_PITCH_DEG, cameraFromQuery, useHorizon } from '../src/scene/horizon';
import { SKY_Y, computeLayout } from '../src/scene/layout';
import { normalizeSnapshot } from '../src/lib/derive';
import { makeMockSnapshot } from '../src/mock/snapshot';

const layout = computeLayout(normalizeSnapshot(makeMockSnapshot(1_800_000_000_000), { now: 1_800_000_000 }));
const view = { width: 1600, height: 1000, panel: true };

/** A camera like the rig's at the horizon, placed on the frame. */
function horizonCam(f: { pos: THREE.Vector3; target: THREE.Vector3 }) {
  const cam = new THREE.PerspectiveCamera(HORIZON_FOV, view.width / view.height, 1, 6000);
  cam.filmGauge = 35;
  cam.filmOffset = (PANEL_FRACTION / 2) * cam.getFilmWidth();
  cam.updateProjectionMatrix();
  cam.position.copy(f.pos);
  cam.lookAt(f.target);
  cam.updateMatrixWorld();
  return cam;
}

describe('?camera= parameter', () => {
  it('opens on the horizon only for camera=horizon, any case', () => {
    expect(cameraFromQuery('?camera=horizon')).toBe('horizon');
    expect(cameraFromQuery('?mock=1&camera=Horizon&skin=casino')).toBe('horizon');
    expect(cameraFromQuery('?camera=default')).toBe('default');
    expect(cameraFromQuery('?camera=')).toBe('default');
    expect(cameraFromQuery('')).toBe('default');
    expect(cameraFromQuery('?horizon=1')).toBe('default');
  });
});

describe('horizon store', () => {
  it('toggle flips the view and bumps the flight sequence; set to the same value does nothing', () => {
    useHorizon.setState({ on: false, seq: 0 });
    useHorizon.getState().toggle();
    expect(useHorizon.getState()).toMatchObject({ on: true, seq: 1 });
    useHorizon.getState().set(true);
    expect(useHorizon.getState().seq).toBe(1);
    useHorizon.getState().toggle();
    expect(useHorizon.getState()).toMatchObject({ on: false, seq: 2 });
  });
  it('drop (another flight took the camera) clears the flag without a flight back', () => {
    useHorizon.setState({ on: true, seq: 5 });
    useHorizon.getState().drop();
    expect(useHorizon.getState()).toMatchObject({ on: false, seq: 5 });
    useHorizon.getState().drop();
    expect(useHorizon.getState()).toMatchObject({ on: false, seq: 5 });
  });
});

describe('horizon framing', () => {
  const f = horizonFrame(layout, view);
  const cam = horizonCam(f);
  const toPx = (p: THREE.Vector3) => {
    const v = p.clone().project(cam);
    return { x: (v.x * 0.5 + 0.5) * view.width, y: (-v.y * 0.5 + 0.5) * view.height, z: v.z };
  };

  it('looks straight down the lanes, pitched only a little below level', () => {
    const dir = f.pos.clone().sub(f.target).normalize();
    expect(Math.abs(dir.x)).toBeLessThan(1e-9);
    expect((Math.asin(dir.y) * 180) / Math.PI).toBeCloseTo(HORIZON_PITCH_DEG, 3);
  });

  it('puts the horizon line in the top third of the frame, below the top bars', () => {
    // a point far out along the view direction, level with the camera, lands on the horizon line
    const far = f.pos.clone().add(new THREE.Vector3(0, 0, -5000));
    const y = toPx(far).y;
    expect(y).toBeGreaterThan(120);
    expect(y).toBeLessThan(view.height / 3);
  });

  it('keeps every row in front of the camera, in the lower part of the frame and clear of the bars', () => {
    const top = (0.5 - HORIZON_ROWS_TOP / 2) * view.height;
    for (const isl of layout.islands) {
      const p = toPx(new THREE.Vector3(isl.center[0], isl.top, isl.center[2]));
      expect(p.z).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(top - 2);
      expect(p.y).toBeLessThan(view.height - 100);
    }
  });

  it('spreads the rows far enough apart for the slim headers (16px + 1px gap) to stay near level with them', () => {
    const ys = layout.islands.map((isl) => toPx(new THREE.Vector3(isl.center[0], isl.top, isl.center[2])).y).sort((a, b) => a - b);
    expect((ys[ys.length - 1] - ys[0]) / (ys.length - 1)).toBeGreaterThan(15);
  });

  it('sits inside the horizon orbit limit, so the controls never clamp it on arrival', () => {
    const polar = new THREE.Spherical().setFromVector3(f.pos.clone().sub(f.target)).phi;
    expect(polar).toBeCloseTo(Math.PI / 2 - (HORIZON_PITCH_DEG * Math.PI) / 180, 6);
    expect(polar).toBeLessThan(HORIZON_MAX_POLAR);
  });

  it('is a wider lens than the Overview, and the Overview framing is unchanged by it', () => {
    expect(HORIZON_FOV).toBeGreaterThan(FOV);
    const o = overviewFrame(layout, view);
    const dir = o.pos.clone().sub(o.target).normalize();
    expect((Math.asin(dir.y) * 180) / Math.PI).toBeCloseTo(55, 3);
    expect(o.target.y).toBeCloseTo(SKY_Y - 2, 6);
  });

  it('frames the same way at other window sizes', () => {
    for (const v of [{ width: 1280, height: 800, panel: true }, { width: 2560, height: 1400, panel: true }, { width: 820, height: 900, panel: false }]) {
      const g = horizonFrame(layout, v);
      expect(Number.isFinite(g.pos.length())).toBe(true);
      expect(g.pos.y).toBeGreaterThan(SKY_Y);
    }
  });
});

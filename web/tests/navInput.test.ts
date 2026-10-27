import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { classifyWheel, isPanGesture, keyNav, zoomFactor } from '../src/lib/navInput';
import { FOV, PANEL_FRACTION, overviewFrame } from '../src/scene/CameraRig';
import { computeLayout, cellX, BAND_W, gateArchX } from '../src/scene/layout';
import { normalizeSnapshot } from '../src/lib/derive';
import { PHASES } from '../src/lib/domains';

const wheel = (o: Partial<Parameters<typeof classifyWheel>[0]>) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...o });

describe('wheel and trackpad', () => {
  it('pinch (ctrlKey) zooms', () => expect(classifyWheel(wheel({ deltaY: 3, ctrlKey: true, wheelDeltaY: -9 }))).toBe('zoom'));
  it('a mouse wheel notch zooms', () => {
    expect(classifyWheel(wheel({ deltaY: 100, wheelDeltaY: -120, wheelDeltaX: 0 }))).toBe('zoom');
    expect(classifyWheel(wheel({ deltaY: 3, deltaMode: 1 }))).toBe('zoom');
  });
  it('two-finger trackpad scroll pans, both axes', () => {
    expect(classifyWheel(wheel({ deltaY: 7, wheelDeltaY: -21, wheelDeltaX: 0 }))).toBe('pan');
    expect(classifyWheel(wheel({ deltaX: -5, wheelDeltaX: 15, wheelDeltaY: 0 }))).toBe('pan');
    expect(classifyWheel(wheel({ deltaX: 4, deltaY: 2 }))).toBe('pan');
    expect(classifyWheel(wheel({ deltaX: 12, deltaY: 6, wheelDeltaX: -14, wheelDeltaY: -7 }))).toBe('pan');
    expect(classifyWheel(wheel({ deltaY: 6, wheelDeltaY: -7, wheelDeltaX: 0 }))).toBe('zoom');
  });
  it('zoom steps: out for positive delta, clamped', () => {
    expect(zoomFactor(100, false)).toBeGreaterThan(1);
    expect(zoomFactor(-100, false)).toBeLessThan(1);
    expect(zoomFactor(1e6, false)).toBeCloseTo(Math.exp(0.5));
  });
});

describe('pan gestures and keys', () => {
  it('right, middle, Shift+left and Space+left pan; plain left does not', () => {
    expect(isPanGesture(2, false, false)).toBe(true);
    expect(isPanGesture(0, true, false)).toBe(true);
    expect(isPanGesture(0, false, true)).toBe(true);
    expect(isPanGesture(0, false, false)).toBe(false);
  });
  it('arrows pan and +/- zoom', () => {
    expect(keyNav('ArrowLeft')).toEqual({ pan: [-1, 0] });
    expect(keyNav('ArrowDown')).toEqual({ pan: [0, 1] });
    expect(keyNav('+')!.zoom).toBeLessThan(1);
    expect(keyNav('-')!.zoom).toBeGreaterThan(1);
    expect(keyNav('x')).toBeNull();
  });
});

describe('Overview framing', () => {
  const snap = normalizeSnapshot(
    {
      stations: ['AUTH', 'BILLING', 'MOBILE', 'DOCS'].map((t, i) => ({ id: `ws-${i}`, title: t, pr_numbers: [i], sidebar_index: i })),
      workpieces: ['auth', 'billing', 'mobile', 'docs'].map((d, i) => ({ id: `pr:${i}`, pr: i, title: 't', domain: d, phase: 'build', ball: { who: 'none', name: null } })),
    },
    { now: 1_800_000_000 },
  );
  const layout = computeLayout(snap);
  const view = { width: 1800, height: 1100, panel: true };
  const f = overviewFrame(layout, view);

  it('looks straight down the lanes: no yaw, pitched about 55°', () => {
    const dir = f.pos.clone().sub(f.target).normalize();
    expect(Math.abs(dir.x)).toBeLessThan(1e-9);
    expect((Math.asin(dir.y) * 180) / Math.PI).toBeCloseTo(55, 3);
  });

  it('keeps the whole boulevard left of the panel, columns near-vertical', () => {
    const cam = new THREE.PerspectiveCamera(FOV, view.width / view.height, 1, 4000);
    cam.filmGauge = 35;
    cam.filmOffset = (PANEL_FRACTION / 2) * cam.getFilmWidth();
    cam.updateProjectionMatrix();
    cam.position.copy(f.pos);
    cam.lookAt(f.target);
    cam.updateMatrixWorld();
    const px = (x: number, z: number) => {
      const v = new THREE.Vector3(x, 5.5, z).project(cam);
      return [(v.x * 0.5 + 0.5) * view.width, (-v.y * 0.5 + 0.5) * view.height];
    };
    const panelLeft = view.width * (1 - PANEL_FRACTION);
    for (const p of PHASES) {
      const [xFront] = px(cellX(p), layout.bounds.maxZ);
      const [xBack] = px(cellX(p), layout.bounds.minZ);
      expect(xFront).toBeGreaterThan(0);
      expect(xFront).toBeLessThan(panelLeft);
      // a column leans by less than a quarter of a band width end to end
      const bandPx = px(cellX(p) + BAND_W / 2, layout.bounds.minZ)[0] - px(cellX(p) - BAND_W / 2, layout.bounds.minZ)[0];
      expect(Math.abs(xFront - xBack)).toBeLessThan(bandPx * 0.25);
    }
  });

  it('pods snap to the centre of their district band', () => {
    const pod = layout.pods.get('pr:0')!;
    expect(pod.pos[0]).toBe(cellX('build'));
    expect(gateArchX('build')).toBe(cellX('build') - BAND_W / 2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLEAN_LAYERS,
  DEFAULT_LAYERS,
  LAYERS_STORAGE_KEY,
  ZOOM_LABEL_PPU,
  isClean,
  lodFor,
  parseLayers,
  pixelsPerUnit,
  plateVisible,
  podRing,
  podShowsNumber,
} from '../src/ui/layers';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe('layer store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts on the defaults: every layer on, labels Auto', async () => {
    const { useLayers } = await import('../src/ui/layers');
    const s = useLayers.getState();
    expect(s.labels).toBe('auto');
    expect([s.islands, s.sessions, s.prs, s.conflicts, s.needs, s.tethers, s.beams]).toEqual([true, true, true, true, true, true, true]);
  });

  it('persists toggles and the label mode, and reloads them', async () => {
    const { useLayers } = await import('../src/ui/layers');
    useLayers.getState().toggle('tethers');
    useLayers.getState().setLabels('none');
    const saved = JSON.parse(localStorage.getItem(LAYERS_STORAGE_KEY)!);
    expect(saved).toMatchObject({ tethers: false, labels: 'none' });
    vi.resetModules();
    const again = await import('../src/ui/layers');
    expect(again.useLayers.getState()).toMatchObject({ tethers: false, labels: 'none', islands: true });
  });

  it('Clean keeps islands, pods and needs-me only; a second press restores the defaults', async () => {
    const { useLayers } = await import('../src/ui/layers');
    useLayers.getState().toggleClean();
    const s = useLayers.getState();
    expect(s).toMatchObject({ islands: true, prs: true, needs: true, sessions: false, tethers: false, beams: false, conflicts: false });
    expect(isClean(s)).toBe(true);
    useLayers.getState().toggleClean();
    expect(useLayers.getState()).toMatchObject(DEFAULT_LAYERS);
  });

  it('keeps working when storage throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const { useLayers } = await import('../src/ui/layers');
    expect(useLayers.getState().labels).toBe('auto');
    useLayers.getState().toggle('beams');
    expect(useLayers.getState().beams).toBe(false);
  });
});

describe('parseLayers', () => {
  it('falls back field by field and ignores junk', () => {
    expect(parseLayers(null)).toEqual(DEFAULT_LAYERS);
    expect(parseLayers('not json')).toEqual(DEFAULT_LAYERS);
    expect(parseLayers(JSON.stringify({ beams: false, labels: 'loud', islands: 'yes' }))).toEqual({ ...DEFAULT_LAYERS, beams: false });
  });
  it('isClean only matches the exact Clean set', () => {
    expect(isClean(CLEAN_LAYERS)).toBe(true);
    expect(isClean(DEFAULT_LAYERS)).toBe(false);
    expect(isClean({ ...CLEAN_LAYERS, labels: 'all' })).toBe(false);
  });
});

describe('LOD bands', () => {
  it('measures on-screen scale independent of the lens', () => {
    // same framing, different lens and distance: same scale
    const a = pixelsPerUnit(1000, 100, 34);
    const b = pixelsPerUnit(1000, (100 * Math.tan((34 * Math.PI) / 360)) / Math.tan((25 * Math.PI) / 360), 25);
    expect(a).toBeCloseTo(b, 6);
  });
  it('bands: far < mid < near, labels between mid and near', () => {
    expect(lodFor(4)).toBe('far');
    expect(lodFor(10)).toBe('mid');
    expect(lodFor(30)).toBe('near');
    expect(lodFor(ZOOM_LABEL_PPU)).toBe('mid');
  });
});

describe('label rules (Auto / All / None)', () => {
  const auto = { labels: 'auto' as const, zoomed: false };
  it('Auto at overview: every pod badge, domain chips and dock; no building plates, crates hidden', () => {
    expect(plateVisible('island', auto)).toBe(true);
    expect(plateVisible('dock', auto)).toBe(true);
    expect(plateVisible('pod', auto)).toBe(true);
    expect(plateVisible('building', auto)).toBe(false);
    expect(plateVisible('crate', auto)).toBe(false);
    expect(plateVisible('pile', auto)).toBe(false);
  });
  it('round 12: Auto shows every pod badge whatever its state, and never a building plate', () => {
    for (const c of [{}, { red: true }, { red: true, needsOn: false }, { selected: true }, { hovered: true }, { near: true }])
      expect(plateVisible('pod', { ...auto, ...c })).toBe(true);
    for (const c of [{ red: true }, { near: true }, { hovered: true }, { selected: true }, { zoomed: true }])
      expect(plateVisible('building', { ...auto, ...c })).toBe(false);
    expect(plateVisible('pile', { ...auto, red: true })).toBe(true);
  });
  it('Auto shows crates and racks once zoomed in', () => {
    for (const k of ['pod', 'crate', 'pile'] as const) expect(plateVisible(k, { ...auto, zoomed: true })).toBe(true);
  });
  it('All shows everything but building plates; None shows nothing; an off layer hides its plates', () => {
    expect(plateVisible('pod', { labels: 'all', zoomed: false })).toBe(true);
    expect(plateVisible('pile', { labels: 'all', zoomed: false })).toBe(true);
    expect(plateVisible('building', { labels: 'all', zoomed: false })).toBe(false);
    expect(plateVisible('pod', { labels: 'none', zoomed: true, red: true, selected: true })).toBe(false);
    expect(plateVisible('island', { labels: 'none', zoomed: true })).toBe(false);
    expect(plateVisible('pod', { labels: 'auto', zoomed: true, layerOn: false })).toBe(false);
  });
  it('pods: a dot until zoomed in or selected, then the number', () => {
    expect(podShowsNumber(auto)).toBe(false);
    expect(podShowsNumber({ ...auto, zoomed: true })).toBe(true);
    expect(podShowsNumber({ ...auto, selected: true })).toBe(true);
    expect(podShowsNumber({ labels: 'all', zoomed: false })).toBe(true);
    expect(podShowsNumber({ labels: 'none', zoomed: true })).toBe(false);
  });
  it('dot rings: red for needs-me beats amber for conflict; layers switch them off', () => {
    const on = { needs: true, conflicts: true };
    expect(podRing(true, true, on)).toBe('red');
    expect(podRing(false, true, on)).toBe('amber');
    expect(podRing(false, false, on)).toBeNull();
    expect(podRing(true, true, { needs: false, conflicts: true })).toBe('amber');
    expect(podRing(false, true, { needs: true, conflicts: false })).toBeNull();
  });
});

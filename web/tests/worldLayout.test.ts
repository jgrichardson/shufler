import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_STORAGE_KEY, initialWorldLayout, islandsShown, parseWorldLayout } from '../src/ui/worldLayout';

function memoryStorage(seed: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe('world layout: choosing grid or islands', () => {
  it('reads only the two known layouts', () => {
    expect(parseWorldLayout('islands')).toBe('islands');
    expect(parseWorldLayout('grid')).toBe('grid');
    expect(parseWorldLayout('Islands')).toBeNull();
    expect(parseWorldLayout('')).toBeNull();
    expect(parseWorldLayout(null)).toBeNull();
    expect(parseWorldLayout(3)).toBeNull();
  });

  it('starts on the grid when nothing is chosen', () => {
    expect(initialWorldLayout('', null)).toBe('grid');
    expect(initialWorldLayout('?mock=1', 'nonsense')).toBe('grid');
  });

  it('takes ?layout= over the stored choice, and the stored choice otherwise', () => {
    expect(initialWorldLayout('?mock=1&layout=islands', 'grid')).toBe('islands');
    expect(initialWorldLayout('?layout=grid', 'islands')).toBe('grid');
    expect(initialWorldLayout('?mock=1', 'islands')).toBe('islands');
    expect(initialWorldLayout('?layout=boats', 'islands')).toBe('islands');
  });

  it('draws islands in every view but Pipeline, which keeps the grid', () => {
    expect(islandsShown('islands', 'overview')).toBe(true);
    expect(islandsShown('islands', 'domain')).toBe(true);
    expect(islandsShown('islands', 'pipeline')).toBe(false);
    expect(islandsShown('grid', 'overview')).toBe(false);
  });
});

describe('world layout store', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts from the stored choice and saves a new one', async () => {
    const ls = memoryStorage({ [LAYOUT_STORAGE_KEY]: 'islands' });
    vi.stubGlobal('localStorage', ls);
    const { useWorldLayout } = await import('../src/ui/worldLayout');
    expect(useWorldLayout.getState().mode).toBe('islands');
    useWorldLayout.getState().set('grid');
    expect(useWorldLayout.getState().mode).toBe('grid');
    expect(ls.getItem(LAYOUT_STORAGE_KEY)).toBe('grid');
  });

  it('starts from ?layout=islands without saving it', async () => {
    const ls = memoryStorage();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', { location: { search: '?mock=1&layout=islands' } });
    const { useWorldLayout } = await import('../src/ui/worldLayout');
    expect(useWorldLayout.getState().mode).toBe('islands');
    expect(ls.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it('keeps working when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const { useWorldLayout } = await import('../src/ui/worldLayout');
    expect(useWorldLayout.getState().mode).toBe('grid');
    useWorldLayout.getState().set('islands');
    expect(useWorldLayout.getState().mode).toBe('islands');
  });

  it('the toggle flips the layout and re-applies the current view', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const { useWorldLayout, toggleLayout } = await import('../src/ui/worldLayout');
    const { useWorld, dispatch } = await import('../src/store');
    dispatch({ type: 'preset', preset: 'domain' });
    toggleLayout();
    expect(useWorldLayout.getState().mode).toBe('islands');
    expect(useWorld.getState().preset).toBe('domain');
    toggleLayout();
    expect(useWorldLayout.getState().mode).toBe('grid');
  });

  it('choosing islands in Pipeline goes back to the view before it; choosing the same layout does nothing', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const { useWorldLayout, chooseLayout } = await import('../src/ui/worldLayout');
    const { useWorld, dispatch } = await import('../src/store');
    dispatch({ type: 'preset', preset: 'domain' });
    dispatch({ type: 'preset', preset: 'pipeline' });
    chooseLayout('grid');
    expect(useWorld.getState().preset).toBe('pipeline');
    chooseLayout('islands');
    expect(useWorldLayout.getState().mode).toBe('islands');
    expect(useWorld.getState().preset).toBe('domain');
  });

  it('with the horizon view on, switching layout keeps it on and re-frames it instead of re-applying the view', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const { useWorldLayout, toggleLayout } = await import('../src/ui/worldLayout');
    const { useWorld } = await import('../src/store');
    const { useHorizon } = await import('../src/scene/horizon');
    useHorizon.getState().set(true);
    const seq = useHorizon.getState().seq;
    const presetSeq = useWorld.getState().presetSeq;
    toggleLayout();
    expect(useWorldLayout.getState().mode).toBe('islands');
    expect(useHorizon.getState()).toMatchObject({ on: true, seq: seq + 1, reframed: true });
    expect(useWorld.getState().presetSeq).toBe(presetSeq);
    // turning it off afterwards is an ordinary flight back out
    useHorizon.getState().toggle();
    expect(useHorizon.getState()).toMatchObject({ on: false, reframed: false });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STAGES, PHASES, PHASE_LABEL, normalizePhase, phaseX, pipelineKey, setPipelineStages } from '../src/lib/domains';
import { PHASE_ACCENT } from '../src/lib/colors';
import { dockX, skywayEndX } from '../src/scene/layout';

afterEach(() => {
  setPipelineStages(DEFAULT_STAGES);
});

describe('Phases v4 pipeline stages', () => {
  it('defaults to seven districts, left to right', () => {
    expect([...PHASES]).toEqual(['brainstorm', 'plan', 'build', 'qa', 'review', 'merge', 'deploy']);
    expect(PHASE_ACCENT.qa).toBe('#45c7e0');
    expect(PHASE_LABEL.qa).toBe('QA');
  });

  it('takes names, order and colours from the snapshot list and ignores shipped', () => {
    const before = pipelineKey();
    expect(
      setPipelineStages([
        { id: 'plan', label: 'Planning', color: '#111111' },
        { id: 'build', label: 'Build', color: '#222222' },
        { id: 'shipped', label: 'Shipped', color: '#333333' },
      ]),
    ).toBe(true);
    expect([...PHASES]).toEqual(['plan', 'build']);
    expect(PHASE_LABEL.plan).toBe('Planning');
    expect(PHASE_ACCENT.build).toBe('#222222');
    expect(pipelineKey()).not.toBe(before);
  });

  it('keeps the current list on junk input', () => {
    expect(setPipelineStages(null)).toBe(false);
    expect(setPipelineStages([{ label: 'no id' }])).toBe(false);
    expect(PHASES).toHaveLength(7);
  });

  it('maps old phase names forward', () => {
    expect(normalizePhase('test')).toBe('build');
    expect(normalizePhase('ci')).toBe('review');
    expect(normalizePhase('preview')).toBe('qa');
    expect(normalizePhase('ready')).toBe('merge');
    expect(normalizePhase('docs')).toBe('shipped');
    expect(normalizePhase('shipped')).toBe('shipped');
    expect(normalizePhase('bogus')).toBeNull();
  });

  it('keeps shipped PRs off every band and counter: only the dock holds them', async () => {
    const { normalizeSnapshot } = await import('../src/lib/derive');
    const shipped = Array.from({ length: 14 }, (_, i) => ({ pr: 100 + i, title: 't', phase: 'shipped', stage: 'deployed', ball: { who: 'none', name: null } }));
    const s = normalizeSnapshot(
      { stations: [], workpieces: [...shipped, { pr: 1, title: 't', phase: 'deploy', ball: { who: 'none', name: null } }, { pr: 2, title: 't', phase: 'merge', ball: { who: 'owner', name: null } }] },
      { now: 1 },
    );
    const count = (p: string) => s.workpieces.filter((w) => w.phase === p).length;
    expect(count('shipped')).toBe(14);
    expect(count('merge')).toBe(1);
    expect(count('deploy')).toBe(1);
  });

  it('describes districts in the daemon\'s words', async () => {
    const { PHASE_DESC } = await import('../src/lib/domains');
    setPipelineStages([...DEFAULT_STAGES.map((x) => ({ ...x, description: x.id === 'merge' ? 'Ready to merge.' : '' }))]);
    expect(PHASE_DESC.merge).toBe('Ready to merge.');
  });

  it('places bands 14 apart and ends the skyway after the last one', () => {
    expect(phaseX('brainstorm')).toBe(0);
    expect(phaseX('deploy')).toBe(84);
    expect(skywayEndX()).toBe(91);
    expect(dockX()).toBeGreaterThan(skywayEndX());
    expect(phaseX('shipped')).toBeGreaterThan(phaseX('deploy'));
  });
});

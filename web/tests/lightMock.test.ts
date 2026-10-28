import { describe, expect, it } from 'vitest';
import { lightenMockSnapshot, makeMockSnapshot, tickMockSnapshot } from '../src/mock/snapshot';

describe('lightenMockSnapshot', () => {
  it('keeps six rows, only their PRs, and no empty groups', () => {
    const snap = lightenMockSnapshot(makeMockSnapshot(0));
    expect(snap.stations).toHaveLength(6);
    const ids = new Set(snap.stations.map((s: { id: string }) => s.id));
    for (const w of snap.workpieces) expect(ids.has(w.station_id)).toBe(true);
    expect(snap.workpieces.length).toBeLessThanOrEqual(12);
    for (const h of snap.halls) expect(h.station_ids.length).toBeGreaterThan(0);
  });

  it('still carries the moving demo PRs through a tick', () => {
    const next = tickMockSnapshot(lightenMockSnapshot(makeMockSnapshot(0)), 1, 1000);
    expect(next.workpieces.some((w: { pr: number }) => w.pr === 409)).toBe(true);
    expect(next.workpieces.some((w: { pr: number }) => w.pr === 384)).toBe(true);
  });
});

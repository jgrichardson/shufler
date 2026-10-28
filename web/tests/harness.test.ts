import { describe, expect, it } from 'vitest';
import { normalizeSnapshot } from '../src/lib/derive';
import { makeMockSnapshot } from '../src/mock/snapshot';

const NOW = Date.parse('2026-10-21T10:00:00Z');

describe('station harness', () => {
  it('keeps the daemon harness and leaves old snapshots null', () => {
    const s = normalizeSnapshot({ stations: [{ id: 'a', title: 'A', harness: 'codex' }, { id: 'b', title: 'B' }], workpieces: [] }, { now: NOW / 1000 });
    expect(s.stations.map((x) => x.harness)).toEqual(['codex', null]);
  });
  it('mock mode mixes Codex rows with Claude rows, one waiting on an approval', () => {
    const s = normalizeSnapshot(makeMockSnapshot(NOW), { now: NOW / 1000 });
    const codex = s.stations.filter((x) => x.harness === 'codex');
    expect(codex.length).toBe(2);
    expect(s.stations.filter((x) => x.harness === 'claude').length).toBeGreaterThan(10);
    const q = codex.find((x) => x.pending_question)?.pending_question;
    expect(q?.kind).toBe('approval');
    expect(q?.options.map((o) => o.key)).toEqual(['y', 'a', 'Escape']);
    expect(codex.every((x) => x.telemetry?.model?.startsWith('gpt-'))).toBe(true);
  });
});

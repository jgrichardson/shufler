import { describe, expect, it } from 'vitest';
import { stackOffsets } from '../src/scene/plateRegistry';
import { itemLabel } from '../src/ui/panel/common';

describe('round 12: pod badges stack instead of overlapping', () => {
  const r = (x: number, priority: number) => ({ x, y: 100, w: 40, h: 14, priority });

  it('leaves badges that do not touch where they are', () => {
    expect(stackOffsets([r(0, 1), r(100, 1)])).toEqual([0, 0]);
  });

  it('keeps the needs-you badge in the lowest slot and lifts the others above it, one by one', () => {
    const dy = stackOffsets([r(0, 1.5), r(10, 8), r(20, 1.5)]);
    expect(dy[1]).toBe(0);
    expect(dy[0]).toBe(-16);
    expect(dy[2]).toBe(-32);
  });

  it('never leaves two badges of one cell overlapping', () => {
    const rects = Array.from({ length: 6 }, (_, i) => r(i * 7, i % 2 ? 8 : 1.5));
    const dy = stackOffsets(rects);
    const placed = rects.map((x, i) => ({ ...x, y: x.y + dy[i] }));
    for (let a = 0; a < placed.length; a++)
      for (let b = a + 1; b < placed.length; b++) {
        const p = placed[a];
        const q = placed[b];
        const hit = p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;
        expect(hit).toBe(false);
      }
  });
});

describe('round 12: badge text', () => {
  it('shows #NNNN for a PR and up to 18 characters of title for other work', () => {
    expect(itemLabel({ id: 'pr:1', pr: 308, title: 'x' }, 18)).toBe('#308');
    expect(itemLabel({ id: 'fix:a', pr: null, title: 'Backfill customer emails' }, 18)).toBe('Backfill customer…');
    expect(itemLabel({ id: 'fix:b', pr: null, title: 'Short fix' }, 18)).toBe('Short fix');
  });
});

import { describe, expect, it } from 'vitest';
import { stackRows } from '../src/lib/rowStack';

const boxes = (r: ReturnType<typeof stackRows>, h: number) => r.filter((x) => x.visible).map((x) => [x.top, x.top + h]).sort((a, b) => a[0] - b[0]);

describe('row header stacking', () => {
  it('leaves well-spaced headers centred on their rows', () => {
    const r = stackRows([{ id: 'a', y: 200, h: 24 }, { id: 'b', y: 260, h: 24 }], 2, 100, 900);
    expect(r.map((x) => x.top)).toEqual([188, 248]);
    expect(r.every((x) => x.visible)).toBe(true);
  });

  it('never lets headers overlap when rows are tighter than a header', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, y: 300 + i * 15, h: 24 }));
    const b = boxes(stackRows(rows, 2, 100, 900), 24);
    for (let i = 1; i < b.length; i++) expect(b[i][0]).toBeGreaterThanOrEqual(b[i - 1][1] + 2 - 1e-9);
  });

  it('keeps row order and hides headers pushed outside the usable band', () => {
    const r = stackRows([{ id: 'late', y: 880, h: 24 }, { id: 'early', y: 50, h: 24 }], 2, 100, 900);
    expect(r.find((x) => x.id === 'early')!.visible).toBe(false);
    expect(r.find((x) => x.id === 'late')!.visible).toBe(true);
  });
});

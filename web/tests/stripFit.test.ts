import { describe, expect, it } from 'vitest';
import { fitStrip, type StripTag } from '../src/scene/StripProjector';

const tags = (w: number): StripTag[] => [
  { w, label: 'Brainstorm', short: 'Ideas', n: 1 },
  { w, label: 'QA', short: 'QA', n: 4 },
  { w, label: 'Review', short: 'Review', n: 12 },
];

describe('fitStrip', () => {
  it('uses one tier for every tag and steps down as the columns narrow', () => {
    expect(fitStrip(tags(160), 12)[0]).toBe('full');
    expect(fitStrip(tags(115), 12)[0]).toBe('name');
    expect(fitStrip(tags(75), 12)[0]).toBe('tall');
    expect(fitStrip(tags(42), 12)[0]).toBe('stack');
  });

  it('never fits a stacked label below 8px', () => {
    expect(fitStrip(tags(10), 12)[1]).toBe(8);
  });
});

import { describe, expect, it } from 'vitest';
import { isBackwards, journeySeconds, journeyStops } from '../src/scene/journey';

describe('journeys', () => {
  it('passes every district between, ending at the destination', () => {
    expect(journeyStops('build', 'merge')).toEqual(['qa', 'review', 'merge']);
  });
  it('travels back the same way', () => {
    expect(journeyStops('merge', 'build')).toEqual(['review', 'qa', 'build']);
    expect(isBackwards('merge', 'build')).toBe(true);
    expect(isBackwards('merge', 'deploy')).toBe(false);
  });
  it('has no route for shipped or a non-move', () => {
    expect(journeyStops('deploy', 'shipped')).toEqual([]);
    expect(journeyStops('qa', 'qa')).toEqual([]);
  });
  it('takes 1.5s per district, 0.3s when reduced', () => {
    expect(journeySeconds(3, false)).toBe(4.5);
    expect(journeySeconds(3, true)).toBe(0.3);
  });
});

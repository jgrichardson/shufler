import { describe, expect, it } from 'vitest';
import { agoIso, duration } from '../src/lib/format';

describe('duration', () => {
  it('carries rounded minutes into the next hour instead of printing 60m', () => {
    expect(duration(5 * 3600 + 59 * 60 + 45)).toBe('6h 0m');
    expect(duration(22 * 3600 + 59 * 60 + 31)).toBe('23h 0m');
    expect(duration(5 * 3600 + 59 * 60 + 29)).toBe('5h 59m');
  });

  it('carries into minutes and days at their boundaries', () => {
    expect(duration(59.6)).toBe('1m');
    expect(duration(3599)).toBe('1h 0m');
    expect(duration(23 * 3600 + 59 * 60 + 40)).toBe('1d');
    expect(duration(86399)).toBe('1d');
  });

  it('keeps ordinary values unchanged', () => {
    expect(duration(42)).toBe('42s');
    expect(duration(150)).toBe('3m');
    expect(duration(3 * 3600 + 20 * 60)).toBe('3h 20m');
    expect(duration(3 * 86400 + 5)).toBe('3d');
    expect(duration(null)).toBe('—');
  });

  it('never prints 60m from an ISO timestamp either', () => {
    const now = Date.parse('2026-10-22T16:00:00Z');
    expect(agoIso('2026-10-22T10:00:20Z', now)).toBe('6h 0m');
  });
});

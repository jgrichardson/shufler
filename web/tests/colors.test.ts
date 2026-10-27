import { describe, expect, it } from 'vitest';
import { BALL_COLOR, IDLE_COLOR, STALLED_COLOR, STATE_COLOR, hasBeam, stateColor, stationColor } from '../src/lib/colors';
import type { NoteState, Station } from '../src/types';

const st = (state: NoteState | null, status: 'active' | 'idle' | 'stalled' = 'active') =>
  ({
    note: state ? { state, text: 'x', ts: 0 } : null,
    activity: { last_at: null, last_tool: null, subagents: 0, idle_seconds: null, status },
  }) as Pick<Station, 'note' | 'activity'>;

describe('state palette', () => {
  it('gives every note state a distinct hex colour', () => {
    const values = Object.values(STATE_COLOR);
    expect(Object.keys(STATE_COLOR).sort()).toEqual(['done', 'me', 'merged', 'staging', 'waiting', 'working']);
    for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(values).size).toBe(values.length);
  });

  it('stateColor returns the palette colour for known states', () => {
    expect(stateColor('working')).toBe(STATE_COLOR.working);
    expect(stateColor('me')).toBe(STATE_COLOR.me);
  });

  it('stateColor falls back to idle grey for unknown, empty or missing states', () => {
    expect(stateColor('bogus')).toBe(IDLE_COLOR);
    expect(stateColor('')).toBe(IDLE_COLOR);
    expect(stateColor(null)).toBe(IDLE_COLOR);
    expect(stateColor(undefined)).toBe(IDLE_COLOR);
  });
});

describe('stationColor', () => {
  it('uses the note state colour', () => {
    expect(stationColor(st('staging'))).toBe(STATE_COLOR.staging);
  });
  it('is idle grey with no note', () => {
    expect(stationColor(st(null, 'idle'))).toBe(IDLE_COLOR);
  });
  it('stalled overrides any note state', () => {
    expect(stationColor(st('working', 'stalled'))).toBe(STALLED_COLOR);
    expect(stationColor(st('me', 'stalled'))).toBe(STALLED_COLOR);
    expect(stationColor(st(null, 'stalled'))).toBe(STALLED_COLOR);
  });
});

describe('ball colours', () => {
  it("the owner's ball is red, the same red as the 'me' state", () => {
    expect(BALL_COLOR.owner).toBe('#e74c3c');
    expect(BALL_COLOR.owner).toBe(STATE_COLOR.me);
  });
  it('covers every ball holder', () => {
    expect(Object.keys(BALL_COLOR).sort()).toEqual(['ci', 'claude', 'closeout', 'none', 'owner', 'person', 'reviewer', 'testers']);
  });
});

describe('hasBeam', () => {
  it('beams for me/waiting/staging/merged but not working/done/unknown', () => {
    for (const s of ['me', 'waiting', 'staging', 'merged']) expect(hasBeam(s)).toBe(true);
    for (const s of ['working', 'done', null, undefined, 'x']) expect(hasBeam(s)).toBe(false);
  });
});

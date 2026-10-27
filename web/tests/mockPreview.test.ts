import { beforeEach, describe, expect, it } from 'vitest';
import { mockPreview } from '../src/mock/actions';
import { initialState, reduce } from '../src/store/reducer';
import { useWorld } from '../src/store';
import { normalizeSnapshot } from '../src/lib/derive';
import { makeMockSnapshot } from '../src/mock/snapshot';

const NOW = 1_800_000_000_000;

beforeEach(() => {
  const snapshot = normalizeSnapshot(makeMockSnapshot(NOW), { now: NOW / 1000 });
  useWorld.setState(reduce(initialState, { type: 'snapshot', snapshot, at: NOW }));
});

describe("mockPreview('run_skill')", () => {
  it('substitutes {pr} from args_template into the slash text', () => {
    const p = mockPreview('run_skill', { skill: 'review-fix', station_id: 'ws-pf', pr: 123 });
    expect(p.error).toBeNull();
    expect(p.facts?.text).toBe('/review-fix 123');
    expect(p.command).toContain('/review-fix 123');
    expect(p.confirm).toBe('tap');
  });

  it('defaults {pr} to the station focus PR', () => {
    const p = mockPreview('run_skill', { skill: 'review-fix', station_id: 'ws-pf' });
    expect(p.error).toBeNull();
    expect(p.facts?.text).toMatch(/^\/review-fix \d+$/);
  });

  it('errors when a template token has no value', () => {
    const p = mockPreview('run_skill', { skill: 'review-fix', station_id: 'ws-fd' });
    expect(p.error).toContain('{pr}');
  });

  it('explicit args override the template', () => {
    const p = mockPreview('run_skill', { skill: 'review-fix', station_id: 'ws-pf', args: '999 --force' });
    expect(p.error).toBeNull();
    expect(p.facts?.text).toBe('/review-fix 999 --force');
  });

  it('a skill with confirm typed requires typing its name', () => {
    const p = mockPreview('run_skill', { skill: 'restart-claude', station_id: 'ws-pf' });
    expect(p.error).toBeNull();
    expect(p.confirm).toBe('typed');
    expect(p.facts?.requires_typed_confirmation).toBe('restart-claude');
  });

  it('a skill without typed confirm sets no typed requirement', () => {
    const p = mockPreview('run_skill', { skill: 'describe-pr', station_id: 'ws-pf' });
    expect(p.facts).not.toHaveProperty('requires_typed_confirmation');
  });

  it('errors for an unknown skill', () => {
    const p = mockPreview('run_skill', { skill: 'no-such-skill', station_id: 'ws-pf' });
    expect(p.error).toContain('unknown skill');
    expect(p.command).toBeNull();
  });

  it('errors when no session is given and the skill has no default target', () => {
    const p = mockPreview('run_skill', { skill: 'review-fix', pr: 1 });
    expect(p.error).toMatch(/no default session/);
  });

  it('falls back to the skill target when no station is given', () => {
    const p = mockPreview('run_skill', { skill: 'triage-inbox' });
    expect(p.error).toBeNull();
    expect(p.command).toContain('CONTROL');
  });
});

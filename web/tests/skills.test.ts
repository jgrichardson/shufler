import { describe, expect, it } from 'vitest';
import { pinnedSkills, placementOf } from '../src/ui/skills';
import type { Skill } from '../src/types';

const skill = (name: string, over: Partial<Skill> = {}): Skill => ({
  name,
  slash: `/${name}`,
  description: '',
  scope: 'user',
  args_hint: null,
  exposed: true,
  pinned: true,
  target: null,
  args_template: null,
  confirm: 'tap',
  ...over,
});

describe('skill placement', () => {
  const skills = [
    skill('describe-pr', { placement: 'pr' }),
    skill('release-notes', { placement: 'global' }),
    skill('ask-docs', { placement: 'question' }),
    skill('intake', { placement: 'none' }),
    skill('plan'),
    skill('unpinned', { pinned: false, placement: 'pr' }),
  ];

  it('defaults to the session panel', () => {
    expect(placementOf(skill('x'))).toBe('station');
  });
  it('puts each pinned skill only where its placement says; none shows nowhere', () => {
    expect(pinnedSkills('pr', skills).map((s) => s.name)).toEqual(['describe-pr']);
    expect(pinnedSkills('global', skills).map((s) => s.name)).toEqual(['release-notes']);
    expect(pinnedSkills('question', skills).map((s) => s.name)).toEqual(['ask-docs']);
    expect(pinnedSkills('station', skills).map((s) => s.name)).toEqual(['plan']);
  });
});

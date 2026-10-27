import { describe, expect, it } from 'vitest';
import { canMerge, mergeGate, typedConfirmationMatches } from '../src/lib/mergeGate';
import type { Workpiece } from '../src/types';

const wp = (over: Partial<Workpiece>): Workpiece =>
  ({ pr: 858, ci: 'success', reviewer: 'approved', draft: false, stage: 'ready', ...over }) as Workpiece;

describe('merge gate', () => {
  it('opens only for green CI + review bot approved + non-draft open PR', () => {
    expect(mergeGate(wp({})).ok).toBe(true);
    expect(mergeGate(wp({ ci: 'pending' })).ok).toBe(false);
    expect(mergeGate(wp({ ci: 'failure' })).ok).toBe(false);
    expect(mergeGate(wp({ reviewer: 'pending' })).ok).toBe(false);
    expect(mergeGate(wp({ reviewer: 'changes_requested' })).ok).toBe(false);
    expect(mergeGate(wp({ draft: true })).ok).toBe(false);
    expect(mergeGate(wp({ stage: 'merged' })).ok).toBe(false);
    expect(mergeGate(null).ok).toBe(false);
  });

  it('skips the reviewer gate when no reviewer bot is configured', () => {
    expect(mergeGate(wp({ reviewer: 'off' }))).toEqual({ ok: true, reasons: [] });
    expect(mergeGate(wp({ reviewer: 'off', reviewer_at_head: false })).ok).toBe(true);
    expect(mergeGate(wp({ reviewer: 'off', ci: 'failure' })).reasons).toEqual(['CI is failure']);
    expect(mergeGate(wp({ reviewer: 'none' })).ok).toBe(false);
  });

  it('explains every reason the lever is locked', () => {
    expect(mergeGate(wp({ ci: 'pending', reviewer: 'none' })).reasons).toEqual(['CI is pending', 'Review bot is none']);
  });

  it('requires the typed PR number to match exactly', () => {
    expect(typedConfirmationMatches(858, '858')).toBe(true);
    expect(typedConfirmationMatches(858, ' 858 ')).toBe(true);
    expect(typedConfirmationMatches(858, '85')).toBe(false);
    expect(typedConfirmationMatches(858, '#858')).toBe(false);
    expect(canMerge(wp({}), '858')).toBe(true);
    expect(canMerge(wp({}), '')).toBe(false);
    expect(canMerge(wp({ reviewer: 'pending' }), '858')).toBe(false);
  });

  it('locks already-merged phases and stages', () => {
    for (const phase of ['deploy', 'shipped'] as const) {
      const g = mergeGate(wp({ phase }));
      expect(g.ok).toBe(false);
      expect(g.reasons).toContain('Already merged');
    }
    expect(mergeGate(wp({ stage: 'deployed' })).reasons).toContain('Already merged');
  });

  it('flags stale review bot approval, conflicts, drafts and non-PR items', () => {
    expect(mergeGate(wp({ reviewer_at_head: false })).reasons).toEqual(['Review bot approved an older commit']);
    expect(mergeGate(wp({ mergeable: 'CONFLICTING' })).reasons).toEqual(['Merge conflicts']);
    expect(mergeGate(wp({ draft: true })).reasons).toEqual(['PR is a draft']);
    expect(mergeGate(wp({ kind: 'issue' })).reasons).toEqual(['Not a pull request']);
    expect(mergeGate(wp({ reviewer: 'changes_requested' })).reasons).toEqual(['Review bot is changes requested']);
  });

  it('typedConfirmationMatches rejects a missing PR', () => {
    expect(typedConfirmationMatches(null, '')).toBe(false);
    expect(typedConfirmationMatches(undefined, 'undefined')).toBe(false);
  });
});

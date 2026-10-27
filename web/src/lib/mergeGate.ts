import type { Workpiece } from '../types';
import { REVIEWER_NAME } from './brand';

export interface MergeGate {
  ok: boolean;
  reasons: string[];
}

type GateInput = Pick<Workpiece, 'ci' | 'reviewer' | 'draft' | 'stage'> & Partial<Pick<Workpiece, 'reviewer_at_head' | 'mergeable' | 'kind' | 'pr' | 'phase'>>;

/**
 * The merge lever unlocks only when CI is green, the review bot approved the current head (skipped when
 * no reviewer is configured: `reviewer` is `off`), GitHub sees no conflict, and the PR is an open non-draft PR.
 */
export function mergeGate(w: GateInput | null | undefined): MergeGate {
  if (!w) return { ok: false, reasons: ['No PR selected'] };
  const reasons: string[] = [];
  if (w.kind && w.kind !== 'pr') reasons.push('Not a pull request');
  if (w.stage === 'merged' || w.stage === 'deployed' || (w.phase && ['deploy', 'shipped'].includes(w.phase))) reasons.push('Already merged');
  if (w.ci !== 'success') reasons.push(`CI is ${w.ci}`);
  if (w.reviewer === 'off') {
    /* no reviewer bot: its gate is skipped */
  } else if (w.reviewer !== 'approved') reasons.push(`${REVIEWER_NAME} is ${w.reviewer.replace('_', ' ')}`);
  else if (w.reviewer_at_head === false) reasons.push(`${REVIEWER_NAME} approved an older commit`);
  if (w.mergeable === 'CONFLICTING') reasons.push('Merge conflicts');
  if (w.draft) reasons.push('PR is a draft');
  return { ok: reasons.length === 0, reasons };
}

/** The typed confirmation must equal the PR number exactly (surrounding whitespace ignored). */
export function typedConfirmationMatches(pr: number | null | undefined, typed: string): boolean {
  return pr != null && typed.trim() === String(pr);
}

export function canMerge(w: GateInput | null | undefined, typed: string): boolean {
  return !!w && mergeGate(w).ok && typedConfirmationMatches(w.pr, typed);
}

import type { Phase } from '../types';
import { PHASES } from '../lib/domains';

/** Seconds a pod spends crossing one district on its lane. */
export const SECONDS_PER_DISTRICT = 1.5;

/** Districts a pod passes through on its way from one phase to another, ending at the destination. Empty when there is no lane route. */
export function journeyStops(from: Phase, to: Phase): Phase[] {
  const a = PHASES.indexOf(from as (typeof PHASES)[number]);
  const b = PHASES.indexOf(to as (typeof PHASES)[number]);
  if (a < 0 || b < 0 || a === b) return [];
  const step = b > a ? 1 : -1;
  const out: Phase[] = [];
  for (let i = a + step; i !== b + step; i += step) out.push(PHASES[i]);
  return out;
}

export const isBackwards = (from: Phase, to: Phase) => PHASES.indexOf(to as (typeof PHASES)[number]) < PHASES.indexOf(from as (typeof PHASES)[number]);

export function journeySeconds(districts: number, reduced: boolean): number {
  if (districts <= 0) return 0;
  return reduced ? 0.3 : SECONDS_PER_DISTRICT * districts;
}

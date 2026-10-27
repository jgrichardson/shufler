import type { BallWho, CiState, ReviewerState, NoteState, Station } from '../types';

export const STATE_COLOR: Record<NoteState, string> = {
  working: '#2ecc71',
  me: '#e74c3c',
  waiting: '#f39c12',
  staging: '#3498db',
  merged: '#9b59b6',
  done: '#8a8f98',
};

export const STALLED_COLOR = '#d35400';
export const IDLE_COLOR = '#8a8f98';

/** Accent per district (CONTRACT "Phases v4"); setPipelineStages overwrites it from the snapshot. */
export const PHASE_ACCENT: Record<string, string> = {
  brainstorm: '#9aa4b2',
  plan: '#7c8cf8',
  build: '#f2b544',
  qa: '#45c7e0',
  review: '#f28c38',
  merge: '#a56cf0',
  deploy: '#3dd68c',
  shipped: '#f5c542',
};

/** Pod lamp colour = who holds the ball (CONTRACT v3). */
export const BALL_COLOR: Record<BallWho, string> = {
  owner: '#e74c3c',
  claude: '#2ecc71',
  reviewer: '#f39c12',
  ci: '#f39c12',
  person: '#f39c12',
  testers: '#3498db',
  closeout: '#9b59b6',
  none: '#8a8f98',
};

export function stateColor(state: string | null | undefined): string {
  if (state && state in STATE_COLOR) return STATE_COLOR[state as NoteState];
  return IDLE_COLOR;
}

/** Colour a station shows: its note state, overridden by stalled. */
export function stationColor(st: Pick<Station, 'note' | 'activity'>): string {
  if (st.activity.status === 'stalled') return STALLED_COLOR;
  return stateColor(st.note?.state);
}

/** Which states earn a light beam into the sky. working gets a rooftop beacon instead. */
export function hasBeam(state: string | null | undefined): boolean {
  return state === 'me' || state === 'waiting' || state === 'staging' || state === 'merged';
}

export const CI_COLOR: Record<CiState, string> = {
  success: '#2ecc71',
  failure: '#e74c3c',
  pending: '#f39c12',
  none: '#8a8f98',
};

export const REVIEWER_COLOR: Record<ReviewerState, string> = {
  approved: '#2ecc71',
  changes_requested: '#e74c3c',
  pending: '#f39c12',
  none: '#8a8f98',
  off: '#8a8f98',
};


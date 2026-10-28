import { useWorld } from '../store';
import type { ActionName, Capabilities, TerminalCaps } from '../types';
import { terminalName } from './terminalName';

/*
 * Terminal levers the active terminal cannot pull. The daemon refuses them too (CONTRACT "Terminal
 * capabilities"); the app greys the button out first and says why in its tooltip, so nobody presses
 * a lever only to read an error.
 */

export type TerminalFlag = keyof TerminalCaps;

/** The flags each terminal lever needs; mirrors the daemon's actions.TERMINAL_NEEDS. */
export const TERMINAL_NEEDS: Partial<Record<ActionName, TerminalFlag[]>> = {
  focus: ['can_focus'],
  open_tab: ['can_open'],
  dispatch: ['can_send', 'can_read_screen'],
  answer_question: ['can_send', 'can_read_screen'],
  postmerge: ['can_send', 'can_read_screen'],
  new_item: ['can_send', 'can_read_screen'],
  run_skill: ['can_send', 'can_read_screen'],
  library_send: ['can_send', 'can_read_screen'],
};

const WHAT: Record<TerminalFlag, string> = {
  can_send: 'type into sessions',
  can_read_screen: "read a session's screen",
  can_focus: 'bring a session forward',
  can_open: 'open a new tab',
  has_groups: 'group rows',
  can_follow: 'tell which session you are in',
};

/** Is this flag on? An absent flag (older daemon) counts as on. */
export function termCap(caps: Capabilities | null | undefined, flag: TerminalFlag): boolean {
  return caps?.terminal_caps?.[flag] !== false;
}

/** Why a flag is off, as a short tooltip; null when it is on. */
export function flagOffReason(caps: Capabilities | null | undefined, flag: TerminalFlag): string | null {
  if (termCap(caps, flag)) return null;
  if ((caps?.terminal ?? '').toLowerCase() === 'none')
    return `Off: no supported terminal is connected, so Shufler can't ${WHAT[flag]}. Pick one with shufler setup.`;
  return `Off: Shufler can't ${WHAT[flag]} in ${terminalName(caps?.terminal)}.`;
}

/** Why the active terminal cannot run this action, as a short tooltip; null when it can (or needs no terminal). */
export function leverOffReason(action: ActionName, caps: Capabilities | null | undefined): string | null {
  for (const f of TERMINAL_NEEDS[action] ?? []) {
    const why = flagOffReason(caps, f);
    if (why) return why;
  }
  return null;
}

/** leverOffReason against the current snapshot, outside React. */
export const leverOffNow = (action: ActionName) => leverOffReason(action, useWorld.getState().snapshot?.capabilities);

/** leverOffReason that re-renders when the snapshot's capabilities change. */
export const useLeverOff = (action: ActionName) => useWorld((s) => leverOffReason(action, s.snapshot?.capabilities));

/** flagOffReason that re-renders when the snapshot's capabilities change. */
export const useFlagOff = (flag: TerminalFlag) => useWorld((s) => flagOffReason(s.snapshot?.capabilities, flag));

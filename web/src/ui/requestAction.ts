import { dispatch, toast, useWorld } from '../store';
import { previewAction, runAction } from '../api/actions';
import type { ActionName, ActionParams } from '../types';
import { pushCommandHistory, type CommandValues } from './commands';
import { SENDING_ACTIONS, sendOutcome } from './sendOutcome';
import { usePulses } from '../scene/pulses';
import { refreshLibrary } from './library/store';
import { REVIEWER_NAME } from '../lib/brand';
import { currentTerminalName, focusLabel } from '../lib/terminalName';

export const ACTION_LABEL: Record<ActionName, string> = {
  focus: focusLabel('terminal'),
  dispatch: 'Send to session',
  answer_question: 'Answer the question',
  postmerge: 'Ask for the close-out message',
  new_item: 'Start a new work item',
  reviewer_retrigger: `Re-request ${REVIEWER_NAME.toLowerCase()} review`,
  ci_rerun: 'Re-run failed CI',
  pr_ready: 'Mark PR ready for review',
  pr_draft: 'Convert PR to draft',
  merge: 'Merge PR (squash)',
  open_pr: 'Open PR on GitHub',
  open_preview: 'Open preview app',
  run_command: 'Run command',
  board_stage: 'Move board stage',
  board_note: 'Add board note',
  issue_set: 'Update issue record',
  ack: 'Acknowledge',
  run_skill: 'Run skill',
  open_tab: 'Open a terminal tab',
  set_domain: 'Move to domain',
  library_send: 'Send library context',
};

/** ACTION_LABEL with the terminal levers named after the active terminal ("Focus in iTerm2"). */
export function actionLabel(action: ActionName, terminal = currentTerminalName()): string {
  if (action === 'focus') return focusLabel(terminal);
  if (action === 'open_tab') return `Open a ${terminal} tab`;
  return ACTION_LABEL[action];
}

/** Levers that never need a confirm panel (CONTRACT round 2 confirm levels). */
const NO_CONFIRM = new Set<ActionName>(['focus', 'open_pr', 'open_preview', 'ack']);

export async function executeAction(action: ActionName, params: ActionParams, label: string) {
  try {
    const result = await runAction(action, params);
    if (action === 'library_send' && result.ok) void refreshLibrary();
    if (action === 'run_command' && typeof params.command === 'string') {
      const values = (params.values ?? {}) as CommandValues;
      if (result.ok) pushCommandHistory(params.command, values);
      dispatch({ type: 'command_result', id: params.command, result });
    }
    const o = sendOutcome(action, params, result, label, currentTerminalName());
    if (result.ok && result.landed !== false && SENDING_ACTIONS.has(action) && typeof params.station_id === 'string') usePulses.getState().fire(params.station_id);
    toast(o.ok, o.title, o.output, o.cta);
    return result;
  } catch (e) {
    toast(false, `${label} failed`, (e as Error).message);
    return null;
  }
}

/**
 * Every lever goes through here. Tap and typed levels open the single ConfirmDialog, which shows
 * the daemon's exact command; "none" levels (focus, open, ack) run at once and the toast carries
 * the command so nothing runs unseen.
 */
export function requestAction(action: ActionName, params: ActionParams, label?: string) {
  const name = label ?? actionLabel(action);
  if (NO_CONFIRM.has(action)) {
    if ((action === 'open_pr' || action === 'open_preview') && typeof params.url === 'string') window.open(params.url, '_blank', 'noopener');
    void (async () => {
      let command = '';
      try {
        const p = await previewAction(action, params);
        if (p.error) {
          toast(false, `${name} refused`, p.error);
          return;
        }
        command = p.command ?? p.url ?? '';
      } catch (e) {
        toast(false, `${name} failed`, (e as Error).message);
        return;
      }
      if (action === 'open_pr' || action === 'open_preview') {
        if (typeof params.url !== 'string' && command.startsWith('http')) window.open(command, '_blank', 'noopener');
        toast(true, name, command);
        if (!useWorld.getState().mock) void runAction(action, params);
        return;
      }
      const r = await executeAction(action, params, name);
      if (r?.ok && command && !r.output) toast(true, name, command);
    })();
    return;
  }
  dispatch({ type: 'request_action', pending: { action, params, label: name } });
}

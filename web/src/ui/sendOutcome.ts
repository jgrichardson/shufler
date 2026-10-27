import type { ActionName, ActionParams, ActionResult } from '../types';
import type { ToastCta } from '../store/reducer';
import { parseTableOutput } from './commands';
import { focusLabel, unsentText } from '../lib/terminalName';

/** Actions that type into a Claude session; the daemon reads the screen before and after. */
export const SENDING_ACTIONS = new Set<ActionName>(['dispatch', 'answer_question', 'postmerge', 'new_item', 'run_skill', 'library_send']);

/** The refusal worded for an unknown terminal; the daemon's own error names the active one. */
export const UNSENT_TEXT = unsentText('terminal');

export interface Outcome {
  ok: boolean;
  title: string;
  output: string;
  cta?: ToastCta;
}

const firstLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) ?? '';

export function isUnsentRefusal(r: ActionResult): boolean {
  return !r.ok && (r.draft !== undefined || /unsent text/i.test(r.error ?? ''));
}

/**
 * Turns a sending action's result into what the toast says: landed with its echo, or the unsent-text refusal.
 * `terminal` is the active terminal's display name (lib/terminalName), used in the refusal and the Focus button.
 */
export function sendOutcome(action: ActionName, params: ActionParams, r: ActionResult, label: string, terminal = 'terminal'): Outcome {
  const station = typeof params.station_id === 'string' ? params.station_id : null;
  const focus = focusLabel(terminal);
  if (isUnsentRefusal(r)) {
    const draft = r.draft?.trim();
    return {
      ok: false,
      title: 'Not sent: that session has unsent text',
      output: `${unsentText(terminal)}${draft ? `\n\nIn its input box now:\n${draft}` : ''}`,
      cta: station ? { label: focus, action: 'focus', params: { station_id: station } } : undefined,
    };
  }
  if (!r.ok) return { ok: false, title: `${label} failed`, output: `${r.error ?? ''}\n${r.output}`.trim() };
  if (action === 'run_command') {
    // the drawer shows a table; the toast only says how much came back, or the output itself when it is short text
    const t = parseTableOutput(r.output);
    if (t) return { ok: true, title: label, output: `${t.rows.length} row${t.rows.length === 1 ? '' : 's'}, shown in the command drawer` };
    return { ok: true, title: label, output: r.output };
  }
  if (!SENDING_ACTIONS.has(action)) return { ok: true, title: label, output: r.output };
  if (r.landed === true) {
    const echo = firstLine(r.echo ?? '') || firstLine(String(params.text ?? ''));
    return { ok: true, title: `${label} · landed`, output: `landed: ${echo}` };
  }
  if (r.landed === false)
    return {
      ok: false,
      title: `${label} · sent, not seen yet`,
      output: `The prompt was typed but the screen didn't show it yet. Check the session.\n\n${r.output}`.trim(),
      cta: station ? { label: focus, action: 'focus', params: { station_id: station } } : undefined,
    };
  return { ok: true, title: label, output: r.output };
}

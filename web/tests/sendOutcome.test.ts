import { describe, expect, it } from 'vitest';
import { sendOutcome, UNSENT_TEXT } from '../src/ui/sendOutcome';

describe('sendOutcome', () => {
  it('shows landed with the first echo line', () => {
    const o = sendOutcome('dispatch', { station_id: 's1', text: 'Status?' }, { ok: true, output: 'x', error: null, landed: true, echo: '\n> Status? One paragraph\n more' }, 'Send to session');
    expect(o).toMatchObject({ ok: true, title: 'Send to session · landed', output: 'landed: > Status? One paragraph' });
  });

  it('falls back to the sent text when the echo is empty', () => {
    const o = sendOutcome('run_skill', { station_id: 's1', text: '/pr-pre-review 12' }, { ok: true, output: '', error: null, landed: true }, 'Run skill');
    expect(o.output).toBe('landed: /pr-pre-review 12');
  });

  it('turns the unsent-text refusal into a Focus-in-<terminal> toast with the draft', () => {
    const o = sendOutcome('dispatch', { station_id: 's1', text: 'hi' }, { ok: false, output: '', error: UNSENT_TEXT, draft: 'half typed' }, 'Send to session', 'cmux');
    expect(o.ok).toBe(false);
    expect(o.title).toMatch(/unsent text/);
    expect(o.output).toContain('half typed');
    expect(o.output).toContain('finish or clear it in cmux first');
    expect(o.cta).toEqual({ label: 'Focus in cmux', action: 'focus', params: { station_id: 's1' } });
  });

  it('names iTerm2, or plain "terminal" when the snapshot does not say', () => {
    const r = { ok: false, output: '', error: UNSENT_TEXT };
    const it2 = sendOutcome('dispatch', { station_id: 's1' }, r, 'Send', 'iTerm2');
    expect(it2.output).toBe('that session has unsent text in its input; finish or clear it in iTerm2 first');
    expect(it2.cta?.label).toBe('Focus in iTerm2');
    const plain = sendOutcome('dispatch', { station_id: 's1' }, r, 'Send');
    expect(plain.output).toBe(UNSENT_TEXT);
    expect(plain.cta?.label).toBe('Focus in terminal');
  });

  it('recognises the refusal from the error text alone', () => {
    const o = sendOutcome('answer_question', { station_id: 's2' }, { ok: false, output: '', error: UNSENT_TEXT }, 'Answer');
    expect(o.cta?.action).toBe('focus');
  });

  it('flags a send that did not show on screen', () => {
    const o = sendOutcome('dispatch', { station_id: 's1', text: 'go' }, { ok: true, output: 'screen', error: null, landed: false }, 'Send to session');
    expect(o.ok).toBe(false);
    expect(o.cta?.label).toBe('Focus in terminal');
  });

  it('leaves non-sending actions alone', () => {
    const o = sendOutcome('merge', { pr: 1 }, { ok: true, output: 'merged', error: null }, 'Merge');
    expect(o).toEqual({ ok: true, title: 'Merge', output: 'merged' });
  });
  it('keeps a table command toast short: the drawer shows the rows', () => {
    const o = sendOutcome('run_command', { command: 'report', values: {} }, { ok: true, output: '{"columns":["id"],"rows":[[1],[2]]}', error: null }, 'Report');
    expect(o).toMatchObject({ ok: true, title: 'Report', output: '2 rows, shown in the command drawer' });
  });
  it('shows a text command output in the toast', () => {
    const o = sendOutcome('run_command', { command: 'tests', values: {} }, { ok: true, output: '12 passed', error: null }, 'Run tests');
    expect(o).toEqual({ ok: true, title: 'Run tests', output: '12 passed' });
  });
});

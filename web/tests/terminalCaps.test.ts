import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/actions', () => ({
  previewAction: vi.fn(async () => ({ command: 'x', warnings: [] })),
  runAction: vi.fn(async () => ({ ok: true, output: '' })),
}));

import { flagOffReason, leverOffReason, termCap, TERMINAL_NEEDS } from '../src/lib/terminalCaps';
import { executeAction, requestAction } from '../src/ui/requestAction';
import { mockPreview } from '../src/mock/actions';
import { makeMockSnapshot, mockTerminal } from '../src/mock/snapshot';
import { normalizeSnapshot } from '../src/lib/derive';
import { initialState, reduce } from '../src/store/reducer';
import { useWorld } from '../src/store';
import { previewAction, runAction } from '../src/api/actions';
import type { Capabilities } from '../src/types';

const NOW = 1_800_000_000_000;
const ALL_OFF = { can_send: false, can_focus: false, can_read_screen: false, can_open: false, has_groups: false, can_follow: false };
const NONE: Capabilities = { terminal: 'none', terminal_caps: ALL_OFF };

function load(search: string) {
  const snapshot = normalizeSnapshot(makeMockSnapshot(NOW, mockTerminal(search)), { now: NOW / 1000 });
  useWorld.setState(reduce(initialState, { type: 'snapshot', snapshot, at: NOW }));
}

describe('terminal capabilities', () => {
  it('counts an absent flag (older daemon) as on', () => {
    expect(termCap({}, 'can_send')).toBe(true);
    expect(termCap({ terminal_caps: {} }, 'can_focus')).toBe(true);
    expect(leverOffReason('dispatch', {})).toBeNull();
    expect(leverOffReason('dispatch', null)).toBeNull();
  });

  it('greys out every terminal lever without a terminal, and says how to get one', () => {
    for (const action of Object.keys(TERMINAL_NEEDS) as (keyof typeof TERMINAL_NEEDS)[]) {
      expect(leverOffReason(action, NONE)).toMatch(/no supported terminal .* shufler setup/);
    }
    expect(leverOffReason('dispatch', NONE)).toContain("can't type into sessions");
    expect(leverOffReason('focus', NONE)).toContain("can't bring a session forward");
    expect(flagOffReason(NONE, 'can_follow')).toContain('which session you are in');
  });

  it('leaves levers that need no terminal alone', () => {
    for (const action of ['merge', 'open_pr', 'ci_rerun', 'run_command', 'ack', 'set_domain'] as const) expect(leverOffReason(action, NONE)).toBeNull();
  });

  it('names the terminal when one flag is off', () => {
    const caps: Capabilities = { terminal: 'iterm2', terminal_caps: { can_focus: false } };
    expect(leverOffReason('focus', caps)).toBe("Off: Shufler can't bring a session forward in iTerm2.");
    expect(leverOffReason('dispatch', caps)).toBeNull();
  });

  it('mirrors the daemon: sending needs can_send and can_read_screen', () => {
    for (const a of ['dispatch', 'answer_question', 'postmerge', 'new_item', 'run_skill', 'library_send'] as const) expect(TERMINAL_NEEDS[a]).toEqual(['can_send', 'can_read_screen']);
    expect(leverOffReason('run_skill', { terminal_caps: { can_read_screen: false } })).not.toBeNull();
  });
});

describe('mock terminal', () => {
  it('reads ?terminal=none and ?caps_off= from the URL', () => {
    expect(mockTerminal('?mock=1')).toEqual({ kind: 'cmux', caps: { ...ALL_OFF, can_send: true, can_focus: true, can_read_screen: true, can_open: true, has_groups: true, can_follow: true } });
    expect(mockTerminal('?mock=1&terminal=none')).toEqual({ kind: 'none', caps: ALL_OFF });
    expect(mockTerminal('?caps_off=can_send').caps.can_send).toBe(false);
    expect(mockTerminal('?caps_off=can_send').caps.can_focus).toBe(true);
  });

  it('refuses a lever in the mock preview like the daemon does', () => {
    load('?terminal=none');
    expect(mockPreview('focus', { station_id: 'ws-pf' }).error).toMatch(/no supported terminal/);
    load('');
    expect(mockPreview('focus', { station_id: 'ws-pf' }).error).toBeNull();
  });
});

describe('requestAction guard', () => {
  beforeEach(() => {
    vi.mocked(previewAction).mockClear();
    vi.mocked(runAction).mockClear();
  });

  it('toasts the reason and calls nothing for a lever that is off (shortcut, palette, toast button)', async () => {
    load('?terminal=none');
    requestAction('focus', { station_id: 'ws-pf' });
    requestAction('dispatch', { station_id: 'ws-pf', text: 'hi' });
    expect(await executeAction('library_send', { station_id: 'ws-pf', item_ids: 'a' }, 'Send')).toBeNull();
    await Promise.resolve();
    const s = useWorld.getState();
    expect(s.pending).toBeNull(); // no confirm panel opened
    expect(previewAction).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
    const titles = s.toasts.map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining(['Focus in terminal is off', 'Send to session is off', 'Send is off']));
    expect(s.toasts.every((t) => !t.ok && /no supported terminal/.test(t.output))).toBe(true);
  });

  it('still opens the confirm panel when the terminal can send', () => {
    load('');
    requestAction('dispatch', { station_id: 'ws-pf', text: 'hi' });
    expect(useWorld.getState().pending?.action).toBe('dispatch');
  });
});

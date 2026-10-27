import { useWorld } from '../store';

const DISPLAY: Record<string, string> = { cmux: 'cmux', iterm2: 'iTerm2', tmux: 'tmux' };

/** The display name for a terminal kind (snapshot `capabilities.terminal`); "terminal" when unknown or absent. */
export function terminalName(kind: string | null | undefined): string {
  return (kind && DISPLAY[kind.toLowerCase()]) || 'terminal';
}

/** The active terminal's display name, outside React. */
export const currentTerminalName = () => terminalName(useWorld.getState().snapshot?.capabilities?.terminal);

/** The active terminal's display name, re-rendering when the snapshot changes it. */
export const useTerminalName = () => useWorld((s) => terminalName(s.snapshot?.capabilities?.terminal));

/** "Focus in cmux", "Focus in iTerm2", or "Focus in terminal". */
export const focusLabel = (name: string) => `Focus in ${name}`;

/** "New cmux tab here", or "New terminal tab here" when the terminal is unknown. */
export const newTabLabel = (name: string) => `New ${name} tab here`;

/** The daemon's unsent-text refusal, worded for the active terminal. */
export const unsentText = (name: string) =>
  `that session has unsent text in its input; finish or clear it in ${name} first`;

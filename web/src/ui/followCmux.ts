import { useEffect } from 'react';
import { create } from 'zustand';
import { dispatch, useWorld } from '../store';
import { usePrefs, type TerminalFollow } from './prefs';

interface FollowState {
  /** Until when terminal switches are ignored because the user just picked something here. */
  pausedUntil: number;
  /** The mode the status-bar switch restores when turned back on. */
  lastOn: Exclude<TerminalFollow, 'off'>;
  /** Status-bar switch: off, or back to the last mode that was on. */
  toggle: () => void;
}

export const useFollow = create<FollowState>()((set, get) => ({
  pausedUntil: 0,
  lastOn: usePrefs.getState().terminalFollow === 'mark' ? 'mark' : 'select',
  toggle: () => {
    const mode = usePrefs.getState().terminalFollow;
    if (mode !== 'off') set({ lastOn: mode });
    usePrefs.getState().set({ terminalFollow: mode === 'off' ? get().lastOn : 'off' });
    set({ pausedUntil: 0 });
  },
}));

/** Decides whether a cmux focus change should move the view. Pure, for tests. */
export function shouldFollow(opts: { on: boolean; now: number; pausedUntil: number; focused: string | null | undefined; previous: string | null | undefined; selectedStation: string | null }): boolean {
  if (!opts.on || !opts.focused || opts.focused === opts.previous) return false;
  if (opts.now < opts.pausedUntil) return false;
  return opts.selectedStation !== opts.focused;
}

/**
 * Terminal sync. In 'select' mode, when the terminal's focus moves to another session it is selected
 * here, unless the user picked something in the app within the pause. In 'mark' mode nothing is
 * selected; the scene and row headers just mark snapshot.focused_station_id.
 */
export function useFollowCmux() {
  useEffect(() => {
    let following = false;
    let lastFocus: string | null | undefined = useWorld.getState().snapshot?.focused_station_id;
    const unsub = useWorld.subscribe((s, prev) => {
      if (s.selection !== prev.selection && !following) useFollow.setState({ pausedUntil: Date.now() + usePrefs.getState().followPauseSec * 1000 });
      const focused = s.snapshot?.focused_station_id;
      if (focused === lastFocus) return;
      const previous = lastFocus;
      lastFocus = focused;
      const f = useFollow.getState();
      const sel = s.selection?.kind === 'station' ? s.selection.id : null;
      if (!shouldFollow({ on: usePrefs.getState().terminalFollow === 'select', now: Date.now(), pausedUntil: f.pausedUntil, focused, previous, selectedStation: sel })) return;
      if (!s.snapshot?.stations.some((x) => x.id === focused)) return;
      following = true;
      dispatch({ type: 'select', selection: { kind: 'station', id: focused! } });
      following = false;
    });
    return unsub;
  }, []);
}

/** The session the user's terminal is on, for the terminal marker; null when terminal sync is off. */
export function useTerminalStation(): string | null {
  const on = usePrefs((s) => s.terminalFollow !== 'off');
  const focused = useWorld((s) => s.snapshot?.focused_station_id ?? null);
  return on ? focused : null;
}

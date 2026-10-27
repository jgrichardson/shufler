import { create } from 'zustand';
import { dispatch } from '../store';
import { getStored, storageKey } from '../lib/storage';

/*
 * Viewer preferences that change how the world reacts, kept in this browser. Each is a separate
 * choice because people work differently: some want the app to chase their terminal, some want the
 * whole world in view while they move around, some want the camera to fly to what they pick.
 */

/** What the app does when the terminal switches to another session. */
export type TerminalFollow = 'select' | 'mark' | 'off';

/** Panels and labels: dark, light, or follow the operating system. */
export type Theme = 'dark' | 'light' | 'system';

export interface Prefs {
  theme: Theme;
  /** select: select it here (greys out the rest if selectDims); mark: only mark it, the view stays as is; off: ignore the terminal. */
  terminalFollow: TerminalFollow;
  /** After the user picks something in the app, terminal switches are ignored for this many seconds. */
  followPauseSec: number;
  /** Selecting a row, column or item greys out everything else. Off: the selection is outlined and the rest stays lit. */
  selectDims: boolean;
  /** The camera flies to whatever is selected. Off: the view stays put (Enter still flies). */
  flyOnSelect: boolean;
  /** Owner arcs for items that need you: always drawn, or only for what is hovered or selected. */
  redArcsAlways: boolean;
  /** Context library: send owed pinned items to their sessions without the confirm panel. Off by default. */
  autoSendPinned: boolean;
}

export const DEFAULT_PREFS: Prefs = { theme: 'dark', terminalFollow: 'select', followPauseSec: 20, selectDims: true, flyOnSelect: false, redArcsAlways: false, autoSendPinned: false };
export const FOLLOW_PAUSE_CHOICES = [0, 10, 20, 60] as const;

const KEY = storageKey('prefs');

/** Reads stored prefs, dropping anything malformed so a bad value can't break the app. */
export function parsePrefs(raw: unknown): Prefs {
  const out: Prefs = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.theme === 'dark' || r.theme === 'light' || r.theme === 'system') out.theme = r.theme;
  if (r.terminalFollow === 'select' || r.terminalFollow === 'mark' || r.terminalFollow === 'off') out.terminalFollow = r.terminalFollow;
  if (typeof r.followPauseSec === 'number' && r.followPauseSec >= 0 && r.followPauseSec <= 600) out.followPauseSec = r.followPauseSec;
  if (typeof r.selectDims === 'boolean') out.selectDims = r.selectDims;
  if (typeof r.flyOnSelect === 'boolean') out.flyOnSelect = r.flyOnSelect;
  if (typeof r.redArcsAlways === 'boolean') out.redArcsAlways = r.redArcsAlways;
  if (typeof r.autoSendPinned === 'boolean') out.autoSendPinned = r.autoSendPinned;
  return out;
}

function load(): Prefs {
  try {
    const raw = getStored(KEY);
    return parsePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const usePrefs = create<Prefs & { set: (patch: Partial<Prefs>) => void }>()((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { set: _omit, ...prefs } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable: the choice lasts for this tab */
    }
  },
}));

// the camera pref lives in the reducer so selection and flying stay one pure step
dispatch({ type: 'prefs', flyOnSelect: usePrefs.getState().flyOnSelect });
usePrefs.subscribe((s, prev) => {
  if (s.flyOnSelect !== prev.flyOnSelect) dispatch({ type: 'prefs', flyOnSelect: s.flyOnSelect });
});

import type { ActionName, ActionParams, ActionResult, Phase, Snapshot } from '../types';

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'mock';
export type Selection =
  | { kind: 'station'; id: string }
  | { kind: 'item'; id: string }
  | { kind: 'domain'; id: string }
  | { kind: 'gate'; phase: Phase }
  | { kind: 'pile'; id: string }
  | { kind: 'library' }
  | null;
/** Pile selection id for the whole Warehouse. */
export const PILE_ALL = 'all';
/** Round 11: pile selection id for the Shipping Dock, i.e. every shipped PR still owing a close-out. */
export const PILE_DOCK = 'dock';
export type Tab = 'overview' | 'conversation' | 'actions' | 'data' | 'fleet';
export type Preset = 'overview' | 'needs' | 'pipeline' | 'domain' | 'shipped';

export type Hover =
  | { kind: 'station'; id: string; x: number; y: number }
  | { kind: 'item'; id: string; x: number; y: number }
  | null;

export interface ToastCta {
  label: string;
  action: ActionName;
  params: ActionParams;
}

export interface Toast {
  id: number;
  ok: boolean;
  title: string;
  output: string;
  cta?: ToastCta;
}

export interface PendingAction {
  action: ActionName;
  params: ActionParams;
  label: string;
}

export interface WorldState {
  snapshot: Snapshot | null;
  lastMessageAt: number | null;
  conn: ConnStatus;
  wsFailures: number;
  mock: boolean;
  selection: Selection;
  tab: Tab;
  hover: Hover;
  /** Increments when the camera should fly to the selection. Selecting alone never moves the camera; only explicit go-to actions pass fly: true. */
  flySeq: number;
  /** Viewer pref: every new selection also flies the camera (an explicit fly: false still holds it). */
  flyOnSelect: boolean;
  preset: Preset;
  /** Preset before the current one, so P can toggle Pipeline back. */
  prevPreset: Preset;
  presetSeq: number;
  /** Needs-me preset: everything not owed by you dims to 30%. */
  dim: boolean;
  pending: PendingAction | null;
  toasts: Toast[];
  /** The command drawer: open or not, and the command it shows (null: the first global command). */
  commandDrawer: { open: boolean; id: string | null };
  /** The last command run from the drawer or an inline form, with its result. */
  commandResult: { id: string; result: ActionResult } | null;
  helpOpen: boolean;
}

export type WorldEvent =
  | { type: 'snapshot'; snapshot: Snapshot; at: number }
  | { type: 'conn'; status: ConnStatus }
  | { type: 'ws_failed' }
  | { type: 'ws_opened' }
  | { type: 'enter_mock' }
  | { type: 'select'; selection: Selection; fly?: boolean; tab?: Tab }
  | { type: 'tab'; tab: Tab }
  | { type: 'hover'; hover: Hover }
  | { type: 'preset'; preset: Preset }
  | { type: 'reset_view' }
  | { type: 'request_action'; pending: PendingAction }
  | { type: 'cancel_action' }
  | { type: 'toast'; toast: Omit<Toast, 'id'>; id: number }
  | { type: 'dismiss_toast'; id: number }
  | { type: 'command_drawer'; open: boolean; id?: string }
  | { type: 'command_result'; id: string; result: ActionResult }
  | { type: 'help'; open: boolean }
  | { type: 'prefs'; flyOnSelect: boolean };

/** Failed connects before the loading screen says the daemon is unreachable. Demo data never replaces live data on its own; only ?mock=1 shows it. */
export const UNREACHABLE_AFTER_FAILURES = 3;
export const MAX_TOASTS = 4;

export const initialState: WorldState = {
  snapshot: null,
  lastMessageAt: null,
  conn: 'connecting',
  wsFailures: 0,
  mock: false,
  selection: null,
  tab: 'overview',
  hover: null,
  flySeq: 0,
  flyOnSelect: false,
  preset: 'overview',
  prevPreset: 'overview',
  presetSeq: 0,
  dim: false,
  pending: null,
  toasts: [],
  commandDrawer: { open: false, id: null },
  commandResult: null,
  helpOpen: false,
};

export function selectionStillExists(sel: Selection, snap: Snapshot): Selection {
  if (!sel) return null;
  switch (sel.kind) {
    case 'station':
      return snap.stations.some((s) => s.id === sel.id) ? sel : null;
    case 'item':
      return snap.workpieces.some((w) => w.id === sel.id) ? sel : null;
    case 'domain':
      return snap.domains.some((d) => d.id === sel.id) || sel.id === 'command' ? sel : null;
    case 'pile':
      // the warehouse and the dock always exist; a domain pile goes when nothing of that domain shipped this week
      return sel.id === PILE_ALL || sel.id === PILE_DOCK || snap.shipped.some((s) => s.domain === sel.id) ? sel : null;
    default:
      return sel;
  }
}

const TABBED = new Set(['station', 'item', 'domain']);

export function sameSelection(a: Selection, b: Selection): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'gate') return a.phase === (b as { phase: Phase }).phase;
  if (a.kind === 'library') return true;
  return a.id === (b as { id: string }).id;
}

export function reduce(state: WorldState, ev: WorldEvent): WorldState {
  switch (ev.type) {
    case 'snapshot':
      return {
        ...state,
        snapshot: ev.snapshot,
        lastMessageAt: ev.at,
        selection: selectionStillExists(state.selection, ev.snapshot),
      };
    case 'conn':
      return { ...state, conn: state.mock && ev.status !== 'open' ? 'mock' : ev.status };
    case 'ws_opened':
      return { ...state, conn: 'open', wsFailures: 0, mock: false };
    case 'ws_failed': {
      const wsFailures = state.wsFailures + 1;
      return { ...state, wsFailures, conn: state.mock ? 'mock' : 'closed' };
    }
    case 'enter_mock':
      return { ...state, mock: true, conn: 'mock' };
    case 'select': {
      const changed = !sameSelection(state.selection, ev.selection);
      const tab = ev.tab ?? (changed || !ev.selection || !TABBED.has(ev.selection.kind) ? 'overview' : state.tab);
      return {
        ...state,
        selection: ev.selection,
        tab,
        dim: ev.selection ? state.dim : false,
        flySeq: ev.selection && (ev.fly === true || (ev.fly !== false && state.flyOnSelect && changed)) ? state.flySeq + 1 : state.flySeq,
      };
    }
    case 'tab':
      return { ...state, tab: ev.tab };
    case 'hover':
      return { ...state, hover: ev.hover };
    case 'preset':
      return {
        ...state,
        preset: ev.preset,
        prevPreset: ev.preset === state.preset ? state.prevPreset : state.preset,
        presetSeq: state.presetSeq + 1,
        dim: ev.preset === 'needs',
        selection: ev.preset === 'overview' || ev.preset === 'needs' || ev.preset === 'pipeline' || ev.preset === 'shipped' ? null : state.selection,
      };
    case 'reset_view':
      return { ...state, selection: null, dim: false, preset: 'overview', presetSeq: state.presetSeq + 1 };
    case 'request_action':
      return { ...state, pending: ev.pending };
    case 'cancel_action':
      return { ...state, pending: null };
    case 'toast':
      return { ...state, toasts: [...state.toasts, { ...ev.toast, id: ev.id }].slice(-MAX_TOASTS) };
    case 'dismiss_toast':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== ev.id) };
    case 'command_drawer':
      return { ...state, commandDrawer: { open: ev.open, id: ev.id ?? state.commandDrawer.id } };
    case 'command_result':
      return { ...state, commandResult: { id: ev.id, result: ev.result } };
    case 'help':
      return { ...state, helpOpen: ev.open };
    case 'prefs':
      return { ...state, flyOnSelect: ev.flyOnSelect };
    default:
      return state;
  }
}

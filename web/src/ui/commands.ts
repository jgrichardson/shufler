import { getStored, storageKey } from '../lib/storage';
import type { ActionParams, Capabilities, CommandDef, CommandInput, NoteState, Station } from '../types';

/** A command form's values, keyed by input name: text and choice inputs are strings, flags are booleans. */
export type CommandValues = Record<string, string | boolean>;

const NO_COMMANDS: CommandDef[] = [];
const NOTE_STATES: NoteState[] = ['working', 'me', 'waiting', 'staging', 'merged', 'done'];

/** The configured commands, dropping anything malformed. */
export function allCommands(caps: Capabilities | null | undefined): CommandDef[] {
  const list = caps?.commands;
  if (!Array.isArray(list)) return NO_COMMANDS;
  return list.filter((c) => c && typeof c.id === 'string' && c.id && (c.scope === 'global' || c.scope === 'station'));
}
export const globalCommands = (caps: Capabilities | null | undefined) => allCommands(caps).filter((c) => c.scope === 'global');
export const stationCommands = (caps: Capabilities | null | undefined) => allCommands(caps).filter((c) => c.scope === 'station');

const inputsOf = (c: Pick<CommandDef, 'inputs'>): CommandInput[] => (Array.isArray(c.inputs) ? c.inputs : []);

/** Every input fits on one line, so the command can render as an inline form instead of opening the drawer. */
export function isInline(c: Pick<CommandDef, 'inputs'>): boolean {
  return inputsOf(c).every((i) => !(i.type === 'text' && i.multiline));
}

/** A choice input that picks a session note state, so it can prefill from the station's note. */
const isNoteStateInput = (i: CommandInput) => i.name === 'state' && i.type === 'choice' && !!i.choices?.length && i.choices.every((c) => (NOTE_STATES as string[]).includes(c));

/**
 * Starting values for a command form: each input's default, else empty (flags off, choices their first option).
 * With a station, an input named `state` whose choices are note states takes the note's state and one named
 * `text` takes the note's text, so a "session note" command opens on what the session shows now.
 */
export function initialValues(c: Pick<CommandDef, 'inputs'>, station?: Pick<Station, 'note'> | null): CommandValues {
  const out: CommandValues = {};
  for (const i of inputsOf(c)) {
    if (i.type === 'flag') out[i.name] = i.default === 'true';
    else if (i.type === 'choice') out[i.name] = i.default && i.choices?.includes(i.default) ? i.default : (i.choices?.[0] ?? '');
    else out[i.name] = i.default ?? '';
    const note = station?.note;
    if (note && isNoteStateInput(i) && i.choices!.includes(note.state)) out[i.name] = note.state;
    if (note && i.name === 'text' && i.type === 'text') out[i.name] = i.max ? note.text.slice(0, i.max) : note.text;
  }
  return out;
}

/** Why the form cannot run yet, or null. Text inputs must be within `max` and non-empty unless optional or defaulted; a choice must be one of its options. */
export function validateValues(c: Pick<CommandDef, 'inputs'>, values: CommandValues): string | null {
  for (const i of inputsOf(c)) {
    const v = values[i.name];
    if (i.type === 'flag') continue;
    const s = typeof v === 'string' ? v.trim() : '';
    if (i.type === 'choice') {
      if (!i.choices?.includes(s)) return `Pick ${i.label.toLowerCase()}`;
      continue;
    }
    if (!s && !i.optional && !i.default) return `${i.label} is empty`;
    if (i.max && s.length > i.max) return `${i.label} is over ${i.max} characters`;
  }
  return null;
}

/** The `run_command` params for a form: text trimmed, only the command's own inputs, the station when scoped to one. */
export function commandParams(c: Pick<CommandDef, 'id' | 'scope' | 'inputs'>, values: CommandValues, stationId?: string | null): ActionParams {
  const clean: CommandValues = {};
  for (const i of inputsOf(c)) {
    const v = values[i.name];
    clean[i.name] = i.type === 'flag' ? v === true : typeof v === 'string' ? v.trim() : '';
  }
  return c.scope === 'station' && stationId ? { command: c.id, station_id: stationId, values: clean } : { command: c.id, values: clean };
}

// ---- per-command input history (the drawer's "Recent" list)

const HISTORY_MAX = 10;
const historyKey = (id: string) => storageKey(`commands.history.${id}`);

export function loadCommandHistory(id: string): CommandValues[] {
  try {
    const raw = getStored(historyKey(id));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v === 'object' && !Array.isArray(v)).slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

export function pushCommandHistory(id: string, values: CommandValues): CommandValues[] {
  const key = JSON.stringify(values);
  const next = [values, ...loadCommandHistory(id).filter((v) => JSON.stringify(v) !== key)].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(historyKey(id), JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('command-history'));
  return next;
}

/** One line for a history entry: its text values joined, flags by name. */
export function historyLabel(values: CommandValues): string {
  return Object.entries(values)
    .map(([k, v]) => (typeof v === 'boolean' ? (v ? `--${k}` : '') : v))
    .filter(Boolean)
    .join(' · ');
}

// ---- output

export interface Table {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

/** Accepts {columns, rows}, an array of objects, {rows:[{...}]}, or a pipe/tab text table; anything else is null (shown as text). */
export function parseTableOutput(output: string): Table | null {
  const text = output.trim();
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    const fromObjects = (arr: Record<string, unknown>[]): Table => {
      const columns = [...new Set(arr.flatMap((o) => Object.keys(o)))];
      return { columns, rows: arr.map((o) => columns.map((c) => cell(o[c]))) };
    };
    if (Array.isArray(j) && j.length && j.every((o) => o && typeof o === 'object' && !Array.isArray(o))) return fromObjects(j);
    if (j && Array.isArray(j.columns) && Array.isArray(j.rows)) {
      if (j.rows.every((r: unknown) => Array.isArray(r)))
        return {
          columns: j.columns.map(String),
          rows: j.rows.map((r: unknown[]) => r.map(cell)),
        };
      return {
        columns: j.columns.map(String),
        rows: j.rows.map((o: Record<string, unknown>) => j.columns.map((c: string) => cell(o[c]))),
      };
    }
    if (j && Array.isArray(j.rows)) return fromObjects(j.rows);
  } catch {
    /* not JSON */
  }
  const lines = text.split('\n').filter((l) => l.trim() && !/^[-+|\s]+$/.test(l));
  if (lines.length >= 2) {
    const sep = lines[0].includes('|') ? '|' : lines[0].includes('\t') ? '\t' : null;
    if (sep && lines.every((l) => l.includes(sep))) {
      const split = (l: string) =>
        l
          .split(sep)
          .map((c) => c.trim())
          .filter((_, i, a) => !(sep === '|' && (i === 0 || i === a.length - 1) && a[i] === ''));
      const [head, ...body] = lines.map(split);
      return { columns: head, rows: body };
    }
  }
  return null;
}

function cell(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(v);
}

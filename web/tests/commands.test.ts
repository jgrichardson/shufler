import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allCommands, commandParams, globalCommands, historyLabel, initialValues, isInline, loadCommandHistory, parseTableOutput, pushCommandHistory, stationCommands, validateValues } from '../src/ui/commands';
import type { CommandDef, Station } from '../src/types';

const tests: CommandDef = {
  id: 'tests',
  label: 'Run tests',
  description: 'Run the suite',
  scope: 'global',
  confirm: 'tap',
  prod: false,
  inputs: [
    { name: 'filter', label: 'Filter', type: 'text', default: '.' },
    { name: 'verbose', label: 'Verbose', type: 'flag' },
  ],
};
const note: CommandDef = {
  id: 'note',
  label: 'Session note',
  description: '',
  scope: 'station',
  confirm: 'tap',
  prod: false,
  inputs: [
    { name: 'state', label: 'State', type: 'choice', choices: ['working', 'me', 'waiting', 'staging', 'merged', 'done'] },
    { name: 'text', label: 'Note', type: 'text', max: 80 },
  ],
};
const query: CommandDef = { ...tests, id: 'query', scope: 'global', prod: true, inputs: [{ name: 'sql', label: 'Query', type: 'text', multiline: true }] };

describe('parseTableOutput', () => {
  it('reads {columns, rows} with array or object rows', () => {
    expect(parseTableOutput('{"columns":["a","b"],"rows":[[1,"x"],[2,null]]}')).toEqual({ columns: ['a', 'b'], rows: [[1, 'x'], [2, null]] });
    expect(parseTableOutput('{"columns":["a"],"rows":[{"a":1,"b":2}]}')).toEqual({ columns: ['a'], rows: [[1]] });
  });
  it('reads an array of objects, unioning the keys', () => {
    expect(parseTableOutput('[{"id":1,"n":"a"},{"id":2}]')).toEqual({ columns: ['id', 'n'], rows: [[1, 'a'], [2, null]] });
    expect(parseTableOutput('{"rows":[{"id":1}]}')).toEqual({ columns: ['id'], rows: [[1]] });
  });
  it('reads a pipe or tab text table', () => {
    expect(parseTableOutput(' id | name \n----+------\n  1 | foo\n')).toEqual({ columns: ['id', 'name'], rows: [['1', 'foo']] });
    expect(parseTableOutput('a\tb\n1\t2')).toEqual({ columns: ['a', 'b'], rows: [['1', '2']] });
  });
  it('stringifies nested values', () => {
    expect(parseTableOutput('[{"a":{"b":1}}]')).toEqual({ columns: ['a'], rows: [['{"b":1}']] });
  });
  it('leaves plain text, empty output, a single line and an empty array to the text view', () => {
    expect(parseTableOutput('12 passed, 0 failed')).toBeNull();
    expect(parseTableOutput('')).toBeNull();
    expect(parseTableOutput('a | b')).toBeNull();
    expect(parseTableOutput('[]')).toBeNull();
    expect(parseTableOutput('[1,2]')).toBeNull();
  });
});

describe('command lists', () => {
  it('splits global and station commands and drops malformed entries', () => {
    const caps = { commands: [tests, note, { id: '', scope: 'global' }, { id: 'x', scope: 'elsewhere' }] as CommandDef[] };
    expect(allCommands(caps).map((c) => c.id)).toEqual(['tests', 'note']);
    expect(globalCommands(caps).map((c) => c.id)).toEqual(['tests']);
    expect(stationCommands(caps).map((c) => c.id)).toEqual(['note']);
    expect(allCommands({})).toEqual([]);
    expect(allCommands(null)).toEqual([]);
  });
  it('only single-line commands render inline', () => {
    expect(isInline(tests)).toBe(true);
    expect(isInline(note)).toBe(true);
    expect(isInline(query)).toBe(false);
  });
});

describe('command form', () => {
  const station = (state: string, text: string) => ({ note: { state, text, ts: 0 } }) as unknown as Station;

  it('starts from defaults: flags off, choices on their first option', () => {
    expect(initialValues(tests)).toEqual({ filter: '.', verbose: false });
    expect(initialValues(note)).toEqual({ state: 'working', text: '' });
  });
  it("prefills a note command from the station's note", () => {
    expect(initialValues(note, station('waiting', 'Jordan: review #344'))).toEqual({ state: 'waiting', text: 'Jordan: review #344' });
    expect(initialValues(note, station('waiting', 'x'.repeat(120))).text).toHaveLength(80);
    expect(initialValues(tests, station('me', 'ignored'))).toEqual({ filter: '.', verbose: false });
  });
  it('validates required text, max length and choices', () => {
    expect(validateValues(note, { state: 'me', text: 'me: merge #12' })).toBeNull();
    expect(validateValues(note, { state: 'me', text: '  ' })).toBe('Note is empty');
    expect(validateValues(note, { state: 'me', text: 'x'.repeat(81) })).toBe('Note is over 80 characters');
    expect(validateValues(note, { state: 'sleeping', text: 'x' })).toBe('Pick state');
    expect(validateValues(tests, { filter: '', verbose: false })).toBeNull();
    expect(validateValues({ inputs: [{ name: 'q', label: 'Q', type: 'text', optional: true }] }, { q: '' })).toBeNull();
  });
  it('builds run_command params: trimmed text, real booleans, the station only for station scope', () => {
    expect(commandParams(tests, { filter: ' billing ', verbose: true, stray: 'x' })).toEqual({ command: 'tests', values: { filter: 'billing', verbose: true } });
    expect(commandParams(tests, { filter: 'a' }, 'ws-1')).toEqual({ command: 'tests', values: { filter: 'a', verbose: false } });
    expect(commandParams(note, { state: 'me', text: 'hi ' }, 'ws-1')).toEqual({ command: 'note', station_id: 'ws-1', values: { state: 'me', text: 'hi' } });
  });
});

describe('command history', () => {
  let m: Map<string, string>;
  beforeEach(() => {
    m = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the newest ten per command, without duplicates, under its own key', () => {
    pushCommandHistory('tests', { filter: 'a' });
    pushCommandHistory('tests', { filter: 'b' });
    pushCommandHistory('tests', { filter: 'a' });
    expect(loadCommandHistory('tests')).toEqual([{ filter: 'a' }, { filter: 'b' }]);
    expect(m.has('shufler.commands.history.tests')).toBe(true);
    expect(loadCommandHistory('note')).toEqual([]);
    for (let i = 0; i < 12; i++) pushCommandHistory('tests', { filter: String(i) });
    expect(loadCommandHistory('tests')).toHaveLength(10);
  });
  it('survives junk in storage', () => {
    m.set('shufler.commands.history.tests', 'not json');
    expect(loadCommandHistory('tests')).toEqual([]);
  });
  it('labels an entry by its values, flags by name', () => {
    expect(historyLabel({ filter: 'billing', verbose: true, quiet: false })).toBe('billing · --verbose');
  });
});

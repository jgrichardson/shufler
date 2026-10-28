import { useReplay } from './catchUp';
import { globalCommands } from './commands';
import { useEffect, useState } from 'react';
import { dispatch, findItem, findItemByPr, toast, toggleLibrary, useWorld } from '../store';
import type { Preset } from '../store/reducer';
import { phaseIndex } from '../lib/domains';
import { requestAction } from './requestAction';
import { usePalette } from './Palette';
import { useSettings } from './SkillsSettings';
import { useLayers } from './layers';
import { toggleHorizon } from '../scene/horizon';
import { toggleLayout } from './worldLayout';

function typing(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

const PRESETS: Preset[] = ['overview', 'needs', 'pipeline', 'domain', 'shipped'];

function cycle<T>(list: T[], current: number, dir: number): T | undefined {
  if (!list.length) return undefined;
  const i = current < 0 ? (dir > 0 ? 0 : list.length - 1) : (current + dir + list.length) % list.length;
  return list[i];
}

/** Pipeline order: by phase, then domain lane, then age. */
function pipelineItems() {
  const s = useWorld.getState().snapshot;
  if (!s) return [];
  const lane = new Map(s.domains.map((d, i) => [d.id, i]));
  return s.workpieces
    .filter((w) => w.phase !== 'shipped')
    .sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase) || (lane.get(a.domain) ?? 99) - (lane.get(b.domain) ?? 99) || (a.phase_since ?? 0) - (b.phase_since ?? 0));
}

function managingStation(): string | null {
  const sel = useWorld.getState().selection;
  if (sel?.kind === 'station') return sel.id;
  if (sel?.kind === 'item') {
    const w = findItem(sel.id);
    return w?.station_ids[0] ?? w?.station_id ?? null;
  }
  return null;
}

/** Returns the in-progress "#1234" search text, or null when not searching. */
export function useKeyboard(): string | null {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => {
    let buf: string | null = null;
    const setBuf = (v: string | null) => {
      buf = v;
      setSearch(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if ((e.target as HTMLElement | null)?.closest?.('.xterm')) return;
        e.preventDefault();
        usePalette.getState().set(!usePalette.getState().open);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (usePalette.getState().open) {
        if (e.key === 'Escape') usePalette.getState().set(false);
        return;
      }
      const s = useWorld.getState();
      if (buf != null) {
        if (/^\d$/.test(e.key)) {
          e.preventDefault();
          return setBuf(buf + e.key);
        }
        if (e.key === 'Backspace') return setBuf(buf.slice(0, -1));
        if (e.key === 'Enter') {
          const w = findItemByPr(Number(buf));
          if (w) dispatch({ type: 'select', selection: { kind: 'item', id: w.id }, fly: true });
          else if (buf) toast(false, `No PR #${buf} on the board`);
          return setBuf(null);
        }
        setBuf(null);
        if (e.key === 'Escape') return;
      }
      if (e.key === 'Escape') {
        if (useReplay.getState().running) return useReplay.getState().skip();
        if (s.pending) return dispatch({ type: 'cancel_action' });
        if (s.helpOpen) return dispatch({ type: 'help', open: false });
        if (s.commandDrawer.open) return dispatch({ type: 'command_drawer', open: false });
        if (useSettings.getState().open) return useSettings.getState().set(false);
        if (typing(e.target)) return (e.target as HTMLElement).blur();
        if (s.dim) return dispatch({ type: 'preset', preset: 'overview' });
        return dispatch({ type: 'select', selection: null });
      }
      if (typing(e.target) || s.pending) return;
      // a held key must not flip toggles (P, ?, 1-5) back and forth
      if (e.repeat && !['j', 'k', 'n', 'N', 'd', 'D'].includes(e.key)) return;
      const sel = s.selection;
      const snap = s.snapshot;
      if (e.key === '0') return useLayers.getState().toggleClean();
      if (e.key >= '1' && e.key <= '5') return dispatch({ type: 'preset', preset: PRESETS[Number(e.key) - 1] });
      switch (e.key) {
        case '#':
          e.preventDefault();
          return setBuf('');
        case '?':
          return dispatch({ type: 'help', open: !s.helpOpen });
        case '/':
          e.preventDefault();
          if (!globalCommands(s.snapshot?.capabilities).length) return;
          return dispatch({ type: 'command_drawer', open: true });
        case 'l':
        case 'L':
          return toggleLibrary();
        case 'p':
        case 'P':
          return dispatch({ type: 'preset', preset: s.preset === 'pipeline' ? (s.prevPreset === 'pipeline' ? 'overview' : s.prevPreset) : 'pipeline' });
        case 'r':
        case 'R':
          return dispatch({ type: 'reset_view' });
        case 'h':
        case 'H':
          return toggleHorizon();
        case 'i':
        case 'I':
          return toggleLayout();
        case 'n':
        case 'N': {
          const moves = snap?.your_move ?? [];
          const cur = moves.findIndex((m) => (sel?.kind === 'item' && m.workpiece_id === sel.id) || (sel?.kind === 'station' && !m.workpiece_id && m.station_id === sel.id));
          const m = cycle(moves, cur, e.shiftKey ? -1 : 1);
          if (!m) return;
          const w = m.workpiece_id ? findItem(m.workpiece_id) : findItemByPr(m.pr);
          if (w) dispatch({ type: 'select', selection: { kind: 'item', id: w.id }, fly: true });
          else if (m.station_id) dispatch({ type: 'select', selection: { kind: 'station', id: m.station_id }, fly: true, tab: m.kind === 'question' ? 'conversation' : undefined });
          return;
        }
        case 'j':
        case 'k': {
          const list = pipelineItems();
          const w = cycle(list, sel?.kind === 'item' ? list.findIndex((x) => x.id === sel.id) : -1, e.key === 'j' ? 1 : -1);
          if (w) dispatch({ type: 'select', selection: { kind: 'item', id: w.id }, fly: true });
          return;
        }
        case 'd':
        case 'D': {
          const ds = snap?.domains ?? [];
          let cur = -1;
          if (sel?.kind === 'domain') cur = ds.findIndex((d) => d.id === sel.id);
          else if (sel?.kind === 'item') cur = ds.findIndex((d) => d.id === findItem(sel.id)?.domain);
          const d = cycle(ds, cur, e.shiftKey ? -1 : 1);
          if (d) dispatch({ type: 'select', selection: { kind: 'domain', id: d.id } });
          return;
        }
        case 'g':
        case 'G': {
          const w = sel?.kind === 'item' ? findItem(sel.id) : undefined;
          if (w && w.phase !== 'shipped') dispatch({ type: 'select', selection: { kind: 'gate', phase: w.phase } });
          return;
        }
        case 'Enter':
          // Enter on a focused button or link is that control's click, not a fly
          if ((e.target as HTMLElement | null)?.closest?.('button, a, [role="button"], [role="switch"]')) return;
          if (sel) dispatch({ type: 'select', selection: sel, fly: true });
          return;
        case 'f':
        case 'F': {
          const id = managingStation();
          if (id) requestAction('focus', { station_id: id });
          return;
        }
        case 'o':
        case 'O': {
          const w = sel?.kind === 'item' ? findItem(sel.id) : undefined;
          if (w?.pr != null) requestAction('open_pr', w.url ? { pr: w.pr, url: w.url } : { pr: w.pr });
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return search;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Skill } from '../types';
import { dispatch, findStation, useCaps, useWorld } from '../store';
import { globalCommands } from './commands';
import { fillPrompt } from './prompts';
import { useConfig } from '../api/config';
import { requestAction } from './requestAction';
import { contextPr, contextStation, fuzzy, runSkill } from './skills';
import { openTerminal } from './terminals';
import { useFocusTrap } from './focusTrap';
import { focusLabel, useTerminalName } from '../lib/terminalName';
import { leverOffReason } from '../lib/terminalCaps';
import { toggleHorizon } from '../scene/horizon';

export const usePalette = create<{ open: boolean; set: (open: boolean) => void }>()((set) => ({ open: false, set: (open) => set({ open }) }));

interface Row {
  key: string;
  kind: 'skill' | 'prompt' | 'lever';
  title: string;
  sub: string;
  target: string;
  skill?: Skill;
  needsArgs?: boolean;
  /** Why the terminal cannot run it (greyed out, with this as the tooltip); null when it can. */
  off?: string | null;
  run: (args: string) => void;
}

export function Palette() {
  const open = usePalette((s) => s.open);
  const setOpen = usePalette((s) => s.set);
  const skills = useWorld((s) => s.snapshot?.skills);
  const caps = useCaps();
  const stations = useWorld((s) => s.snapshot?.stations);
  const terminal = useTerminalName();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [argsFor, setArgsFor] = useState<Row | null>(null);
  const [args, setArgs] = useState('');
  const [station, setStation] = useState<string>('');
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<HTMLSelectElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [needPick, setNeedPick] = useState(false);
  useFocusTrap(dialog, open);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setIdx(0);
    setArgsFor(null);
    setStation(contextStation() ?? '');
    setNeedPick(false);
    setTimeout(() => input.current?.focus(), 20);
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const sk = (skills ?? []).filter((s) => s.exposed || s.pinned);
    sk.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
    for (const s of sk) {
      out.push({
        key: `s:${s.name}`,
        kind: 'skill',
        title: s.slash,
        sub: s.description,
        target: s.target ?? '',
        skill: s,
        needsArgs: !s.args_template && !!s.args_hint,
        off: leverOffReason('run_skill', caps),
        run: (a) => runSkill(s, { station_id: station || null, pr: station && station !== contextStation() ? findStation(station)?.pr_numbers[0] ?? null : undefined, args: a || undefined }),
      });
    }
    for (const p of useConfig.getState().prompts)
      out.push({
        key: `p:${p.label}`,
        kind: 'prompt',
        title: p.label,
        sub: fillPrompt(p.text, contextPr()),
        target: '',
        off: leverOffReason('dispatch', caps),
        run: () => station && requestAction('dispatch', { station_id: station, text: fillPrompt(p.text, contextPr()) }),
      });
    out.push(
      ...globalCommands(caps).map((c): Row => ({ key: `c:${c.id}`, kind: 'lever', title: c.label, sub: c.description, target: '', run: () => dispatch({ type: 'command_drawer', open: true, id: c.id }) })),
      { key: 'l:prod', kind: 'lever', title: 'Prod console', sub: 'Terminal with the production console command typed in', target: '', run: () => openTerminal({ title: 'Prod console', preset: 'prod_console' }) },
      { key: 'l:focus', kind: 'lever', title: focusLabel(terminal), sub: 'Bring the session window forward', target: '', off: leverOffReason('focus', caps), run: () => station && requestAction('focus', { station_id: station }) },
      { key: 'l:needs', kind: 'lever', title: 'Show what needs me', sub: 'Dim everything else', target: '', run: () => dispatch({ type: 'preset', preset: 'needs' }) },
      { key: 'l:horizon', kind: 'lever', title: 'Horizon view', sub: 'Tilt the camera down to the sky and skyline, or back (H)', target: '', run: toggleHorizon },
    );
    return out;
    // station is read inside run closures
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, caps, station, terminal]);

  const shown = useMemo(() => {
    if (!q.trim()) return rows.slice(0, 60);
    return rows
      .map((r) => {
        const base = fuzzy(q, r.title) * 2 + (r.sub.toLowerCase().includes(q.trim().toLowerCase()) ? 30 : 0);
        const bonus = r.kind === 'skill' ? (r.skill?.pinned ? 40 : 20) : 0;
        return { r, s: base > 0 ? base + bonus : 0 };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.r);
  }, [rows, q]);

  // keep the arrow-key row in view
  useEffect(() => {
    list.current?.querySelector('.palette-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [idx, open]);

  if (!open) return null;
  const close = () => setOpen(false);
  const needsStation = (r: Row) => (r.kind === 'prompt' || r.key === 'l:focus' || (r.kind === 'skill' && !r.skill?.target)) && !station;
  const choose = (r: Row) => {
    if (r.off) return; // greyed out: the row's tooltip says why
    if (needsStation(r)) {
      // say why nothing ran: point at the session picker
      setNeedPick(true);
      target.current?.focus();
      return;
    }
    if (r.needsArgs && !argsFor) {
      setArgsFor(r);
      setArgs('');
      return;
    }
    close();
    r.run(argsFor ? args : '');
  };
  const stationTitle = findStation(station)?.title;

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialog} className="palette glass" role="dialog" aria-modal="true" aria-label="Command palette">
        {!argsFor ? (
          <>
            <input
              ref={input}
              className="palette-input"
              placeholder="Run a skill, prompt or lever…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
                else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIdx((i) => Math.min(shown.length - 1, i + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIdx((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter' && shown[idx]) choose(shown[idx]);
              }}
            />
            <div className={`palette-target${needPick && !station ? ' is-needed' : ''}`}>
              Runs in
              <select ref={target} className="input xs" value={station} onChange={(e) => setStation(e.target.value)}>
                <option value="">the skill's default session</option>
                {(stations ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="palette-list" ref={list}>
              {shown.map((r, i) => (
                <button key={r.key} className={`palette-row${i === idx ? ' on' : ''}${needsStation(r) || r.off ? ' disabled' : ''}`} aria-disabled={r.off ? true : undefined} title={r.off ?? undefined} onMouseEnter={() => setIdx(i)} onClick={() => choose(r)}>
                  <span className={`palette-kind kind-${r.kind}`}>{r.kind === 'skill' ? (r.skill?.pinned ? 'pinned' : 'skill') : r.kind}</span>
                  <span className="palette-title">{r.title}</span>
                  <span className="palette-sub">{r.sub}</span>
                  <span className="palette-meta">{r.off ? 'not available' : needsStation(r) ? 'pick a session' : r.target || (r.kind !== 'lever' ? stationTitle ?? '' : '')}</span>
                </button>
              ))}
              {shown.length === 0 && <div className="muted pad">No match.</div>}
            </div>
          </>
        ) : (
          <div className="palette-args">
            <div className="modal-kicker">{argsFor.title}</div>
            <div className="muted">{argsFor.skill?.args_hint}</div>
            <input
              autoFocus
              className="input mono"
              value={args}
              placeholder={argsFor.skill?.args_hint ?? 'arguments'}
              onChange={(e) => setArgs(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation(); // back to the list, not out of the palette
                  setArgsFor(null);
                }
                if (e.key === 'Enter') choose(argsFor);
              }}
            />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setArgsFor(null)}>
                Back
              </button>
              <button className="btn primary" onClick={() => choose(argsFor)}>
                Continue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

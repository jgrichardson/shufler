import { ackTargets } from '../../lib/derive';
import { SkillButtons } from './SkillButtons';
import { useState } from 'react';
import type { YourMove } from '../../types';
import { capOn, dispatch, findItemByPr, useCaps, useWorld } from '../../store';
import { useLeverOff } from '../../lib/terminalCaps';
import { openTerminal } from '../terminals';
import { domainDef, PHASES, PHASE_SHORT } from '../../lib/domains';
import { PHASE_ACCENT } from '../../lib/colors';
import { agoIso, moveAge } from '../../lib/format';
import { requestAction } from '../requestAction';
import { DomainChip, ItemRow, Section } from './common';
import { globalCommands, isInline } from '../commands';
import { InlineCommand } from '../CommandForm';

const MOVE_TAG: Record<YourMove['kind'], string> = { note: 'Session', question: 'Decision', closeout: 'Close-out', merge: 'Merge', reply: 'Reply' };

function moveTarget(m: YourMove) {
  const item = m.workpiece_id ? { kind: 'item' as const, id: m.workpiece_id } : m.pr != null ? (findItemByPr(m.pr) ? { kind: 'item' as const, id: findItemByPr(m.pr)!.id } : null) : null;
  return { item, station: m.station_id ? { kind: 'station' as const, id: m.station_id } : null };
}

function MoveRow({ m }: { m: YourMove }) {
  const age = Date.now() / 1000 - m.since;
  const { item, station } = moveTarget(m);
  // a harness approval (Codex) reads as Approval, not Decision
  const qkind = useWorld((s) => (m.station_id ? s.snapshot?.stations.find((x) => x.id === m.station_id)?.pending_question?.kind : null));
  const open = () => {
    if (m.kind === 'question' || m.kind === 'reply') {
      if (station) dispatch({ type: 'select', selection: station, tab: 'conversation' });
    } else if (item) dispatch({ type: 'select', selection: item });
    else if (station) dispatch({ type: 'select', selection: station });
  };
  const acks = ackTargets(m);
  const sendOff = useLeverOff('postmerge');
  const focusOff = useLeverOff('focus');
  let primary: { label: string; run: () => void; off?: string | null } | null = null;
  if (m.kind === 'merge' && item) primary = { label: 'Review merge', run: open };
  else if (m.kind === 'closeout' && m.pr != null) primary = { label: 'Draft close-out', run: () => requestAction('postmerge', { pr: m.pr!, ...(m.station_id ? { station_id: m.station_id } : {}) }), off: sendOff };
  else if (m.kind === 'question') primary = { label: 'Answer', run: open };
  else if (m.kind === 'reply') primary = { label: 'Reply', run: open };
  else if (station) primary = { label: 'Focus', run: () => requestAction('focus', { station_id: station.id }), off: focusOff };
  return (
    <div className={`move-row sev-${m.severity}`} onClick={open} role="button" tabIndex={0}>
      <span className={`move-tag kind-${m.kind}`}>{m.kind === 'question' && qkind === 'approval' ? 'Approval' : MOVE_TAG[m.kind]}</span>
      <span className="move-text">
        {m.pr != null && <span className="mono">#{m.pr} </span>}
        {m.text}
        {m.also?.map((k) => (
          <span key={k} className={`move-also kind-${k}`} title={`Also on this PR: ${MOVE_TAG[k]}`}>
            + {MOVE_TAG[k]}
          </span>
        ))}
      </span>
      <span className={`move-age${age > 1800 ? ' old' : ''}`}>{moveAge(m.since)}</span>
      <span className="move-actions" onClick={(e) => e.stopPropagation()}>
        {primary && (
          <button className="btn xs primary" disabled={!!primary.off} title={primary.off ?? undefined} onClick={primary.run}>
            {primary.label}
          </button>
        )}
        {acks.length > 0 && (
          <button
            className="btn xs ghost"
            title={`Mark handled: ${acks.map((a) => a.kind).join(', ')}`}
            onClick={() => acks.forEach((a) => requestAction('ack', { kind: a.kind, id: a.id }))}
          >
            Done
          </button>
        )}
      </span>
    </div>
  );
}

function Sources() {
  const sourceMap = useWorld((s) => s.snapshot?.sources);
  const sources = Object.entries(sourceMap ?? {});
  if (!sources.length) return null;
  return (
    <div className="source-chips">
      {sources.map(([name, src]) => (
        <span key={name} className={`chip ${src.ok ? 'ok' : 'off'}`} title={src.ok ? `${name}: ${src.age != null ? `${Math.round(src.age)}s old` : 'ok'}` : `${name} offline: ${src.error ?? 'error'}`}>
          {!src.ok && '! '}
          {name}
        </span>
      ))}
    </div>
  );
}

function AssignRow({ pr, title }: { pr: number; title: string }) {
  const stations = useWorld((s) => s.snapshot?.stations);
  const [to, setTo] = useState('');
  const off = useLeverOff('dispatch');
  return (
    <div className="assign-row">
      <span className="mono">#{pr}</span>
      <span className="item-title">{title}</span>
      <select className="input xs" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Assign to…</option>
        {(stations ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      <button className="btn xs" disabled={!to || !!off} title={off ?? undefined} onClick={() => requestAction('dispatch', { station_id: to, text: `Take ownership of #${pr}: read it, then set your session note to its state.` })}>
        Assign
      </button>
    </div>
  );
}

function NewItem() {
  const [text, setText] = useState('');
  const off = useLeverOff('new_item');
  return (
    <div className="reply-row">
      <input className="input" placeholder="A link, or describe the work" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" disabled={!text.trim() || !!off} title={off ?? undefined} onClick={() => requestAction('new_item', { text: text.trim() })}>
        Start
      </button>
    </div>
  );
}

/** Global commands: single-line ones as inline forms, the rest as buttons that open the drawer on them. */
function Commands() {
  const commands = globalCommands(useCaps());
  if (!commands.length) return null;
  const inline = commands.filter(isInline);
  const drawer = commands.filter((c) => !isInline(c));
  return (
    <Section
      title="Commands"
      right={
        <button className="btn xs ghost" onClick={() => dispatch({ type: 'command_drawer', open: true })}>
          Open <kbd>/</kbd>
        </button>
      }
    >
      {inline.map((c) => (
        <div key={c.id} className="cmd-row">
          <div className="subhead" title={c.description}>
            {c.label}
          </div>
          <InlineCommand cmd={c} />
        </div>
      ))}
      {drawer.length > 0 && (
        <div className="btn-row wrap">
          {drawer.map((c) => (
            <button key={c.id} className={`btn${c.prod ? ' prod' : ''}`} title={c.description} onClick={() => dispatch({ type: 'command_drawer', open: true, id: c.id })}>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

/** A shell in any workspace, including utility ones that have no row in the world. */
function WorkspaceTerminal() {
  const stations = useWorld((s) => s.snapshot?.stations);
  const utility = useWorld((s) => s.snapshot?.utility_stations);
  const rows = (stations ?? []).filter((s) => !s.empty);
  const util = utility ?? [];
  if (!rows.length && !util.length) return null;
  const titleOf = new Map([...rows.map((s) => [s.id, s.title] as const), ...util.map((u) => [u.id, u.title] as const)]);
  return (
    <select
      className="input xs workspace-term"
      aria-label="Terminal in workspace"
      value=""
      onChange={(e) => {
        const id = e.target.value;
        if (id) openTerminal({ title: titleOf.get(id) ?? id, station_id: id, preset: 'shell_here' });
      }}
    >
      <option value="">Terminal in workspace…</option>
      {rows.length > 0 && (
        <optgroup label="Sessions">
          {rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </optgroup>
      )}
      {util.length > 0 && (
        <optgroup label="Tools">
          {util.map((u) => (
            <option key={u.id} value={u.id}>
              {u.title}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function Consoles() {
  const caps = useCaps();
  if (!capOn(caps.terminals)) return null;
  const presets = caps.terminal_presets ?? ['prod_console', 'local_console', 'shell_here'];
  return (
    <Section title="Consoles">
      <div className="btn-row wrap">
        {presets.includes('prod_console') && (
          <button className="btn prod" onClick={() => openTerminal({ title: 'Prod console', preset: 'prod_console' })}>
            Prod console
          </button>
        )}
        {presets.includes('local_console') && (
          <button className="btn" onClick={() => openTerminal({ title: 'Local console', preset: 'local_console' })}>
            Local console
          </button>
        )}
        <button className="btn" onClick={() => openTerminal({ title: 'Shell' })}>
          Shell
        </button>
        <WorkspaceTerminal />
      </div>
      <div className="form-hint">The command is typed for you without Enter, so nothing runs until you press it.</div>
    </Section>
  );
}

export function WorldPanel() {
  const snap = useWorld((s) => s.snapshot);
  const caps = useCaps();
  if (!snap) return null;
  const live = snap.workpieces.filter((w) => w.phase !== 'shipped');
  const ready = live.filter((w) => w.phase === 'merge' && w.kind === 'pr');
  const closeout = live.filter((w) => w.closeout_owed);
  const unowned = live.filter((w) => w.kind === 'pr' && w.pr != null && w.station_ids.length === 0 && !w.station_id);
  const shippedBy = new Map<string, typeof snap.shipped>();
  for (const s of snap.shipped) shippedBy.set(s.domain, [...(shippedBy.get(s.domain) ?? []), s]);
  return (
    <div className="panel-body">
      <Section title="Your move" right={<span className={`count-pill${snap.your_move.length ? ' hot' : ''}`}>{snap.your_move.length}</span>} className="your-move">
        {snap.your_move.length === 0 && <div className="muted">Nothing is waiting on you.</div>}
        {snap.your_move.map((m, i) => (
          <MoveRow key={`${m.kind}-${m.workpiece_id ?? m.pr ?? m.station_id}-${i}`} m={m} />
        ))}
      </Section>

      <Section title="Pipeline">
        <div className="gate-counts">
          {PHASES.map((p) => {
            const n = live.filter((w) => w.phase === p && !w.parked).length;
            return (
              <button key={p} className="gate-count" style={{ ['--c' as string]: PHASE_ACCENT[p] }} onClick={() => dispatch({ type: 'select', selection: { kind: 'gate', phase: p } })}>
                <span className="gc-n">{n}</span>
                <span className="gc-l">{PHASE_SHORT[p]}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {ready.length > 0 && (
        <Section title="Merge queue">
          {ready.map((w) => (
            <ItemRow key={w.id} w={w} showPhase={false} />
          ))}
        </Section>
      )}

      {closeout.length > 0 && (
        <Section title="Close-out owed">
          {closeout.map((w) => (
            <ItemRow key={w.id} w={w} showPhase={false} />
          ))}
        </Section>
      )}

      {unowned.length > 0 && (
        <Section title="Unowned PRs">
          {unowned.map((w) => (
            <AssignRow key={w.id} pr={w.pr!} title={w.title} />
          ))}
        </Section>
      )}

      <Section title="Shipped this week">
        {[...shippedBy.entries()].map(([d, list]) => (
          <div key={d} className="shipped-group">
            <div className="shipped-head">
              <DomainChip id={d} /> {domainDef(d).label}
            </div>
            {list.map((s) => (
              <div key={s.pr} className="shipped-row">
                <span className="mono">#{s.pr}</span>
                <span className="item-title">{s.title}</span>
                {s.closeout_owed && <span className="pod-badge env" title="Close-out owed">✉</span>}
                <span className="muted">{s.deployed ? 'live' : 'merged'} · {agoIso(s.merged_at)}</span>
              </div>
            ))}
          </div>
        ))}
        {snap.shipped.length === 0 && <div className="muted">Nothing shipped yet this week.</div>}
      </Section>

      <SkillButtons where="global" title="Skills" />
      <Consoles />
      <Commands />
      {capOn(caps.intake) && (
        <Section title="New work item">
          <NewItem />
        </Section>
      )}
      <Section title="Sources">
        <Sources />
      </Section>
    </div>
  );
}

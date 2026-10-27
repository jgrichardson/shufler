import type { ReactNode } from 'react';
import type { Workpiece, Station } from '../../types';
import { BALL_COLOR, PHASE_ACCENT, STATE_COLOR, STALLED_COLOR } from '../../lib/colors';
import { domainDef, PHASE_SHORT } from '../../lib/domains';
import { ballLabel } from '../../lib/derive';
import { ago, duration } from '../../lib/format';
import { dispatch } from '../../store';
import { tone } from '../tone';
import { REVIEWER_NAME } from '../../lib/brand';

export function Section({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel-section ${className ?? ''}`}>
      <header className="section-head">
        <h3>{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}

export function DomainChip({ id }: { id: string }) {
  const d = domainDef(id);
  return (
    <span className="domain-chip" style={{ background: d.color }} title={d.label}>
      {d.code}
    </span>
  );
}

export function PhaseChip({ phase }: { phase: Workpiece['phase'] }) {
  const c = PHASE_ACCENT[phase];
  return (
    <span className="phase-chip" style={{ color: tone(c), borderColor: `${c}88` }}>
      {PHASE_SHORT[phase]}
    </span>
  );
}

/** Short pod label: the PR number, else the title (never a raw branch name; round 5). */
export function itemLabel(w: Pick<Workpiece, 'pr' | 'id'> & { title?: string }, max = 14): string {
  if (w.pr != null) return `#${w.pr}`;
  const t = (w.title ?? '').trim() || 'Untitled work';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Plain words for who holds the ball and what is owed. */
export function owedText(w: Workpiece): string {
  const b = w.ball;
  switch (b.who) {
    case 'owner':
      if (w.phase === 'merge' && w.pr != null) return 'You: merge';
      if (w.closeout_owed) return 'You: close-out msg';
      return 'You: decide';
    case 'person':
      return `Waiting on ${b.name ?? 'someone'}`;
    case 'reviewer':
      return w.reviewer_loop ? `${REVIEWER_NAME} R${w.reviewer_loop.round}` : `${REVIEWER_NAME} reviewing`;
    case 'ci':
      return 'CI running';
    case 'testers':
      return 'Testers on preview';
    case 'claude':
      return 'Claude working';
    case 'closeout':
      return 'Close-out owed';
    default:
      return w.phase === 'deploy' ? 'Waiting on deploy' : '';
  }
}

export function BallDot({ w, size = 9 }: { w: Workpiece; size?: number }) {
  const c = BALL_COLOR[w.ball.who];
  return <span className={`ball-dot${w.ball.who === 'owner' ? ' pulse' : ''}`} style={{ background: c, width: size, height: size }} title={ballLabel(w.ball) || 'none'} />;
}

export function ItemRow({ w, showDomain = true, showPhase = true, extra }: { w: Workpiece; showDomain?: boolean; showPhase?: boolean; extra?: ReactNode }) {
  const age = w.phase_since ? ago(w.phase_since) : '';
  return (
    <button className={`item-row${w.ball.who === 'owner' ? ' is-owner' : ''}`} onClick={() => dispatch({ type: 'select', selection: { kind: 'item', id: w.id } })}>
      <BallDot w={w} />
      <span className="item-num">{itemLabel(w)}</span>
      {showDomain && <DomainChip id={w.domain} />}
      <span className="item-title">{w.title}</span>
      <span className="item-right">
        {showPhase && <PhaseChip phase={w.phase} />}
        {owedText(w) && <span className={`item-owed ball-${w.ball.who}`}>{owedText(w)}</span>}
        {w.stuck && <span className="stuck-tag">stuck {age}</span>}
        {extra}
      </span>
    </button>
  );
}

export function stationLampColor(s: Station): string {
  return s.activity.status === 'stalled' ? STALLED_COLOR : STATE_COLOR[s.note?.state ?? 'done'] ?? '#8a8f98';
}

export function StationRow({ s, items }: { s: Station; items: Workpiece[] }) {
  const c = stationLampColor(s);
  return (
    <button className="station-row" onClick={() => dispatch({ type: 'select', selection: { kind: 'station', id: s.id } })}>
      <span className="state-dot" style={{ background: c }} />
      <span className="station-name">{s.title}</span>
      <span className="station-items">
        {items.slice(0, 4).map((w) => (
          <span key={w.id} className="mini-chip" style={{ borderColor: BALL_COLOR[w.ball.who] }}>
            {itemLabel(w)}
          </span>
        ))}
        {items.length > 4 && <span className="mini-chip">+{items.length - 4}</span>}
      </span>
      <span className="station-meta">
        {s.activity.status === 'active' ? 'active' : s.activity.status === 'stalled' ? 'stalled' : s.activity.status === 'closed' ? 'closed' : `idle ${duration(s.activity.idle_seconds)}`}
      </span>
    </button>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="facts">
      {rows
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => (
          <div key={k} className="fact">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  return (
    <button
      className="btn ghost xs"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text);
        const el = e.currentTarget;
        el.textContent = 'Copied';
        setTimeout(() => (el.textContent = label), 1200);
      }}
    >
      {label}
    </button>
  );
}

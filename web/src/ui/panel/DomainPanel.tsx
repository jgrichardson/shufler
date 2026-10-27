import type { Domain } from '../../types';
import { useWorld } from '../../store';
import { PHASES, PHASE_SHORT } from '../../lib/domains';
import { PHASE_ACCENT } from '../../lib/colors';
import { ItemRow, Section, StationRow, itemLabel, BallDot } from './common';
import { dispatch } from '../../store';
import { tone } from '../tone';

export function DomainPanel({ d }: { d: Domain }) {
  const snap = useWorld((s) => s.snapshot);
  if (!snap) return null;
  const stations = snap.stations.filter((s) => d.station_ids.includes(s.id) || s.domain === d.id);
  const items = snap.workpieces.filter((w) => w.domain === d.id && w.phase !== 'shipped');
  const live = items.filter((w) => !w.parked);
  const parked = items.filter((w) => w.parked);
  const needs = live.filter((w) => w.ball.who === 'owner');
  const shipped = snap.shipped.filter((s) => s.domain === d.id);
  return (
    <div className="panel-body">
      <div className="item-hero" style={{ borderLeftColor: d.color }}>
        <div className="hero-kicker">
          <span className="domain-chip" style={{ background: d.color }}>
            {d.code}
          </span>
          <span>Domain</span>
        </div>
        <h2>{d.label}</h2>
        <div className="hero-stats">
          <span>
            <b>{live.length}</b> live
          </span>
          <span className={needs.length ? 'bad-text' : ''}>
            <b>{needs.length}</b> need you
          </span>
          <span>
            <b>{parked.length}</b> parked
          </span>
          <span>
            <b>{shipped.length}</b> shipped this week
          </span>
        </div>
      </div>
      {needs.length > 0 && (
        <Section title="Needs you" className="needs">
          {needs.map((w) => (
            <ItemRow key={w.id} w={w} showDomain={false} />
          ))}
        </Section>
      )}
      <Section title="By phase">
        <div className="kanban">
          {PHASES.map((p) => {
            const col = live.filter((w) => w.phase === p);
            return (
              <div key={p} className="kanban-col">
                <div className="kanban-head" style={{ color: tone(PHASE_ACCENT[p]) }}>
                  <b>{PHASE_SHORT[p]}</b> <span>{col.length || ''}</span>
                </div>
                {col.map((w) => (
                  <button key={w.id} className="kanban-card" title={w.title} onClick={() => dispatch({ type: 'select', selection: { kind: 'item', id: w.id } })}>
                    <BallDot w={w} size={7} />
                    {itemLabel(w)}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </Section>
      <Section title={`Sessions · ${stations.length}`}>
        {stations.map((s) => (
          <StationRow key={s.id} s={s} items={snap.workpieces.filter((w) => w.station_ids.includes(s.id) && w.phase !== 'shipped')} />
        ))}
        {stations.length === 0 && <div className="muted">No session works this domain right now.</div>}
      </Section>
      {parked.length > 0 && (
        <Section title="Parked">
          {parked.map((w) => (
            <ItemRow key={w.id} w={w} showDomain={false} />
          ))}
        </Section>
      )}
    </div>
  );
}

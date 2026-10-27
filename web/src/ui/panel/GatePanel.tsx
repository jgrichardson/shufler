import type { Phase } from '../../types';
import { useWorld } from '../../store';
import { domainDef, PHASE_DESC, PHASE_LABEL } from '../../lib/domains';
import { PHASE_ACCENT } from '../../lib/colors';
import { ItemRow, Section } from './common';
import { REVIEWER_NAME } from '../../lib/brand';

const GATE_HELP: Partial<Record<Phase, string>> = {
  brainstorm: 'Ideas being explored before a plan exists.',
  plan: 'Plans and empty tracking PRs.',
  build: 'Code and tests being written. Claude has the ball.',
  qa: 'On a preview app with testers.',
  review: `In review: PR review, ${REVIEWER_NAME.toLowerCase()}, CI.`,
  merge: 'Ready to merge.',
  deploy: 'Merged to develop, waiting on the production deploy.',
};

export function GatePanel({ phase }: { phase: Phase }) {
  const workpieces = useWorld((s) => s.snapshot?.workpieces);
  const items = (workpieces ?? []).filter((w) => w.phase === phase && !w.parked).sort((a, b) => (a.phase_since ?? 0) - (b.phase_since ?? 0));
  const byDomain = new Map<string, typeof items>();
  for (const w of items) byDomain.set(w.domain, [...(byDomain.get(w.domain) ?? []), w]);
  return (
    <div className="panel-body">
      <div className="item-hero" style={{ borderLeftColor: PHASE_ACCENT[phase] }}>
        <div className="hero-kicker">
          <span>Gate</span>
        </div>
        <h2>{PHASE_LABEL[phase]}</h2>
        <div className="muted">{PHASE_DESC[phase] || GATE_HELP[phase]}</div>
        <div className="hero-stats">
          <span>
            <b>{items.length}</b> item{items.length === 1 ? '' : 's'}
          </span>
          <span className={items.some((w) => w.ball.who === 'owner') ? 'bad-text' : ''}>
            <b>{items.filter((w) => w.ball.who === 'owner').length}</b> need you
          </span>
        </div>
      </div>
      {[...byDomain.entries()].map(([d, ws]) => (
        <Section key={d} title={domainDef(d).label}>
          {ws.map((w) => (
            <div key={w.id}>
              <ItemRow w={w} showPhase={false} showDomain={false} />
              {phase === 'review' && w.pr != null && w.reviewer !== 'off' && (
                <div className="gate-detail">
                  {REVIEWER_NAME} {String(w.reviewer).replace('_', ' ')}
                  {w.reviewer_loop?.round ? ` · round ${w.reviewer_loop.round}` : ''}
                </div>
              )}
              {phase === 'review' && w.pr != null && w.reviewer !== 'off' && (w.ci !== 'success' || w.mergeable === 'CONFLICTING') && (
                <div className="gate-detail">
                  CI {w.ci}
                  {w.mergeable === 'CONFLICTING' ? ' · conflicts with the base branch' : ''}
                </div>
              )}
            </div>
          ))}
        </Section>
      ))}
      {items.length === 0 && <div className="muted pad">Nothing at this gate.</div>}
    </div>
  );
}

import type { Shipped, Snapshot, Workpiece } from '../../types';
import { selectItem, useWorld } from '../../store';
import { PILE_ALL, PILE_DOCK } from '../../store/reducer';
import { domainDef } from '../../lib/domains';
import { agoIso } from '../../lib/format';
import { DomainChip, Section } from './common';

export interface PileRow extends Shipped {
  /** Parent PR this stacked PR shipped through, when inherited. */
  via: number | null;
  /** GitHub link for the PR, or null when no URL is known. */
  href: string | null;
  /** Workpiece id to select on click, when the PR is still on the board. */
  itemId: string | null;
}

const PULL = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/\d+/;

/** Shipped rows for one rack (a domain), the whole Warehouse (PILE_ALL) or the Shipping Dock (PILE_DOCK: close-out owed), newest merge first. */
export function pileRows(snap: Pick<Snapshot, 'shipped' | 'workpieces'>, id: string): PileRow[] {
  const byPr = new Map<number, Workpiece>();
  for (const w of snap.workpieces) if (w.pr != null && !byPr.has(w.pr)) byPr.set(w.pr, w);
  const repo = snap.workpieces.map((w) => PULL.exec(w.url ?? '')?.[1]).find(Boolean) ?? null;
  return snap.shipped
    .filter((s) => (id === PILE_DOCK ? !!s.closeout_owed : id === PILE_ALL || s.domain === id))
    .map((s) => {
      const w = byPr.get(Number(s.pr));
      const own = w && PULL.test(w.url) ? w.url : null;
      return { ...s, via: w?.shipped_via ?? null, href: own ?? (repo ? `${repo}/pull/${s.pr}` : null), itemId: w?.id ?? null };
    })
    .sort((a, b) => (b.merged_at ?? '').localeCompare(a.merged_at ?? ''));
}

function Row({ r }: { r: PileRow }) {
  const open = r.itemId ? () => selectItem(r.itemId!) : undefined;
  return (
    <div className={`shipped-row pile-row${open ? ' is-link' : ''}`} onClick={open} title={open ? 'Open this PR' : undefined}>
      {r.href ? (
        <a className="mono" href={r.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          #{r.pr}
        </a>
      ) : (
        <span className="mono">#{r.pr}</span>
      )}
      <span className="item-title">
        {r.title}
        {r.via != null && <span className="muted"> · via #{r.via}</span>}
        {r.closeout_owed && (
          <span className="pod-badge env" title="Close-out owed">
            {' '}✉
          </span>
        )}
      </span>
      <span className="muted">
        {r.deployed ? 'live' : 'merged'} · {agoIso(r.merged_at)}
      </span>
    </div>
  );
}

export function PilePanel({ id }: { id: string }) {
  const snap = useWorld((s) => s.snapshot);
  if (!snap) return null;
  const rows = pileRows(snap, id);
  const dock = id === PILE_DOCK;
  const all = id === PILE_ALL || dock;
  const d = domainDef(id);
  const live = rows.filter((r) => r.deployed).length;
  const owed = rows.filter((r) => r.closeout_owed).length;
  const groups = new Map<string, PileRow[]>();
  for (const r of rows) groups.set(r.domain, [...(groups.get(r.domain) ?? []), r]);
  return (
    <div className="panel-body">
      <div className="item-hero" style={{ borderLeftColor: all ? '#f5c542' : d.color }}>
        <div className="hero-kicker">
          {!all && <DomainChip id={id} />}
          <span>{dock ? 'Shipping Dock' : 'Warehouse'}</span>
        </div>
        <h2>{dock ? 'Close-out owed' : all ? 'Everything shipped' : d.label}</h2>
        {dock && <div className="muted">Shipped PRs waiting on the dock until their close-out message is sent.</div>}
        <div className="hero-stats">
          <span>
            <b>{rows.length}</b> shipped this week
          </span>
          <span>
            <b>{live}</b> live
          </span>
          <span className={owed ? 'bad-text' : ''}>
            <b>{owed}</b> close-out owed
          </span>
        </div>
      </div>
      <Section title={dock ? 'Waiting on the dock' : 'Shipped this week'}>
        {rows.length === 0 && <div className="muted">{dock ? 'No close-out owed. The dock is clear.' : 'Nothing shipped yet this week.'}</div>}
        {all
          ? [...groups.entries()].map(([dom, list]) => (
              <div key={dom} className="shipped-group">
                <div className="shipped-head">
                  <DomainChip id={dom} /> {domainDef(dom).label}
                </div>
                {list.map((r) => (
                  <Row key={r.pr} r={r} />
                ))}
              </div>
            ))
          : rows.map((r) => <Row key={r.pr} r={r} />)}
      </Section>
    </div>
  );
}

import { dispatch, useWorld, useItem, useStation } from '../store';
import type { Tab } from '../store/reducer';
import { domainDef, PHASE_LABEL } from '../lib/domains';
import { itemLabel } from './panel/common';
import { WorldPanel } from './panel/WorldPanel';
import { DomainPanel } from './panel/DomainPanel';
import { GatePanel } from './panel/GatePanel';
import { PilePanel } from './panel/PilePanel';
import { PILE_ALL, PILE_DOCK } from '../store/reducer';
import { ItemPanel } from './panel/ItemPanel';
import { StationActions, StationData, StationOverview } from './panel/StationPanel';
import { Conversation } from './panel/Conversation';
import { FleetTable } from './panel/Telemetry';
import { LibraryManager } from './library/LibraryManager';

const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', conversation: 'Conversation', actions: 'Actions', data: 'Data', fleet: 'Fleet' };

function Crumbs({ parts }: { parts: { label: string; onClick?: () => void }[] }) {
  return (
    <nav className="crumbs">
      {parts.map((p, i) => (
        <span key={i} className="crumb">
          {i > 0 && <span className="crumb-sep">/</span>}
          {p.onClick ? <button onClick={p.onClick}>{p.label}</button> : <span className="crumb-here">{p.label}</span>}
        </span>
      ))}
    </nav>
  );
}

function Tabs({ tabs }: { tabs: Tab[] }) {
  const tab = useWorld((s) => s.tab);
  const current = tabs.includes(tab) ? tab : tabs[0];
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={t === current} className={`tab${t === current ? ' on' : ''}`} onClick={() => dispatch({ type: 'tab', tab: t })}>
          {TAB_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

const toWorld = () => dispatch({ type: 'select', selection: null });
const toDomain = (id: string) => () => dispatch({ type: 'select', selection: { kind: 'domain', id } });

export function Panel() {
  const selection = useWorld((s) => s.selection);
  const tab = useWorld((s) => s.tab);
  const domains = useWorld((s) => s.snapshot?.domains);
  const station = useStation(selection?.kind === 'station' ? selection.id : null);
  const item = useItem(selection?.kind === 'item' ? selection.id : null);
  const ownerId = item ? item.station_ids[0] ?? item.station_id : null;
  const owner = useStation(ownerId);
  const snapshot = useWorld((s) => s.snapshot);
  if (!snapshot)
    return (
      <aside className="panel glass" aria-busy="true">
        <div className="panel-head">
          <span className="crumb-here">World</span>
        </div>
        <div className="panel-wait">Your moves, the pipeline and shipped work show here once the daemon answers.</div>
      </aside>
    );

  let crumbs: { label: string; onClick?: () => void }[] = [{ label: 'World' }];
  let tabs: Tab[] | null = ['overview', 'fleet'];
  let body: JSX.Element = tab === 'fleet' ? <FleetTable /> : <WorldPanel />;

  if (selection?.kind === 'domain') {
    const d = domains?.find((x) => x.id === selection.id);
    tabs = null;
    crumbs = [{ label: 'World', onClick: toWorld }, { label: domainDef(selection.id).label }];
    body = d ? <DomainPanel d={d} /> : <div className="muted pad">That domain has no work right now.</div>;
  } else if (selection?.kind === 'pile') {
    tabs = null;
    const id = selection.id;
    const toWarehouse = () => dispatch({ type: 'select', selection: { kind: 'pile', id: PILE_ALL } });
    crumbs =
      id === PILE_DOCK
        ? [{ label: 'World', onClick: toWorld }, { label: 'Shipping Dock' }]
        : id === PILE_ALL
          ? [{ label: 'World', onClick: toWorld }, { label: 'Warehouse' }]
          : [{ label: 'World', onClick: toWorld }, { label: 'Warehouse', onClick: toWarehouse }, { label: domainDef(id).label }];
    body = <PilePanel id={selection.id} />;
  } else if (selection?.kind === 'library') {
    tabs = null;
    crumbs = [{ label: 'World', onClick: toWorld }, { label: 'Library' }];
    body = <LibraryManager />;
  } else if (selection?.kind === 'gate') {
    tabs = null;
    crumbs = [{ label: 'World', onClick: toWorld }, { label: PHASE_LABEL[selection.phase] }];
    body = <GatePanel phase={selection.phase} />;
  } else if (selection?.kind === 'station' && station) {
    crumbs = [{ label: 'World', onClick: toWorld }, { label: domainDef(station.domain).label, onClick: toDomain(station.domain) }, { label: station.title }];
    tabs = ['overview', 'conversation', 'actions', 'data'];
    const t = tabs.includes(tab) ? tab : 'overview';
    body =
      t === 'conversation' ? <Conversation station={station} /> : t === 'actions' ? <StationActions s={station} /> : t === 'data' ? <StationData s={station} /> : <StationOverview s={station} />;
  } else if (selection?.kind === 'item' && item) {
    crumbs = [{ label: 'World', onClick: toWorld }, { label: domainDef(item.domain).label, onClick: toDomain(item.domain) }, { label: itemLabel(item) }];
    tabs = owner ? ['overview', 'conversation'] : null;
    body = tab === 'conversation' && owner ? <Conversation station={owner} /> : <ItemPanel w={item} />;
  } else if (selection) {
    tabs = null;
    crumbs = [{ label: 'World', onClick: toWorld }, { label: 'Gone' }];
    body = <div className="muted pad">That item left the board.</div>;
  }

  return (
    <aside className="panel glass" aria-label="Control panel">
      <header className="panel-head">
        <Crumbs parts={crumbs} />
        {selection && (
          <button className="btn ghost xs close" title="Back to the overview (Esc)" onClick={toWorld}>
            Close
          </button>
        )}
      </header>
      {tabs && <Tabs tabs={tabs} />}
      <div className="panel-scroll">{body}</div>
    </aside>
  );
}

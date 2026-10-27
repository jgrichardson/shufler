import { useState } from 'react';
import type { Station } from '../../types';
import { dispatch, useWorld } from '../../store';
import { duration, tokens } from '../../lib/format';
import { Section, stationLampColor } from './common';
import { requestAction } from '../requestAction';
import { tone } from '../tone';

export function contextColor(pct: number | null | undefined): string {
  if (pct == null) return '#8a8f98';
  if (pct >= 85) return '#e74c3c';
  if (pct >= 70) return '#f39c12';
  return '#2ecc71';
}

export function ContextBar({ pct, wide = false }: { pct: number | null | undefined; wide?: boolean }) {
  if (pct == null) return null;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className={`ctx-bar${wide ? ' wide' : ''}`} title={`Context ${Math.round(p)}% of the auto-compact window`}>
      <span className="ctx-fill" style={{ width: `${p}%`, background: contextColor(p) }} />
    </span>
  );
}

const shortModel = (m: string | null | undefined) => (m ? m.replace(/^claude-/, '').replace(/-(\d)-(\d)$/, ' $1.$2') : null);
const usd = (n: number | null | undefined) => (n == null ? null : `$${n < 10 ? n.toFixed(2) : Math.round(n)}`);

export function TelemetryStrip({ s }: { s: Station }) {
  const t = s.telemetry;
  const pct = t?.context_pct ?? s.context_pct;
  if (!t && pct == null) return <div className="muted telemetry-empty">No telemetry for this session yet.</div>;
  const rl = t?.rate_limit;
  return (
    <div className="telemetry">
      <div className="tele-ctx">
        <span className="tele-label">Context</span>
        <ContextBar pct={pct} wide />
        <span className="tele-val" style={{ color: tone(contextColor(pct)) }}>
          {pct != null ? `${Math.round(pct)}%` : '—'}
        </span>
        {t?.context_tokens != null && <span className="muted">{tokens(t.context_tokens)}{t.context_window ? ` / ${tokens(t.context_window)}` : ''}</span>}
        {pct != null && pct >= 85 && <span className="bad-text tele-warn">compaction soon</span>}
      </div>
      <div className="tele-grid">
        {shortModel(t?.model) && <Cell k="Model" v={shortModel(t?.model)} />}
        {(t?.account_label || s.account) && <Cell k="Account" v={t?.account_label ?? s.account} />}
        {usd(t?.cost_usd_session) && <Cell k="Cost" v={usd(t?.cost_usd_session)} />}
        {rl?.remaining_pct != null && <Cell k="5h limit left" v={`${Math.round(rl.remaining_pct)}%`} warn={rl.remaining_pct < 20} />}
        {t?.uptime_s != null && <Cell k="Uptime" v={duration(t.uptime_s)} />}
        {t?.turns != null && <Cell k="Turns" v={String(t.turns)} />}
        {t?.compactions ? <Cell k="Compactions" v={String(t.compactions)} /> : null}
      </div>
    </div>
  );
}

function Cell({ k, v, warn }: { k: string; v: string | null | undefined; warn?: boolean }) {
  return (
    <div className="tele-cell">
      <span className="tele-label">{k}</span>
      <span className={`tele-val${warn ? ' bad-text' : ''}`}>{v}</span>
    </div>
  );
}

type SortKey = 'title' | 'group' | 'ctx' | 'cost' | 'tokens' | 'turns' | 'idle';

/** Fleet label for an empty workspace (round 3): it has no title of its own. */
export const emptyWorkspaceLabel = (s: Pick<Station, 'group'>) => `Untitled workspace · ${s.group || 'ungrouped'}`;

export function FleetTable() {
  const all = useWorld((s) => s.snapshot?.stations);
  const stale = useWorld((s) => s.snapshot?.stale_ledger_rows ?? []);
  const stations = all?.filter((s) => !s.empty);
  const empties = all?.filter((s) => s.empty) ?? [];
  const [sort, setSort] = useState<SortKey>('ctx');
  const [desc, setDesc] = useState(true);
  if (!stations) return null;
  const val = (s: Station): number | string => {
    const t = s.telemetry;
    switch (sort) {
      case 'title':
        return s.title.toLowerCase();
      case 'group':
        // cmux sidebar order: group, then position within the sidebar
        return `${(s.group ?? '\uffff').toLowerCase()}#${String(s.sidebar_index ?? 9999).padStart(5, '0')}`;
      case 'ctx':
        return t?.context_pct ?? s.context_pct ?? -1;
      case 'cost':
        return t?.cost_usd_session ?? -1;
      case 'tokens':
        return (t?.tokens_in_today ?? 0) + (t?.tokens_out_today ?? 0) || (s.tokens_today ?? -1);
      case 'turns':
        return t?.turns ?? -1;
      case 'idle':
        return s.activity.idle_seconds ?? 1e9;
    }
  };
  const rows = [...stations].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return desc ? -c : c;
  });
  const byAccount = new Map<string, { n: number; cost: number; tok: number }>();
  for (const s of stations) {
    const k = s.telemetry?.account_label ?? s.account ?? 'unknown';
    const a = byAccount.get(k) ?? { n: 0, cost: 0, tok: 0 };
    a.n++;
    a.cost += s.telemetry?.cost_usd_session ?? 0;
    a.tok += (s.telemetry?.tokens_in_today ?? 0) + (s.telemetry?.tokens_out_today ?? 0) || (s.tokens_today ?? 0);
    byAccount.set(k, a);
  }
  const th = (k: SortKey, label: string, num = false) => (
    <th
      className={`${num ? 'num' : ''}${sort === k ? ' sorted' : ''}`}
      onClick={() => {
        if (sort === k) setDesc(!desc);
        else {
          setSort(k);
          setDesc(k !== 'title' && k !== 'group');
        }
      }}
    >
      {label}
      {sort === k ? (desc ? ' ↓' : ' ↑') : ''}
    </th>
  );
  return (
    <div className="panel-body">
      <div className="fleet-totals">
        {[...byAccount.entries()].map(([k, a]) => (
          <div key={k} className="fleet-total">
            <span className="tele-label">{k}</span>
            <span>
              <b>{a.n}</b> sessions · <b>{usd(a.cost) ?? '$0'}</b> · <b>{tokens(a.tok)}</b> tokens today
            </span>
          </div>
        ))}
      </div>
      <div className="fleet-wrap">
        <table className="fleet">
          <thead>
            <tr>
              {th('title', 'Session')}
              {th('group', 'Group')}
              {th('ctx', 'Context')}
              {th('cost', 'Cost', true)}
              {th('tokens', 'Tokens', true)}
              {th('turns', 'Turns', true)}
              {th('idle', 'Idle', true)}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const t = s.telemetry;
              const pct = t?.context_pct ?? s.context_pct;
              return (
                <tr key={s.id} onClick={() => dispatch({ type: 'select', selection: { kind: 'station', id: s.id } })}>
                  <td className="fleet-name" title={s.title}>
                    <span className="state-dot" style={{ background: stationLampColor(s), width: 8, height: 8 }} /> {s.title}
                    <div className="fleet-sub">{[shortModel(t?.model), t?.account_label ?? s.account].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="fleet-group">{s.group ? s.group.replace(/_/g, ' ') : '—'}</td>
                  <td>
                    <div className="fleet-ctx">
                      <ContextBar pct={pct} />
                      <span style={{ color: tone(contextColor(pct)) }}>{pct != null ? `${Math.round(pct)}%` : '—'}</span>
                    </div>
                  </td>
                  <td className="num">{usd(t?.cost_usd_session) ?? '—'}</td>
                  <td className="num">{tokens((t?.tokens_in_today ?? 0) + (t?.tokens_out_today ?? 0) || s.tokens_today) || '—'}</td>
                  <td className="num">{t?.turns ?? '—'}</td>
                  <td className="num">{s.activity.status === 'active' ? 'now' : duration(s.activity.idle_seconds)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {empties.length > 0 && (
        <Section title="Empty workspaces" className="fleet-section">
          {empties.map((s) => (
            <div key={s.id} className="fleet-extra">
              <span>{emptyWorkspaceLabel(s)}</span>
              <button className="btn xs" onClick={() => requestAction('focus', { station_id: s.id })}>
                Focus
              </button>
            </div>
          ))}
        </Section>
      )}
      {stale.length > 0 && (
        <Section title="Stale ledger rows" className="fleet-section">
          {stale.map((r) => (
            <div key={`${r.ledger_path}:${r.branch}`} className="fleet-extra">
              <span>
                <b>{r.title || r.branch}</b>
                <div className="fleet-sub">
                  {r.area} · branch {r.branch} · {r.ledger_path}
                </div>
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

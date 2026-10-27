import type { Station, Workpiece } from '../../types';
import { isClosed, sessionCount } from '../../lib/derive';
import { areaLabel } from '../../lib/domains';
import { capOn, useCaps, useWorld } from '../../store';
import { openTerminal } from '../terminals';
import { STATE_COLOR } from '../../lib/colors';
import { ago, duration, tokens } from '../../lib/format';
import { requestAction } from '../requestAction';
import { DomainChip, ItemRow, KV, Section, stationLampColor } from './common';
import { DecisionCard } from './DecisionCard';
import { DispatchBox } from './DispatchBox';
import { SkillButtons } from './SkillButtons';
import { TelemetryStrip } from './Telemetry';
import { DomainMove, domainTarget } from './DomainMove';
import { ContextSection } from '../library/ContextSection';
import { tone } from '../tone';
import { stationCommands } from '../commands';
import { InlineCommand } from '../CommandForm';
import { focusLabel, newTabLabel, useTerminalName } from '../../lib/terminalName';

export function StationOverview({ s }: { s: Station }) {
  const terminal = useTerminalName();
  const workpieces = useWorld((st) => st.snapshot?.workpieces);
  const items = (workpieces ?? []).filter((w) => w.station_ids.includes(s.id) || w.station_id === s.id) as Workpiece[];
  const focus = items.find((w) => w.id === s.focus_workpiece_id);
  const others = items.filter((w) => w !== focus);
  return (
    <div className="panel-body">
      <div className="item-hero" style={{ borderLeftColor: stationLampColor(s) }}>
        <div className="hero-kicker">
          <DomainChip id={s.domain} />
          <span>{s.ledger_area ? `Area ledger · ${areaLabel(s.ledger_area)}` : 'Session'}</span>
          {s.group && <span className="muted">{s.group.replace(/_/g, ' ')}</span>}
          <span className="muted">{s.account}</span>
        </div>
        <h2>{s.title}</h2>
        {s.anchor_for && <div className="muted">group anchor for {s.anchor_for}</div>}
        {isClosed(s) && <div className="muted">No Claude running in this workspace.</div>}
        {sessionCount(s.claude) >= 2 && (
          <div className="session-list">
            <span className="muted">{sessionCount(s.claude)} Claude sessions:</span>
            {s.claude.sessions.map((id, i) => (
              <span key={id} className="mono session-id" title={id}>
                {id.slice(0, 8)}
                {i === 0 && <span className="muted"> joined</span>}
              </span>
            ))}
          </div>
        )}
        <DomainMove domain={s.domain} reason={s.domain_reason} target={domainTarget({ station: s.id })} disabledReason={s.empty ? 'Untitled workspaces have no title to alias' : undefined} />
        {s.note ? (
          <div className="note-line">
            <span className="state-dot" style={{ background: STATE_COLOR[s.note.state] }} />
            <span className="note-state" style={{ color: tone(STATE_COLOR[s.note.state]) }}>
              {s.note.state}
            </span>
            <span>{s.note.text}</span>
            <span className="muted">{ago(s.note.ts)}</span>
          </div>
        ) : (
          <div className="muted">No session note.</div>
        )}
        <div className="btn-row">
          <button className="btn primary" onClick={() => requestAction('focus', { station_id: s.id })}>
            {focusLabel(terminal)}
          </button>
        </div>
      </div>
      <DecisionCard station={s} />
      <ContextSection s={s} />
      <Section title="Telemetry">
        <TelemetryStrip s={s} />
      </Section>
      <Section title="Activity">
        <KV
          rows={[
            ['Status', s.activity.status === 'stalled' ? <span className="bad-text">stalled</span> : s.activity.status],
            ['Last action', s.activity.last_at ? `${ago(s.activity.last_at)} ago${s.activity.last_tool ? ` · ${s.activity.last_tool}` : ''}` : '—'],
            ['Idle', s.activity.idle_seconds != null ? duration(s.activity.idle_seconds) : ''],
            ['Subagents', s.activity.subagents ? String(s.activity.subagents) : ''],
            ['Tokens today', s.tokens_today ? tokens(s.tokens_today) : ''],
          ]}
        />
        {s.last_assistant_preview && <div className="preview-quote">{s.last_assistant_preview}</div>}
      </Section>
      {focus && (
        <Section title="Working on">
          <ItemRow w={focus} />
        </Section>
      )}
      {others.length > 0 && (
        <Section title={`Also owns · ${others.length}`}>
          {others.map((w) => (
            <ItemRow key={w.id} w={w} />
          ))}
        </Section>
      )}
    </div>
  );
}

export function StationActions({ s }: { s: Station }) {
  const caps = useCaps();
  const terminal = useTerminalName();
  const commands = stationCommands(caps);
  return (
    <div className="panel-body">
      <Section title="Dispatch">
        <DispatchBox stationId={s.id} pr={s.pr_numbers[0]} />
      </Section>
      <SkillButtons where="station" stationId={s.id} title="Session skills" />
      {s.pr_numbers.length > 0 && <SkillButtons where="pr" stationId={s.id} pr={s.pr_numbers[0]} title={`PR skills · #${s.pr_numbers[0]}`} />}
      {commands.length > 0 && (
        <Section title="Commands">
          {commands.map((c) => (
            <div key={c.id} className="cmd-row">
              <div className="subhead" title={c.description}>{c.label}</div>
              <InlineCommand cmd={c} station={s} />
            </div>
          ))}
        </Section>
      )}
      <Section title="Terminal">
        <div className="btn-row wrap">
          {capOn(caps.terminals) && (
            <button className="btn" onClick={() => openTerminal({ title: s.title, station_id: s.id, preset: 'shell_here' })}>
              Open terminal here
            </button>
          )}
          <button className="btn" onClick={() => requestAction('open_tab', { station_id: s.id })}>
            {newTabLabel(terminal)}
          </button>
          <button className="btn" onClick={() => requestAction('focus', { station_id: s.id })}>
            {focusLabel(terminal)}
          </button>
        </div>
      </Section>
    </div>
  );
}

export function StationData({ s }: { s: Station }) {
  return (
    <div className="panel-body">
      <Section title="Facts">
        <KV
          rows={[
            ['Workspace', <span className="mono">{s.ref || s.id}</span>],
            ['Directory', s.cwd ? <span className="mono">{s.cwd.replace(/^\/Users\/[^/]+/, '~')}</span> : ''],
            ['Ports', s.ports.join(', ')],
            ['Session id', s.session_id ? <span className="mono">{s.session_id.slice(0, 8)}</span> : ''],
            ['PRs', s.pr_numbers.map((n) => `#${n}`).join(' ')],
            ['Issues', s.issue_slugs.join(', ')],
            ['Last prompt', s.last_prompt_at ? new Date(s.last_prompt_at).toLocaleString() : ''],
          ]}
        />
      </Section>
      {s.links.length > 0 && (
        <Section title="Why these PRs belong here">
          <KV rows={s.links.map((l) => [`#${l.pr}`, l.source.replace(/_/g, ' ')] as [string, string])} />
        </Section>
      )}
    </div>
  );
}

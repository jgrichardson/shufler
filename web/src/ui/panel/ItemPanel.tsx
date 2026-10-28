import { useState } from 'react';
import type { Workpiece } from '../../types';
import { capOn, useCaps, useWorld } from '../../store';
import { useLeverOff } from '../../lib/terminalCaps';
import { openTerminal } from '../terminals';
import { CI_COLOR, REVIEWER_COLOR, PHASE_ACCENT } from '../../lib/colors';
import { domainDef, PHASE_LABEL } from '../../lib/domains';
import { mergeGate, typedConfirmationMatches } from '../../lib/mergeGate';
import { ago, agoIso } from '../../lib/format';
import { requestAction } from '../requestAction';
import { BallDot, DomainChip, itemLabel, KV, owedText, Section, StationRow } from './common';
import { DispatchBox } from './DispatchBox';
import { SkillButtons } from './SkillButtons';
import { DomainMove, domainTarget } from './DomainMove';
import { tone } from '../tone';
import { REVIEWER_NAME } from '../../lib/brand';

const KIND_LABEL: Record<Workpiece['kind'], string> = { pr: 'Pull request', issue: 'Issue', data_fix: 'Data fix', plan: 'Plan', docs: 'Docs', branch: 'Branch' };

function Gate({ label, value, color, note }: { label: string; value: string; color: string; note?: string }) {
  return (
    <div className="gate-cell">
      <span className="gate-label">{label}</span>
      <span className="gate-value" style={{ color: tone(color) }}>
        <span className="state-dot" style={{ background: color }} />
        {value}
      </span>
      {note && <span className="gate-note">{note}</span>}
    </div>
  );
}

function MergeBox({ w }: { w: Workpiece }) {
  const [typed, setTyped] = useState('');
  const gate = mergeGate(w);
  const typedOk = typedConfirmationMatches(w.pr, typed);
  return (
    <div className="merge-box">
      <div className="merge-head">
        <b>Merge</b>
        {gate.ok ? <span className="ok-text">Gates green</span> : <span className="bad-text">Locked</span>}
      </div>
      {!gate.ok && (
        <ul className="reasons">
          {gate.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="reply-row">
        <input className="input mono" placeholder={`Type ${w.pr} to unlock`} value={typed} disabled={!gate.ok} onChange={(e) => setTyped(e.target.value)} />
        <button
          className="btn danger"
          disabled={!gate.ok || !typedOk}
          title={gate.ok ? (typedOk ? 'Squash-merge into develop' : 'Type the PR number first') : gate.reasons.join(' · ')}
          onClick={() => requestAction('merge', { pr: w.pr!, typed_confirmation: typed.trim() })}
        >
          Merge #{w.pr}
        </button>
      </div>
    </div>
  );
}

export function ItemPanel({ w }: { w: Workpiece }) {
  const caps = useCaps();
  const sendOff = useLeverOff('dispatch');
  const focusOff = useLeverOff('focus');
  const stations = useWorld((s) => s.snapshot?.stations);
  const owners = (stations ?? []).filter((s) => w.station_ids.includes(s.id) || s.id === w.station_id);
  const owner = owners[0];
  const d = domainDef(w.domain);
  const isPr = w.kind === 'pr' && w.pr != null;
  const merged = ['deploy', 'shipped'].includes(w.phase);
  // no reviewer bot configured: its gate row and re-request lever are hidden
  const showReviewer = capOn(caps.reviewer) && w.reviewer !== 'off';
  const reviewerNote = w.reviewer === 'approved' && w.reviewer_at_head === false ? 'approved an older commit' : w.reviewer_loop ? `round ${w.reviewer_loop.round}` : undefined;

  return (
    <div className="panel-body">
      <div className="item-hero" style={{ borderLeftColor: d.color }}>
        <div className="hero-kicker">
          <DomainChip id={w.domain} />
          <span>{KIND_LABEL[w.kind]}</span>
          <span className="phase-name" style={{ color: tone(PHASE_ACCENT[w.phase]) }}>
            {PHASE_LABEL[w.phase]}
          </span>
          {w.phase_since && <span className="muted">for {ago(w.phase_since)}</span>}
          {w.parked && <span className="tag">parked</span>}
          {w.stuck && <span className="tag bad">stuck</span>}
        </div>
        <h2>
          <span className="mono">{itemLabel(w)}</span> {w.title}
        </h2>
        <div className={`owed-line ball-${w.ball.who}`}>
          <BallDot w={w} size={11} />
          {owedText(w)}
        </div>
        <DomainMove domain={w.domain} reason={w.domain_reason} target={w.pr != null ? domainTarget({ pr: w.pr }) : null} />
      </div>

      {isPr && (
        <Section title={showReviewer ? 'Gates' : 'Checks'}>
          <div className="gates">
            <Gate label="CI" value={w.ci} color={CI_COLOR[w.ci]} note={w.failed_run_ids.length ? `${w.failed_run_ids.length} failed run${w.failed_run_ids.length > 1 ? 's' : ''}` : undefined} />
            {showReviewer && <Gate label={REVIEWER_NAME} value={w.reviewer.replace('_', ' ')} color={w.reviewer === 'approved' && w.reviewer_at_head === false ? '#f39c12' : REVIEWER_COLOR[w.reviewer]} note={reviewerNote} />}
            <Gate
              label="Mergeable"
              value={w.mergeable === 'CONFLICTING' ? 'conflicts' : w.mergeable === 'MERGEABLE' ? 'clean' : 'unknown'}
              color={w.mergeable === 'CONFLICTING' ? '#e74c3c' : w.mergeable === 'MERGEABLE' ? '#2ecc71' : '#a69ea6'}
              note={w.draft ? 'draft' : undefined}
            />
          </div>
          <div className="btn-row wrap">
            {w.mergeable === 'CONFLICTING' && owner && (
              <button className="btn" disabled={!!sendOff} title={sendOff ?? undefined} onClick={() => requestAction('dispatch', { station_id: owner.id, text: `#${w.pr}: merge the base branch in, resolve the conflicts, run the affected tests, push.` })}>
                Dispatch: resolve conflicts
              </button>
            )}
            {w.reviewer === 'changes_requested' && owner && (
              <button className="btn" disabled={!!sendOff} title={sendOff ?? undefined} onClick={() => requestAction('dispatch', { station_id: owner.id, text: `#${w.pr}: fix the review findings, push, then re-request review.` })}>
                Dispatch: fix review findings
              </button>
            )}
            {showReviewer && capOn(caps.reviewer_retrigger) && (
              <button className="btn" onClick={() => requestAction('reviewer_retrigger', { pr: w.pr! })}>
                Re-request review
              </button>
            )}
            <button className="btn" disabled={w.ci !== 'failure'} title={w.ci === 'failure' ? '' : 'Only failed runs can be re-run'} onClick={() => requestAction('ci_rerun', { pr: w.pr! })}>
              Re-run CI
            </button>
            {w.draft ? (
              <button className="btn" onClick={() => requestAction('pr_ready', { pr: w.pr! })}>
                Mark ready
              </button>
            ) : (
              !merged && (
                <button className="btn" onClick={() => requestAction('pr_draft', { pr: w.pr! })}>
                  Back to draft
                </button>
              )
            )}
          </div>
          {!merged && <MergeBox w={w} />}
        </Section>
      )}

      {isPr && <SkillButtons where="pr" stationId={w.station_ids[0] ?? w.station_id ?? null} pr={w.pr} title="PR skills" />}

      {isPr && (
        <Section title="Preview">
          <div className="btn-row wrap">
            <button className="btn" onClick={() => requestAction('open_pr', w.url ? { pr: w.pr!, url: w.url } : { pr: w.pr! })}>
              Open PR
            </button>
            {capOn(caps.preview) && (
              <button className="btn" onClick={() => requestAction('open_preview', { pr: w.pr! })}>
                Open preview
              </button>
            )}
            {capOn(caps.terminals) && (caps.terminal_presets ?? ['preview_console']).includes('preview_console') && (
              <button className="btn" onClick={() => openTerminal({ title: `Preview #${w.pr}`, preset: 'preview_console', pr: w.pr! })}>
                Preview console
              </button>
            )}
          </div>
        </Section>
      )}

      {merged && (
        <Section title="Deploy and close-out">
          <KV
            rows={[
              ['Merged', w.merged_at ? `${agoIso(w.merged_at)} ago` : '—'],
              ['Deployed', w.deployed_at ? `${agoIso(w.deployed_at)} ago` : 'not yet'],
              ['Close-out', w.closeout_owed ? 'owed to the reporter' : 'sent or not needed'],
            ]}
          />
          <div className="btn-row wrap">
            {w.closeout_owed && (
              <button className="btn primary" disabled={!!sendOff} title={sendOff ?? undefined} onClick={() => requestAction('postmerge', { pr: w.pr!, ...(owner ? { station_id: owner.id } : {}) })}>
                Draft close-out message
              </button>
            )}
          </div>
        </Section>
      )}

      {(w.board_stage || w.issue_slug) && (
        <Section title="Board">
          <KV
            rows={[
              ['Issue', w.issue_slug ?? '—'],
              ['Board stage', w.board_stage ?? '—'],
            ]}
          />
        </Section>
      )}

      {w.ledger && (w.ledger.next || w.ledger.state) && (
        <Section title="Ledger">
          <KV
            rows={[
              ['State', w.ledger.state ?? ''],
              ['Ball', w.ledger.ball ?? ''],
              ['Next', w.ledger.next ?? ''],
            ]}
          />
        </Section>
      )}

      <Section title="Managed by">
        {owners.length === 0 && <div className="muted">No session has claimed this yet.</div>}
        {owners.map((s) => (
          <div key={s.id} className="owner-row">
            <StationRow s={s} items={[]} />
            <button className="btn xs" disabled={!!focusOff} title={focusOff ?? undefined} onClick={() => requestAction('focus', { station_id: s.id })}>
              Focus
            </button>
          </div>
        ))}
      </Section>

      {owner && (
        <Section title="Deliver news">
          <DispatchBox stationId={owner.id} pr={w.pr} prefix={w.pr != null ? `#${w.pr}: ` : `${itemLabel(w)}: `} showLibrary placeholder="What changed? It goes to the managing session." sendLabel="Deliver" compact />
        </Section>
      )}

      <Section title="Facts">
        <KV
          rows={[
            ['Id', <span className="mono">{w.id}</span>],
            ['Branch', w.branch ? <span className="mono">{w.branch}</span> : ''],
            ['Size', w.size],
            ['Changes', w.additions != null ? `+${w.additions} / -${w.deletions ?? 0}` : ''],
            ['Labels', w.labels.join(', ')],
            ['Updated', w.updated_at ? `${agoIso(w.updated_at)} ago` : ''],
          ]}
        />
      </Section>
    </div>
  );
}

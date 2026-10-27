/**
 * Normalises whatever the daemon (or the mock) sends into the full v3 snapshot shape.
 * Daemon values always win; anything missing is derived with the CONTRACT "World layout v3"
 * and "Ball in my court" rules so the world works before the daemon ships every field.
 */
import { normalizeLibraryField } from './library';
import { isCommandTitle, isOwnerText, setOwnerConfig } from './owner';
import type {
  Ball,
  Domain,
  Hall,
  Mergeable,
  Phase,
  Snapshot,
  Skill,
  Station,
  StationClaude,
  Workpiece,
  WorkKind,
  YourMove,
  MoveKind,
} from '../types';
import { COMMAND_DOMAIN, DOMAIN_DEFS, FALLBACK, domainDef, domainOrder, matchDomain, normalizePhase, setPipelineStages } from './domains';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const HOUR = 3600;
const MOVE_SEVERITY: Record<MoveKind, number> = { question: 3, merge: 3, reply: 2, note: 2, closeout: 1 };

export type PhaseMemory = Map<string, { phase: Phase; since: number }>;

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isoSec = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t / 1000;
};

export function prScope(title: string | null | undefined): string | null {
  const m = /^\s*\w+\(([^)]+)\)!?:/.exec(title ?? '');
  return m ? m[1] : null;
}

function workKind(raw: Raw): WorkKind {
  const k = raw.kind;
  if (k === 'pr' || k === 'issue' || k === 'data_fix' || k === 'plan' || k === 'docs' || k === 'branch') return k;
  const id = String(raw.id ?? '');
  if (id.startsWith('issue:')) return 'issue';
  if (id.startsWith('fix:')) return 'data_fix';
  if (id.startsWith('plan:')) return 'plan';
  if (id.startsWith('docs:')) return 'docs';
  if (id.startsWith('branch:')) return 'branch';
  return raw.pr != null ? 'pr' : 'issue';
}

function isMerged(w: Raw): boolean {
  return w.stage === 'merged' || w.stage === 'deployed' || !!w.merged_at || w.phase === 'deploy' || w.phase === 'shipped' || w.phase === 'docs';
}
function isDeployed(w: Raw): boolean {
  return w.stage === 'deployed' || !!w.deployed_at;
}

/** Daemon phase mapped onto the current districts (old names forward), else null so the client rule derives it. */
export function daemonPhase(phase: unknown): Phase | null {
  return normalizePhase(phase);
}

const QA_RE = /\bqa\b|\btesters?\b/i;
const PLAN_DOC_RE = /docs\/plans\/|docs\/brainstorms\/|plan[^/\s]*\.md/i;

/** CONTRACT "Phases v4" derivation, first hit wins. Fallback only: the daemon's `phase` wins. */
export function derivePhase(w: Raw, ownerNoteState: string | null, ownerNoteText = ''): Phase {
  const kind = workKind(w);
  const ledger = [w.ledger?.state, w.ledger?.next, w.ledger?.ball, w.ledger?.topic].map((x) => String(x ?? '')).join(' ');
  if (kind !== 'pr' && w.pr == null) {
    const text = `${ledger} ${String(w.state ?? '')} ${String(w.title ?? '')}`;
    if (/\b(closed|done)\b/i.test(String(w.ledger?.state ?? w.state ?? ''))) return 'shipped';
    if (PLAN_DOC_RE.test(text)) return 'plan';
    if (/brainstorm|ideat|explor/i.test(text)) return 'brainstorm';
    return 'plan';
  }
  const merged = isMerged(w);
  const deployed = isDeployed(w);
  if (deployed) return 'shipped';
  if (merged) return 'deploy';
  if (w.stage === 'ready' && w.mergeable !== 'CONFLICTING') return 'merge';
  if (arr<string>(w.labels).some((l) => /preview/i.test(String(l))) || ownerNoteState === 'staging' || QA_RE.test(ledger)) return 'qa';
  const churn = (num(w.additions) ?? -1) + (num(w.deletions) ?? -1);
  if (w.additions != null && w.deletions != null && churn === 0) return 'plan';
  const verdict = (w.reviewer && w.reviewer !== 'none' && w.reviewer !== 'off') || w.review_decision === 'APPROVED' || w.review_decision === 'CHANGES_REQUESTED';
  if (!w.draft && (verdict || w.ci === 'pending' || w.ci === 'failure' || w.stage === 'ready')) return 'review';
  void ownerNoteText;
  return 'build';
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function ballLabel(b: Ball): string {
  switch (b.who) {
    case 'owner':
      return 'You';
    case 'claude':
      return 'Claude';
    case 'reviewer':
      return 'R';
    case 'ci':
      return 'CI';
    case 'person':
      return b.name ? initials(b.name) : 'P';
    case 'testers':
      return 'QA';
    case 'closeout':
      return 'C/O';
    default:
      return '';
  }
}

/** CONTRACT v3 ball rule, first hit wins. A Ready item is the owner's merge to make. */
export function deriveBall(w: Raw, phase: Phase, owner: Station | undefined, ownerItemCount: number): Ball {
  // Phases v4.1: a merged PR waits on the deploy (nobody), a ready one waits on the owner's merge
  if (phase === 'deploy') return { who: 'none', name: null };
  if (phase === 'merge') return { who: 'owner', name: null };
  if (owner?.pending_question) return { who: 'owner', name: null };
  if (owner?.note?.state === 'me') {
    const names = w.pr != null && owner.note.text.includes(`#${w.pr}`);
    if (names || ownerItemCount <= 1) return { who: 'owner', name: null };
  }
  if (w.closeout_owed) return { who: 'closeout', name: null };
  const ledgerBall = String(w.ledger?.ball ?? '').trim();
  if (ledgerBall) {
    if (isOwnerText(ledgerBall)) return { who: 'owner', name: null };
    if (/^review(er)?\b/i.test(ledgerBall)) return { who: 'reviewer', name: null };
    if (/^ci\b/i.test(ledgerBall)) return { who: 'ci', name: null };
    if (/^(claude|agent)\b/i.test(ledgerBall)) return { who: 'claude', name: null };
    if (/^[A-Z][a-z]+/.test(ledgerBall)) return { who: 'person', name: ledgerBall.split(/[\s,;]/)[0] };
  }
  if (phase === 'qa') return { who: 'testers', name: null };
  if (w.ci === 'pending') return { who: 'ci', name: null };
  if (!w.draft && (w.reviewer === 'pending' || w.reviewer_loop?.state === 'waiting_verdict')) return { who: 'reviewer', name: null };
  if (owner?.note?.state === 'working' && owner.activity.status === 'active') return { who: 'claude', name: null };
  return { who: 'none', name: null };
}

function deriveSize(w: Raw): 'S' | 'M' | 'L' {
  if (w.size === 'S' || w.size === 'M' || w.size === 'L') return w.size;
  const a = num(w.additions);
  const d = num(w.deletions);
  if (a == null || d == null) return 'M';
  const n = a + d;
  return n < 150 ? 'S' : n < 800 ? 'M' : 'L';
}

function normStation(s: Raw): Station {
  const activity = s.activity ?? {};
  return {
    id: String(s.id),
    ref: String(s.ref ?? ''),
    title: String(s.title ?? s.id),
    hall_id: s.hall_id ?? null,
    cwd: s.cwd ?? null,
    ports: arr<number>(s.ports),
    session_id: s.session_id ?? null,
    account: s.account ?? null,
    note: s.note && s.note.state ? { state: s.note.state, text: String(s.note.text ?? ''), ts: num(s.note.ts) ?? 0 } : null,
    activity: {
      last_at: num(activity.last_at),
      last_tool: activity.last_tool ?? null,
      subagents: num(activity.subagents) ?? 0,
      idle_seconds: num(activity.idle_seconds),
      status: activity.status === 'active' || activity.status === 'stalled' || activity.status === 'closed' ? activity.status : 'idle',
    },
    pr_numbers: arr<number>(s.pr_numbers),
    issue_slugs: arr<string>(s.issue_slugs),
    last_prompt_at: s.last_prompt_at ?? null,
    tokens_today: num(s.tokens_today),
    color: s.color ?? null,
    domain: typeof s.domain === 'string' ? s.domain : '',
    group: s.group ?? s.hall_id ?? null,
    workpiece_ids: arr<string>(s.workpiece_ids),
    focus_workpiece_id: s.focus_workpiece_id ?? null,
    links: arr(s.links),
    pending_question: s.pending_question && s.pending_question.question ? s.pending_question : null,
    last_assistant_preview: typeof s.last_assistant_preview === 'string' ? s.last_assistant_preview.slice(0, 120) : null,
    issue_events: s.issue_events && typeof s.issue_events === 'object' ? s.issue_events : {},
    telemetry: s.telemetry && typeof s.telemetry === 'object' ? s.telemetry : null,
    context_pct: num(s.context_pct) ?? num(s.telemetry?.context_pct),
    quota_pct: num(s.quota_pct),
    skill_names: arr<string>(s.skill_names),
    empty: s.empty === true,
    claude: stationClaude(s.claude),
    utility: s.utility === true,
    ledger_area: typeof s.ledger_area === 'string' && s.ledger_area.trim() ? s.ledger_area.trim() : null,
    row_order: num(s.row_order),
    sidebar_index: num(s.sidebar_index),
    anchor_for: typeof s.anchor_for === 'string' && s.anchor_for ? s.anchor_for : null,
    domain_source: typeof s.domain_source === 'string' ? s.domain_source : null,
    domain_reason: typeof s.domain_reason === 'string' ? s.domain_reason : null,
  };
}

/**
 * One entry per workpiece id. A ledger row resolving into its PR can briefly arrive beside the PR
 * itself; two entries with one id drew two pods. The PR entry wins, the other fills gaps.
 */
export function dedupeWorkpieces(list: Raw[]): Raw[] {
  const byId = new Map<string, Raw>();
  for (const w of list) {
    const id = wpId(w);
    const seen = byId.get(id);
    if (!seen) {
      byId.set(id, w);
      continue;
    }
    const prFirst = (x: Raw) => (x.kind === 'pr' || x.pr != null ? 1 : 0);
    const [base, extra] = prFirst(w) > prFirst(seen) ? [w, seen] : [seen, w];
    const merged: Raw = { ...base };
    for (const [k, v] of Object.entries(extra)) if (merged[k] == null && v != null) merged[k] = v;
    merged.station_ids = [...new Set([...arr<string>(base.station_ids), ...arr<string>(extra.station_ids)])];
    byId.set(id, merged);
  }
  return [...byId.values()];
}

function wpId(w: Raw): string {
  if (typeof w.id === 'string' && w.id) return w.id;
  if (w.pr != null) return `pr:${w.pr}`;
  return `branch:${w.branch ?? w.title ?? Math.random().toString(36).slice(2)}`;
}

export function normalizeSnapshot(raw: unknown, opts: { now?: number; phaseMemory?: PhaseMemory } = {}): Snapshot {
  const r = (raw ?? {}) as Raw;
  const now = opts.now ?? Date.now() / 1000;
  const memory = opts.phaseMemory;
  setPipelineStages(r.pipeline_stages);
  setOwnerConfig(r.capabilities);
  const halls: Hall[] = arr<Raw>(r.halls).map((h) => ({
    id: String(h.id),
    name: String(h.name ?? h.id),
    color: h.color ?? null,
    station_ids: arr<string>(h.station_ids),
  }));
  const groupOf = new Map<string, string>();
  for (const h of halls) for (const id of h.station_ids) groupOf.set(id, h.id);

  const stations = arr<Raw>(r.stations).map(normStation);
  for (const s of stations) s.group = s.group ?? groupOf.get(s.id) ?? null;
  const stationById = new Map(stations.map((s) => [s.id, s]));

  // ---- workpieces: identity, ownership
  const rawWps = dedupeWorkpieces(arr<Raw>(r.workpieces));
  const ownersOf = new Map<string, string[]>();
  for (const w of rawWps) {
    const id = wpId(w);
    let owners = arr<string>(w.station_ids).filter((x) => stationById.has(x));
    if (!owners.length && w.station_id && stationById.has(w.station_id)) owners = [w.station_id];
    if (!owners.length && w.pr != null) owners = stations.filter((s) => s.pr_numbers.includes(w.pr)).map((s) => s.id);
    if (!owners.length) owners = stations.filter((s) => s.workpiece_ids.includes(id)).map((s) => s.id);
    ownersOf.set(id, owners);
  }
  for (const s of stations) {
    if (!s.workpiece_ids.length) s.workpiece_ids = rawWps.map(wpId).filter((id) => ownersOf.get(id)?.includes(s.id));
  }

  // ---- domains: pass 1 from the item's own signals
  const ownDomain = new Map<string, string | null>();
  for (const w of rawWps) {
    const id = wpId(w);
    const given = typeof w.domain === 'string' && w.domain ? w.domain : null;
    ownDomain.set(
      id,
      given ??
        matchDomain(w.ledger?.area) ??
        matchDomain(prScope(w.title)) ??
        matchDomain(String(w.branch ?? '').replace(/^[^/]+\//, '')) ??
        matchDomain(w.issue_slug) ??
        null,
    );
  }
  // stations: title prefix, then majority of their items, then command hubs, then the fallback
  for (const s of stations) {
    if (s.domain) continue;
    const prefix = s.title.split(' · ')[0];
    if (isCommandTitle(prefix)) {
      s.domain = COMMAND_DOMAIN.id;
      continue;
    }
    const fromTitle = matchDomain(prefix);
    if (fromTitle) {
      s.domain = fromTitle;
      continue;
    }
    const tally = new Map<string, number>();
    for (const id of s.workpiece_ids) {
      const d = ownDomain.get(id);
      if (d) tally.set(d, (tally.get(d) ?? 0) + 1);
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || domainOrder(a[0]) - domainOrder(b[0]))[0];
    if (best) s.domain = best[0];
    else if (String(s.group ?? '').toUpperCase() === 'GENERAL') s.domain = COMMAND_DOMAIN.id;
    else s.domain = matchDomain(s.group) ?? FALLBACK;
  }

  const workpieces: Workpiece[] = rawWps.map((w) => {
    const id = wpId(w);
    const owners = ownersOf.get(id) ?? [];
    const owner = stationById.get(owners[0] ?? '');
    let domain = ownDomain.get(id) ?? null;
    if (!domain && owner && owner.domain !== COMMAND_DOMAIN.id) domain = owner.domain;
    if (!domain) domain = FALLBACK;
    const ownerNote = owner?.note?.state ?? null;
    const ownerNoteText = owner?.note?.text ?? "";
    const phase: Phase = daemonPhase(w.phase) ?? derivePhase(w, ownerNote, ownerNoteText);
    const ball: Ball =
      w.ball && typeof w.ball === 'object' && w.ball.who
        ? { who: w.ball.who, name: w.ball.name ?? null }
        : deriveBall(w, phase, owner, owner?.workpiece_ids.length ?? 0);

    let phaseSince = num(w.phase_since);
    if (phaseSince == null && memory) {
      const prev = memory.get(id);
      if (!prev || prev.phase !== phase) memory.set(id, { phase, since: prev ? now : isoSec(w.updated_at) ?? now });
      phaseSince = memory.get(id)!.since;
    }
    if (phaseSince == null) phaseSince = isoSec(w.updated_at);

    let stuck = typeof w.stuck === 'boolean' ? w.stuck : false;
    if (typeof w.stuck !== 'boolean') {
      const age = phaseSince != null ? now - phaseSince : 0;
      const waitingOnOthers = ball.who !== 'owner' && ball.who !== 'none';
      stuck =
        (waitingOnOthers && ((['review', 'qa', 'merge', 'deploy'].includes(phase) && age > 24 * HOUR) || (phase === 'build' && age > 72 * HOUR))) ||
        owners.some((sid) => stationById.get(sid)?.activity.status === 'stalled');
    }
    const parked =
      typeof w.parked === 'boolean' ? w.parked : /on.?hold|parked/i.test(String(w.ledger?.state ?? '')) || String(owner?.group ?? '').toUpperCase() === 'ON_HOLD';

    return {
      id,
      pr: w.pr ?? null,
      kind: workKind(w),
      title: String(w.title || w.label || (w.pr != null ? `#${w.pr}` : 'Untitled work')),
      url: String(w.url ?? ''),
      branch: String(w.branch ?? ''),
      draft: !!w.draft,
      stage: w.stage ?? 'intake',
      ci: w.ci ?? 'none',
      reviewer: w.reviewer ?? 'none',
      review_decision: w.review_decision ?? null,
      station_id: owners[0] ?? null,
      issue_slug: w.issue_slug ?? null,
      board_stage: w.board_stage ?? null,
      merged_at: w.merged_at ?? null,
      deployed_at: w.deployed_at ?? null,
      shipped_via: num(w.shipped_via),
      updated_at: String(w.updated_at ?? ''),
      reviewer_loop: w.reviewer_loop ?? null,
      domain,
      domain_source: typeof w.domain_source === 'string' ? w.domain_source : null,
      domain_reason: typeof w.domain_reason === 'string' ? w.domain_reason : null,
      phase,
      phase_since: phaseSince,
      stuck,
      parked,
      ball,
      station_ids: owners,
      size: deriveSize(w),
      events: arr(w.events),
      reviewer_at_head: typeof w.reviewer_at_head === 'boolean' ? w.reviewer_at_head : null,
      mergeable: (w.mergeable ?? null) as Mergeable,
      merge_state: w.merge_state ?? null,
      closeout_owed: !!w.closeout_owed || !!w.postmerge_owed,
      labels: arr<string>(w.labels),
      failed_run_ids: arr<number>(w.failed_run_ids),
      ledger: w.ledger ?? null,
      additions: num(w.additions),
      deletions: num(w.deletions),
    };
  });

  // focus item: daemon value, else the first owned item that is not shipped
  for (const s of stations) {
    if (s.focus_workpiece_id && workpieces.some((w) => w.id === s.focus_workpiece_id)) continue;
    const own = workpieces.filter((w) => w.station_ids.includes(s.id) && w.phase !== 'shipped');
    s.focus_workpiece_id = own[0]?.id ?? null;
  }

  // ---- shipped: tag with a domain
  const wpByPr = new Map(workpieces.filter((w) => w.pr != null).map((w) => [w.pr as number, w]));
  const shipped = arr<Raw>(r.shipped).map((x) => ({
    pr: Number(x.pr),
    title: String(x.title ?? ''),
    merged_at: String(x.merged_at ?? ''),
    deployed: !!x.deployed,
    closeout_owed: !!(x.closeout_owed || x.postmerge_owed || wpByPr.get(Number(x.pr))?.closeout_owed),
    domain: typeof x.domain === 'string' && x.domain ? x.domain : wpByPr.get(Number(x.pr))?.domain ?? matchDomain(prScope(x.title)) ?? FALLBACK,
  }));

  // ---- domains / lanes
  let domains: Domain[];
  if (Array.isArray(r.domains) && r.domains.length) {
    domains = arr<Raw>(r.domains).map((d) => {
      const def = domainDef(d.id);
      return {
        id: String(d.id),
        label: String(d.label ?? def.label),
        code: String(d.code ?? def.code),
        color: String(d.color ?? def.color),
        lane: num(d.lane) ?? domainOrder(d.id),
        station_ids: arr<string>(d.station_ids),
        workpiece_ids: arr<string>(d.workpiece_ids),
        counts: { live: num(d.counts?.live) ?? 0, owner: num(d.counts?.owner) ?? 0, parked: num(d.counts?.parked) ?? 0 },
      };
    });
  } else {
    const live = (w: Workpiece) => w.phase !== 'shipped';
    domains = DOMAIN_DEFS.filter((d) => stations.some((s) => s.domain === d.id) || workpieces.some((w) => w.domain === d.id && live(w))).map(
      (d, lane) => {
        const items = workpieces.filter((w) => w.domain === d.id);
        return {
          id: d.id,
          label: d.label,
          code: d.code,
          color: d.color,
          lane,
          station_ids: stations.filter((s) => s.domain === d.id).map((s) => s.id),
          workpiece_ids: items.map((w) => w.id),
          counts: {
            live: items.filter((w) => live(w) && !w.parked).length,
            owner: items.filter((w) => live(w) && w.ball.who === 'owner').length,
            parked: items.filter((w) => live(w) && w.parked).length,
          },
        };
      },
    );
  }
  domains.sort((a, b) => a.lane - b.lane);

  // ---- your move: daemon rows if they carry v2 kinds, else derive the union
  const rawMoves = arr<Raw>(r.your_move);
  const daemonV2 = typeof r.your_move_count === 'number';
  let yourMove: YourMove[] = rawMoves.map((m) => {
    const kind: MoveKind = ['note', 'question', 'closeout', 'merge', 'reply'].includes(m.kind) ? m.kind : 'note';
    return {
      id: typeof m.id === 'string' ? m.id : undefined,
      prs: arr<number>(m.prs),
      kind,
      station_id: m.station_id ?? null,
      pr: num(m.pr),
      workpiece_id: m.workpiece_id ?? (m.pr != null ? `pr:${m.pr}` : null),
      text: String(m.text ?? ''),
      since: num(m.since) ?? now,
      severity: num(m.severity) ?? MOVE_SEVERITY[kind],
      also: arr<MoveKind>(m.also).filter((k) => k !== kind),
      also_ids: arr<unknown>(m.also_ids).filter((x): x is string => typeof x === 'string'),
    };
  });
  if (!daemonV2) {
    const have = new Set(yourMove.map((m) => `${m.kind}:${m.station_id ?? ''}:${m.pr ?? ''}`));
    const add = (m: YourMove) => {
      const key = `${m.kind}:${m.station_id ?? ''}:${m.pr ?? ''}`;
      if (!have.has(key)) {
        have.add(key);
        yourMove.push(m);
      }
    };
    for (const s of stations) {
      if (s.note?.state === 'me') add({ kind: 'note', station_id: s.id, pr: null, text: s.note.text, since: s.note.ts, severity: 2 });
      if (s.pending_question)
        add({ kind: 'question', station_id: s.id, pr: null, text: s.pending_question.question, since: s.activity.last_at ?? now, severity: 3 });
    }
    for (const w of workpieces) {
      if (w.phase === 'merge' && w.kind === 'pr')
        add({ kind: 'merge', station_id: w.station_id, pr: w.pr, workpiece_id: w.id, text: prScope(w.title) ? w.title.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '') : w.title, since: w.phase_since ?? now, severity: 3 });
    }
    // one row per thing: a question supersedes its session's note, and a merge or close-out row supersedes a note naming that PR
    const questionStations = new Set(yourMove.filter((m) => m.kind === 'question').map((m) => m.station_id));
    const prRows = new Set(yourMove.filter((m) => (m.kind === 'merge' || m.kind === 'closeout') && m.pr != null).map((m) => m.pr));
    yourMove = yourMove.filter((m) => {
      if (m.kind !== 'note') return true;
      if (questionStations.has(m.station_id)) return false;
      const named = [...m.text.matchAll(/#(\d{3,6})/g)].map((x) => Number(x[1]));
      return !(named.length > 0 && named.every((n) => prRows.has(n)));
    });
  }
  yourMove.sort((a, b) => b.severity - a.severity || a.since - b.since);

  yourMove = sortMoves(yourMove);
  return {
    type: 'snapshot',
    ts: num(r.ts) ?? now,
    domains,
    your_move_count: daemonV2 ? Number(r.your_move_count) : yourMove.length,
    halls,
    stations,
    workpieces,
    shipped,
    your_move: yourMove,
    sources: r.sources && typeof r.sources === 'object' ? r.sources : {},
    capabilities: r.capabilities && typeof r.capabilities === 'object' ? r.capabilities : {},
    skills: arr<Skill>(r.skills),
    focused_station_id: typeof r.focused_station_id === 'string' ? r.focused_station_id : null,
    events: arr<Raw>(r.events).map((e) => ({
      ts: num(e.ts) ?? now,
      kind: String(e.kind ?? 'phase'),
      pr: num(e.pr),
      workpiece_id: typeof e.workpiece_id === 'string' ? e.workpiece_id : e.pr != null ? `pr:${e.pr}` : null,
      from: e.from != null ? String(e.from) : null,
      to: e.to != null ? String(e.to) : null,
      station_id: typeof e.station_id === 'string' ? e.station_id : null,
      ...(typeof e.text === 'string' ? { text: e.text } : {}),
      ...(e.closeout === true ? { closeout: true } : {}),
    })),
    groups: arr<Raw>(r.groups)
      .filter((g) => g && typeof g.name === 'string')
      .map((g) => ({ name: String(g.name), index: num(g.index) ?? 0, pinned: !!g.pinned, member_count: num(g.member_count) ?? undefined })),
    utility_stations: arr<Raw>(r.utility_stations)
      .filter((u) => u && typeof u.id === 'string' && u.id)
      .map((u) => ({ id: String(u.id), title: String(u.title || u.id) })),
    library: normalizeLibraryField(r.library),
    stale_ledger_rows: arr<Raw>(r.stale_ledger_rows)
      .filter((x) => x && typeof x.branch === 'string')
      .map((x) => ({ ledger_path: String(x.ledger_path ?? ''), area: String(x.area ?? ''), branch: String(x.branch), title: typeof x.title === 'string' ? x.title : null })),
  };
}

/** Items that should glow red in the world: ball is the owner's or they sit in Your move. */
export function needsOwnerIds(snap: Pick<Snapshot, 'workpieces' | 'your_move'>): Set<string> {
  const out = new Set<string>();
  for (const w of snap.workpieces) if (w.ball.who === 'owner' && w.phase !== 'shipped') out.add(w.id);
  // a session note naming a PR makes the session red, not the pod; only item rows (merge, close-out) mark a pod
  for (const m of snap.your_move) if (m.workpiece_id && m.kind !== 'note' && m.kind !== 'question') out.add(m.workpiece_id);
  return out;
}

export function needsOwnerStations(snap: Pick<Snapshot, 'stations' | 'your_move'>): Set<string> {
  const out = new Set<string>();
  const closed = new Set(snap.stations.filter(isClosed).map((s) => s.id));
  for (const s of snap.stations) if (!closed.has(s.id) && (s.note?.state === 'me' || s.pending_question)) out.add(s.id);
  for (const m of snap.your_move) if ((m.kind === 'note' || m.kind === 'question') && m.station_id && !closed.has(m.station_id)) out.add(m.station_id);
  return out;
}

/** Round 9: a workspace with no running Claude process. Drawn dark, hidden with the empty ones, never red. */
export function isClosed(s: { activity?: Pick<Station['activity'], 'status'>; claude?: Pick<StationClaude, 'running'> }): boolean {
  return s.activity?.status === 'closed' || s.claude?.running === false;
}

/** Old snapshots and the mock carry no `claude` block: treat them as one running session. */
export function stationClaude(raw: unknown): StationClaude {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sessions = arr<unknown>(c.sessions).filter((x): x is string => typeof x === 'string' && x.length > 0);
  return {
    running: c.running !== false,
    pid: num(c.pid),
    since: num(c.since),
    sessions,
    count: num(c.count) ?? (c.running === false ? 0 : Math.max(1, sessions.length)),
  };
}

/** How many Claude sessions run in a workspace: processes, or known session ids when that is higher. */
export function sessionCount(c: Pick<StationClaude, 'count' | 'sessions'>): number {
  return Math.max(c.count, c.sessions.length);
}

const ACKABLE: ReadonlySet<string> = new Set(['closeout', 'reply']);

/** Every ack the daemon needs to clear this row: its own id when ackable, plus folded close-out and reply ids. */
export function ackTargets(m: Pick<YourMove, 'id' | 'kind' | 'pr' | 'also_ids'>): { kind: string; id: string }[] {
  const out: { kind: string; id: string }[] = [];
  if (ACKABLE.has(m.kind)) {
    const id = m.id ?? (m.pr != null ? `${m.kind}:${m.pr}` : null);
    if (id) out.push({ kind: m.kind, id });
  }
  for (const id of m.also_ids ?? []) {
    const kind = id.split(':', 1)[0];
    if (ACKABLE.has(kind) && !out.some((t) => t.id === id)) out.push({ kind, id });
  }
  return out;
}

/** Your move order: most severe first, then the newest, so stale notes sink. */
export function sortMoves<T extends Pick<YourMove, 'severity' | 'since'>>(moves: T[]): T[] {
  return [...moves].sort((a, b) => b.severity - a.severity || b.since - a.since);
}

/** Working sessions: the session is active right now, or its note says it is working. */
export function workingCount(stations: Pick<Station, 'activity' | 'note'>[]): number {
  return stations.filter((s) => s.activity?.status === 'active' || s.note?.state === 'working').length;
}

import { describe, expect, it } from 'vitest';
import { ackTargets, ballLabel, daemonPhase, deriveBall, derivePhase, needsOwnerIds, needsOwnerStations, normalizeSnapshot, prScope } from '../src/lib/derive';
import { matchDomain } from '../src/lib/domains';
import type { Station } from '../src/types';

const NOW = 1_800_000_000;

const rawStation = (over: Record<string, unknown> = {}) => ({ id: 'ws-a', title: 'AUTH', pr_numbers: [], ...over });
const rawPr = (over: Record<string, unknown> = {}) => ({ pr: 101, title: 'fix(auth): tidy', ci: 'none', reviewer: 'none', ...over });

describe('derivePhase (Phases v4.1)', () => {
  it('zero-churn PRs and plain non-PR items are in plan', () => {
    expect(derivePhase({ id: 'plan:x', ledger: { state: 'building' } }, null)).toBe('plan');
    expect(derivePhase({ pr: 1, additions: 0, deletions: 0, draft: true }, null)).toBe('plan');
  });

  it('non-PR items: a plan doc is plan, brainstorm words are brainstorm, closed is shipped', () => {
    expect(derivePhase({ id: 'issue:a', ledger: { next: 'write docs/plans/x.md', topic: 'brainstorm' } }, null)).toBe('plan');
    expect(derivePhase({ id: 'issue:a', ledger: { topic: 'ideate on search' } }, null)).toBe('brainstorm');
    expect(derivePhase({ id: 'issue:a', ledger: { state: 'exploring options' } }, null)).toBe('brainstorm');
    expect(derivePhase({ id: 'issue:a', ledger: { state: 'closed' } }, null)).toBe('shipped');
  });

  it('an open PR with commits and no verdict is build; a draft stays build even with red CI', () => {
    expect(derivePhase(rawPr({ draft: true }), null)).toBe('build');
    expect(derivePhase(rawPr(), null)).toBe('build');
    expect(derivePhase(rawPr({ draft: true, ci: 'failure', reviewer: 'pending' }), null)).toBe('build');
  });

  it('a non-draft PR with a verdict, review decision, or CI running/red is review; ready and clean is merge', () => {
    expect(derivePhase(rawPr({ reviewer: 'pending' }), null)).toBe('review');
    expect(derivePhase(rawPr({ review_decision: 'CHANGES_REQUESTED' }), null)).toBe('review');
    expect(derivePhase(rawPr({ ci: 'pending' }), null)).toBe('review');
    expect(derivePhase(rawPr({ ci: 'success', reviewer: 'approved', stage: 'ready' }), null)).toBe('merge');
    expect(derivePhase(rawPr({ ci: 'success', reviewer: 'approved', stage: 'ready', mergeable: 'CONFLICTING' }), null)).toBe('review');
  });

  it('qa comes from a preview label, a staging note or a tester mention', () => {
    expect(derivePhase(rawPr({ labels: ['Preview-Ready'] }), null)).toBe('qa');
    expect(derivePhase(rawPr(), 'staging')).toBe('qa');
    expect(derivePhase(rawPr({ ledger: { ball: 'testers' } }), null)).toBe('qa');
  });

  it('merged is deploy; anything deployed is shipped, close-out owed or not', () => {
    expect(derivePhase(rawPr({ merged_at: 'x' }), null)).toBe('deploy');
    expect(derivePhase(rawPr({ merged_at: 'x', deployed_at: 'y', closeout_owed: true }), null)).toBe('shipped');
    expect(derivePhase(rawPr({ merged_at: 'x', deployed_at: 'y', postmerge_owed: true }), null)).toBe('shipped');
    expect(derivePhase(rawPr({ stage: 'deployed' }), null)).toBe('shipped');
  });

  it('a daemon phase wins; old names map forward and unknown ones fall back', () => {
    expect(daemonPhase('qa')).toBe('qa');
    expect(daemonPhase('ci')).toBe('review');
    expect(daemonPhase('test')).toBe('build');
    expect(daemonPhase('preview')).toBe('qa');
    expect(daemonPhase('ready')).toBe('merge');
    expect(daemonPhase('docs')).toBe('shipped');
    expect(daemonPhase('shipped')).toBe('shipped');
    expect(daemonPhase('nope')).toBeNull();
    expect(daemonPhase(null)).toBeNull();
  });
});

describe('deriveBall', () => {
  const station = (over: Partial<Station> = {}) =>
    ({ pending_question: null, note: null, activity: { status: 'idle' }, workpiece_ids: [], ...over }) as unknown as Station;

  it("a PR ready to merge is the owner's ball, unless it conflicts", () => {
    expect(deriveBall(rawPr({ ci: 'success', reviewer: 'approved', stage: 'ready' }), 'merge', undefined, 0).who).toBe('owner');
    expect(deriveBall(rawPr({ merged_at: 'x', closeout_owed: true }), 'deploy', undefined, 0).who).toBe('none');
  });

  it('a pending question on the owner gives the owner the ball in any phase', () => {
    const owner = station({ pending_question: { question: 'q?', options: [] } });
    expect(deriveBall(rawPr(), 'build', owner, 3).who).toBe('owner');
  });

  it("a 'me' note only claims items it names when the session owns several", () => {
    const owner = station({ note: { state: 'me', text: 'Look at #101', ts: 0 } });
    expect(deriveBall(rawPr({ pr: 101 }), 'build', owner, 3).who).toBe('owner');
    expect(deriveBall(rawPr({ pr: 202 }), 'build', owner, 3).who).not.toBe('owner');
    expect(deriveBall(rawPr({ pr: 202 }), 'build', owner, 1).who).toBe('owner');
  });

  it('close-out owed outranks phase rules', () => {
    expect(deriveBall(rawPr({ closeout_owed: true }), 'shipped', undefined, 0).who).toBe('closeout');
  });

  it('area ledger ball names win over phase heuristics', () => {
    expect(deriveBall({ ledger: { ball: 'me: decide' } }, 'build', undefined, 0).who).toBe('owner');
    expect(deriveBall({ ledger: { ball: 'reviewer bot' } }, 'build', undefined, 0).who).toBe('reviewer');
    expect(deriveBall({ ledger: { ball: 'agent: build it' } }, 'build', undefined, 0).who).toBe('claude');
    expect(deriveBall({ ledger: { ball: 'Dana to test' } }, 'build', undefined, 0)).toEqual({ who: 'person', name: 'Dana' });
  });

  it('falls through to testers, ci, reviewer, claude and none', () => {
    expect(deriveBall(rawPr(), 'qa', undefined, 0).who).toBe('testers');
    expect(deriveBall(rawPr({ ci: 'pending' }), 'review', undefined, 0).who).toBe('ci');
    expect(deriveBall(rawPr({ reviewer: 'pending' }), 'review', undefined, 0).who).toBe('reviewer');
    expect(deriveBall(rawPr({ reviewer: 'pending', draft: true }), 'build', undefined, 0).who).toBe('none');
    const busy = station({ note: { state: 'working', text: '', ts: 0 }, activity: { status: 'active' } as Station['activity'] });
    expect(deriveBall(rawPr(), 'build', busy, 1).who).toBe('claude');
    expect(deriveBall(rawPr(), 'build', undefined, 0).who).toBe('none');
  });

  it('ballLabel shows initials for named people', () => {
    expect(ballLabel({ who: 'owner', name: null })).toBe('You');
    expect(ballLabel({ who: 'person', name: 'Dana Fox' })).toBe('DF');
    expect(ballLabel({ who: 'person', name: null })).toBe('P');
    expect(ballLabel({ who: 'none', name: null })).toBe('');
  });
});

describe('domain matching', () => {
  it('matches whole-token aliases and multi-word aliases', () => {
    expect(matchDomain('Billing cleanup')).toBe('billing');
    expect(matchDomain('search ranking tweaks')).toBe('search');
    expect(matchDomain('terraform plan')).toBe('infra');
    expect(matchDomain('ios release')).toBe('mobile');
  });
  it('short aliases never match inside longer words', () => {
    expect(matchDomain('project planning')).toBeNull();
  });
  it('long aliases accept a short plural suffix', () => {
    expect(matchDomain('invoices')).toBe('billing');
  });
  it('returns null for empty or unrelated text', () => {
    expect(matchDomain(null)).toBeNull();
    expect(matchDomain('')).toBeNull();
    expect(matchDomain('lunch menu')).toBeNull();
  });
  it('prScope reads the conventional-commit scope', () => {
    expect(prScope('fix(mobile): thing')).toBe('mobile');
    expect(prScope('feat(a-b)!: thing')).toBe('a-b');
    expect(prScope('no scope here')).toBeNull();
    expect(prScope(null)).toBeNull();
  });
});

describe('normalizeSnapshot', () => {
  it('fills v3 fields on a minimal v2 payload', () => {
    const s = normalizeSnapshot({ stations: [rawStation({ pr_numbers: [101] })], workpieces: [rawPr({ ci: 'success', reviewer: 'approved', stage: 'ready' })] }, { now: NOW });
    const w = s.workpieces[0];
    expect(w).toMatchObject({ id: 'pr:101', kind: 'pr', domain: 'auth', phase: 'merge', size: 'M', parked: false, station_id: 'ws-a' });
    expect(w.ball.who).toBe('owner');
    expect(s.stations[0]).toMatchObject({ domain: 'auth', focus_workpiece_id: 'pr:101', skill_names: [], links: [] });
    expect(s.domains.map((d) => d.id)).toEqual(['auth']);
    expect(s.domains[0].counts).toEqual({ live: 1, owner: 1, parked: 0 });
    expect(s.skills).toEqual([]);
    expect(s.focused_station_id).toBeNull();
  });

  it('keeps shipped_via so the dock can say which parent a stacked PR shipped through', () => {
    const s = normalizeSnapshot({ workpieces: [rawPr({ stage: 'deployed', shipped_via: 312 }), rawPr({ pr: 102 })] }, { now: NOW });
    expect(s.workpieces.map((w) => w.shipped_via)).toEqual([312, null]);
  });

  it('survives a null or empty payload', () => {
    expect(normalizeSnapshot(null, { now: NOW })).toMatchObject({ stations: [], workpieces: [], domains: [], your_move_count: 0, ts: NOW });
  });

  it('daemon-provided values win over derived ones', () => {
    const s = normalizeSnapshot(
      {
        stations: [rawStation({ domain: 'mobile' })],
        workpieces: [
          rawPr({ ci: 'success', reviewer: 'approved', domain: 'docs', phase: 'review', ball: { who: 'reviewer', name: null }, size: 'L', stuck: true, parked: true, phase_since: 42 }),
        ],
        domains: [{ id: 'docs', lane: 7, counts: { live: 9, owner: 8, parked: 7 } }],
      },
      { now: NOW },
    );
    expect(s.stations[0].domain).toBe('mobile');
    expect(s.workpieces[0]).toMatchObject({ domain: 'docs', phase: 'review', size: 'L', stuck: true, parked: true, phase_since: 42 });
    expect(s.workpieces[0].ball).toEqual({ who: 'reviewer', name: null });
    expect(s.domains).toHaveLength(1);
    expect(s.domains[0]).toMatchObject({ id: 'docs', lane: 7, counts: { live: 9, owner: 8, parked: 7 } });
  });

  it('sizes by churn when not given', () => {
    const size = (additions: number, deletions: number) => normalizeSnapshot({ workpieces: [rawPr({ additions, deletions })] }, { now: NOW }).workpieces[0].size;
    expect(size(10, 10)).toBe('S');
    expect(size(300, 100)).toBe('M');
    expect(size(900, 100)).toBe('L');
  });

  it('control-tower session titles map to the command domain, unknown ones to unassigned', () => {
    const s = normalizeSnapshot({ stations: [rawStation({ id: 'a', title: 'CONTROL' }), rawStation({ id: 'b', title: 'lunch menu' }), rawStation({ id: 'c', title: 'TRIAGE' })], capabilities: { command_titles: ['TRIAGE'] } }, { now: NOW });
    expect(s.stations.find((x) => x.id === 'a')?.domain).toBe('command');
    expect(s.stations.find((x) => x.id === 'b')?.domain).toBe('unassigned');
    expect(s.stations.find((x) => x.id === 'c')?.domain).toBe('command');
  });

  it('a stalled owner marks its items stuck', () => {
    const s = normalizeSnapshot(
      { stations: [rawStation({ pr_numbers: [101], activity: { status: 'stalled' } })], workpieces: [rawPr()] },
      { now: NOW },
    );
    expect(s.workpieces[0].stuck).toBe(true);
  });

  it('remembers when an item entered a phase via phaseMemory', () => {
    const memory = new Map();
    const first = normalizeSnapshot({ workpieces: [rawPr({ draft: true, updated_at: new Date((NOW - 500) * 1000).toISOString() })] }, { now: NOW, phaseMemory: memory });
    expect(first.workpieces[0].phase_since).toBe(NOW - 500);
    const later = normalizeSnapshot({ workpieces: [rawPr({ ci: 'pending' })] }, { now: NOW + 100, phaseMemory: memory });
    expect(later.workpieces[0].phase).toBe('review');
    expect(later.workpieces[0].phase_since).toBe(NOW + 100);
  });
});

describe('your move', () => {
  const owner = (over: Record<string, unknown>) => rawStation({ pr_numbers: [101], ...over });

  it('a question supersedes its own station note, other stations keep theirs', () => {
    const s = normalizeSnapshot(
      {
        stations: [
          owner({ id: 'ws-a', note: { state: 'me', text: 'Need a call', ts: 5 }, pending_question: { question: 'Which option?', options: [] } }),
          rawStation({ id: 'ws-b', title: 'MOBILE', note: { state: 'me', text: 'Please check', ts: 6 } }),
        ],
      },
      { now: NOW },
    );
    const rows = s.your_move.map((m) => `${m.kind}:${m.station_id}`).sort();
    expect(rows).toEqual(['note:ws-b', 'question:ws-a']);
    expect(s.your_move_count).toBe(2);
  });

  it('a merge row supersedes a note naming that PR, but not a note naming another PR', () => {
    const s = normalizeSnapshot(
      {
        stations: [
          owner({ id: 'ws-a', note: { state: 'me', text: 'Merge #101 when ready', ts: 5 } }),
          rawStation({ id: 'ws-b', title: 'MOBILE', note: { state: 'me', text: 'Review #999', ts: 6 } }),
        ],
        workpieces: [rawPr({ ci: 'success', reviewer: 'approved', stage: 'ready', title: 'fix(auth): tidy things' })],
      },
      { now: NOW },
    );
    const kinds = s.your_move.map((m) => `${m.kind}:${m.pr ?? m.station_id}`).sort();
    expect(kinds).toEqual(['merge:101', 'note:ws-b']);
    expect(s.your_move.find((m) => m.kind === 'merge')?.text).toBe('tidy things');
  });

  it('never invents a close-out row; the daemon your_move list is the source', () => {
    const s = normalizeSnapshot({ stations: [], workpieces: [rawPr({ merged_at: 'x', deployed_at: 'y', closeout_owed: true })] }, { now: NOW });
    expect(s.your_move.filter((m) => m.kind === 'closeout')).toEqual([]);
  });

  it('a note naming several PRs survives unless every one has a row', () => {
    const s = normalizeSnapshot(
      {
        stations: [owner({ note: { state: 'me', text: 'Merge #101 and #555', ts: 5 } })],
        workpieces: [rawPr({ ci: 'success', reviewer: 'approved', stage: 'ready' })],
      },
      { now: NOW },
    );
    expect(s.your_move.map((m) => m.kind).sort()).toEqual(['merge', 'note']);
  });

  it('sorts by severity then newest first', () => {
    const s = normalizeSnapshot(
      {
        stations: [
          rawStation({ id: 'ws-a', note: { state: 'me', text: 'older', ts: 1 } }),
          rawStation({ id: 'ws-b', title: 'MOBILE', note: { state: 'me', text: 'newer', ts: 9 } }),
          rawStation({ id: 'ws-c', title: 'SEARCH', pending_question: { question: 'Q', options: [] } }),
        ],
      },
      { now: NOW },
    );
    expect(s.your_move.map((m) => m.text)).toEqual(['Q', 'newer', 'older']);
  });

  it('skips dedupe and derivation entirely when the daemon sends your_move_count', () => {
    const s = normalizeSnapshot(
      {
        your_move_count: 7,
        your_move: [
          { kind: 'question', station_id: 'ws-a', text: 'Q', since: 1 },
          { kind: 'note', station_id: 'ws-a', text: 'Merge #101', since: 2 },
        ],
        stations: [owner({ id: 'ws-a', note: { state: 'me', text: 'extra derived row', ts: 5 } })],
        workpieces: [rawPr({ ci: 'success', reviewer: 'approved' })],
      },
      { now: NOW },
    );
    expect(s.your_move_count).toBe(7);
    expect(s.your_move.map((m) => m.kind)).toEqual(['question', 'note']);
  });

  it('needsOwner helpers include ball holders and your-move rows', () => {
    const s = normalizeSnapshot(
      {
        stations: [owner({ id: 'ws-a', note: { state: 'me', text: 'x', ts: 1 } }), rawStation({ id: 'ws-b', title: 'MOBILE' })],
        workpieces: [rawPr({ ci: 'success', reviewer: 'approved' })],
      },
      { now: NOW },
    );
    expect([...needsOwnerIds(s)]).toContain('pr:101');
    expect([...needsOwnerStations(s)]).toEqual(['ws-a']);
  });
});

describe('ackTargets', () => {
  it('acks the row itself when it is a close-out or reply', () => {
    expect(ackTargets({ id: 'closeout:258', kind: 'closeout', pr: 258, also_ids: [] })).toEqual([{ kind: 'closeout', id: 'closeout:258' }]);
  });
  it('acks folded close-outs on a session row, never the note itself', () => {
    expect(ackTargets({ id: 'note:abc', kind: 'note', pr: 278, also_ids: ['closeout:278', 'merge:278'] })).toEqual([{ kind: 'closeout', id: 'closeout:278' }]);
  });
  it('builds the id from kind and PR when the row has none (mock)', () => {
    expect(ackTargets({ kind: 'reply', pr: 7 })).toEqual([{ kind: 'reply', id: 'reply:7' }]);
  });
  it('returns nothing for a plain question', () => {
    expect(ackTargets({ id: 'question:s1', kind: 'question', pr: null, also_ids: [] })).toEqual([]);
  });
});

import { sortMoves, workingCount } from '../src/lib/derive';
import { moveAge } from '../src/lib/format';

describe('your move order and age', () => {
  it('puts severity first, then the newest', () => {
    const r = sortMoves([
      { id: 'old-note', severity: 1, since: 100 },
      { id: 'merge', severity: 3, since: 50 },
      { id: 'new-note', severity: 1, since: 900 },
    ]);
    expect(r.map((m) => m.id)).toEqual(['merge', 'new-note', 'old-note']);
  });
  it('caps the age at 30d+', () => {
    const now = 100 * 86400 * 1000;
    expect(moveAge(now / 1000 - 33 * 86400, now)).toBe('30d+');
    expect(moveAge(now / 1000 - 3600, now)).toBe('1h 0m');
  });
});

describe('working sessions', () => {
  it('counts active sessions and notes that say working, once each', () => {
    expect(
      workingCount([
        { activity: { status: 'active' }, note: { state: 'working' } },
        { activity: { status: 'idle' }, note: { state: 'working' } },
        { activity: { status: 'idle' }, note: { state: 'me' } },
        { activity: { status: 'stalled' }, note: null },
      ] as never),
    ).toBe(2);
  });
});

describe('owner aliases', () => {
  it('a ledger ball naming a configured alias is the owner, and the default alias is me', () => {
    normalizeSnapshot({ capabilities: { owner_aliases: ['priya', 'pk'] } }, { now: NOW });
    expect(deriveBall({ ledger: { ball: 'Priya: merge #12' } }, 'build', undefined, 0).who).toBe('owner');
    expect(deriveBall({ ledger: { ball: 'PK to review' } }, 'build', undefined, 0).who).toBe('owner');
    expect(deriveBall({ ledger: { ball: 'me: decide' } }, 'build', undefined, 0).who).toBe('none');
    normalizeSnapshot({ capabilities: {} }, { now: NOW });
    expect(deriveBall({ ledger: { ball: 'me: decide' } }, 'build', undefined, 0).who).toBe('owner');
    expect(deriveBall({ ledger: { ball: 'Priya to merge #12' } }, 'build', undefined, 0)).toEqual({ who: 'person', name: 'Priya' });
  });
});

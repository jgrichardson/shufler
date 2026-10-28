/**
 * Mock feed shaped like the daemon's raw snapshot (pre-v3 fields plus a few v3 ones),
 * so the client-side derivation is exercised exactly as it is against the live daemon.
 */
import type { NoteState, ActivityStatus } from '../types';
import { setDomainDefs, type DomainDef } from '../lib/domains';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

type StationSeed = {
  id: string;
  title: string;
  group: 'IN_PROGRESS' | 'ON_HOLD' | 'GENERAL';
  state: NoteState | null;
  text: string;
  status: ActivityStatus;
  idle: number;
  tool: string;
  subagents: number;
  prs: number[];
  tokens: number;
  preview: string;
  question?: Raw;
  /** Agent harness; Claude Code unless set. */
  harness?: 'claude' | 'codex';
};

/** The demo team's areas (lane order, colours, aliases), as a daemon config would send them. */
export const MOCK_DOMAINS: DomainDef[] = [
  { id: 'auth', label: 'Auth', code: 'AU', color: '#E3C04B', aliases: ['auth', 'login', 'sso', 'session', 'oauth', 'invite', 'invites'] },
  { id: 'billing', label: 'Billing', code: 'BI', color: '#2BB3A0', aliases: ['billing', 'invoice', 'invoices', 'payments', 'stripe', 'subscription'] },
  { id: 'search', label: 'Search', code: 'SE', color: '#8C94F0', aliases: ['search', 'index', 'ranking', 'query', 'typeahead'] },
  { id: 'mobile', label: 'Mobile', code: 'MO', color: '#D0509A', aliases: ['mobile', 'ios', 'android', 'app'] },
  { id: 'infra', label: 'Infra', code: 'IN', color: '#9CCB4A', aliases: ['infra', 'ci', 'deploy', 'terraform', 'k8s', 'observability', 'cache'] },
  { id: 'docs', label: 'Docs', code: 'DO', color: '#F08C5A', aliases: ['docs', 'readme', 'guide', 'release'] },
  { id: 'unassigned', label: 'Unassigned', code: '??', color: '#8A8F98', aliases: ['unassigned'] },
];

const STATIONS: StationSeed[] = [
  { id: 'ws-fd', title: 'CONTROL', group: 'GENERAL', state: 'working', text: 'Triaging new reports and checking CI', status: 'active', idle: 6, tool: 'Bash', subagents: 2, prs: [], tokens: 1_840_000, preview: 'Triage done; 3 merged PRs picked up from GitHub.' },
  { id: 'ws-pf', title: 'AUTH', group: 'IN_PROGRESS', state: 'working', text: 'Session refresh cleanup on #318; next: QA sweep', status: 'active', idle: 3, tool: 'Edit', subagents: 1, prs: [318, 352, 401], tokens: 2_950_000, preview: 'Updated the session-expiry banner; rerunning the focused tests now.' },
  { id: 'ws-me', title: 'Search ranking', group: 'IN_PROGRESS', state: 'working', text: 'Ranking parity layer 4; next: fixture sweep', status: 'stalled', idle: 2700, tool: 'Agent', subagents: 0, prs: [353], tokens: 1_200_000, preview: 'Waiting on the fixture sweep subagent to report back.' },
  {
    id: 'ws-ac', title: 'BILLING', group: 'IN_PROGRESS', state: 'me', text: 'You: decide scope on #384', status: 'idle', idle: 840, tool: 'AskUserQuestion', subagents: 0, prs: [384, 371, 392], tokens: 2_310_000,
    preview: 'The review bot flagged the proration fix as too broad. I need your call before I push.',
    question: {
      question: 'Narrow the automatic proration fix so the review bot can approve #384?',
      header: 'Scope',
      options: [
        { label: 'Narrow it', description: 'Only prorate on plan upgrades; the review bot likely approves next round.', recommended: true },
        { label: 'Keep fixing edge cases', description: 'Stay broad and answer each finding; probably 2 more rounds.' },
        { label: 'Pull item 4 out', description: 'Split the mid-cycle downgrade case into its own PR.' },
      ],
    },
  },
  { id: 'ws-cr', title: 'Invoice emails', group: 'IN_PROGRESS', state: 'waiting', text: 'Priya testing #392 on preview', status: 'idle', idle: 1900, tool: 'Bash', subagents: 0, prs: [392], tokens: 640_000, preview: 'Preview is green. Priya has the walk-through.' },
  { id: 'ws-mf', title: 'INFRA', group: 'IN_PROGRESS', state: 'working', text: 'Cache migration batch 3 of 5; next: Sam sign-off', status: 'active', idle: 2, tool: 'Agent', subagents: 3, prs: [361, 388], tokens: 3_400_000, preview: 'Batch 3 dry run matches on all 41 shards. Running the write batch next.' },
  { id: 'ws-cy', title: 'MOBILE', group: 'IN_PROGRESS', state: 'me', text: 'You: merge #214 when you are ready', status: 'idle', idle: 2200, tool: 'Bash', subagents: 0, prs: [214, 207, 142], tokens: 1_430_000, preview: '#214 is green with the review bot approved at head. Ready for you to merge.' },
  { id: 'ws-sh', title: 'Team invites', group: 'IN_PROGRESS', state: 'me', text: 'You: run the invite cleanup script on production', status: 'idle', idle: 3100, tool: 'Bash', subagents: 0, prs: [386], tokens: 980_000, preview: 'Cleanup step 2 of 3 is ready. Run it in the production shell and send me the output.' },
  { id: 'ws-sp', title: 'Support inbox', group: 'IN_PROGRESS', state: 'working', text: 'Building handoff intake; next: tests', status: 'active', idle: 4, tool: 'Edit', subagents: 1, prs: [356], tokens: 1_120_000, preview: 'Intake form saves; wiring the handoff job next.' },
  { id: 'ws-rl', title: 'Rate limiter', group: 'IN_PROGRESS', state: 'working', text: 'Token bucket for the public API on #411', status: 'active', idle: 5, tool: 'exec', subagents: 0, prs: [411], tokens: 870_000, preview: 'Bucket refills per tenant now; adding the burst tests.', harness: 'codex' },
  {
    id: 'ws-rx', title: 'Search reindex', group: 'IN_PROGRESS', state: 'me', text: 'You: approve the reindex dry run for #413', status: 'idle', idle: 420, tool: 'shell', subagents: 0, prs: [413], tokens: 410_000, harness: 'codex',
    preview: 'The batch job is ready. I need to run the dry run against the staging index.',
    question: {
      question: 'Would you like to run the following command? $ make reindex-dry-run TENANT=demo',
      header: 'Approval',
      kind: 'approval',
      source: 'screen',
      multi_select: false,
      options: [
        { label: 'Yes, proceed', description: 'Reason: the dry run reads the staging search index.', key: 'y' },
        { label: "Yes, and don't ask again for this command", key: 'a' },
        { label: 'No, and tell Codex what to do differently', key: 'Escape' },
      ],
    },
  },
  { id: 'ws-bo', title: 'DOCS', group: 'IN_PROGRESS', state: 'waiting', text: 'Jordan confirming the upgrade guide wording', status: 'idle', idle: 4100, tool: 'Read', subagents: 0, prs: [344], tokens: 520_000, preview: 'Sent Jordan the two wording options; waiting on their pick.' },
  { id: 'ws-db', title: 'Design tokens', group: 'ON_HOLD', state: 'waiting', text: 'Parked until the v2 color tokens ship', status: 'idle', idle: 30000, tool: 'Read', subagents: 0, prs: [327], tokens: 90_000, preview: 'Parked.' },
  { id: 'ws-ap', title: 'Search API v2', group: 'IN_PROGRESS', state: 'staging', text: 'Testers have #366 on preview', status: 'idle', idle: 1300, tool: 'Bash', subagents: 0, prs: [366], tokens: 760_000, preview: 'Preview deployed. Typeahead parity checks pass.' },
  { id: 'ws-fx', title: 'Status page', group: 'IN_PROGRESS', state: 'working', text: 'Building the incident timeline', status: 'active', idle: 1, tool: 'Write', subagents: 2, prs: [405], tokens: 2_100_000, preview: 'Timeline renders; moving to the uptime chart.' },
  { id: 'ws-wj', title: 'Worktree janitor', group: 'GENERAL', state: 'done', text: 'Shipped; nightly job verified', status: 'idle', idle: 30000, tool: 'Bash', subagents: 0, prs: [], tokens: 120_000, preview: 'Done.' },
  { id: 'ws-www', title: 'Account settings step 3', group: 'IN_PROGRESS', state: 'merged', text: 'Merged #297; close-out msg owed', status: 'idle', idle: 640, tool: 'Bash', subagents: 0, prs: [297, 295], tokens: 1_700_000, preview: 'Merged and deploying. Close-out message is drafted below.' },
  { id: 'ws-hr', title: 'Release notes', group: 'GENERAL', state: 'working', text: 'Drafting Thursday release post', status: 'active', idle: 15, tool: 'Write', subagents: 0, prs: [409], tokens: 260_000, preview: 'Draft has 6 bullets; adding screenshots.' },
];

type WpSeed = Raw & { pr: number | null; title: string };

const WPS: WpSeed[] = [
  { pr: 401, title: 'chore(auth): tracking PR for session follow-ups', stage: 'intake', ci: 'none', reviewer: 'none', draft: true, additions: 0, deletions: 0, station: 'ws-pf' },
  { id: 'plan:ranking-parity-v2', pr: null, kind: 'plan', title: 'Plan: ranking parity v2 brainstorm', station: 'ws-me', ledger: { area: 'search', state: 'brainstorm', ball: 'me' } },
  { pr: 352, title: 'feat(sso): SAML login for workspace admins', stage: 'build', ci: 'pending', reviewer: 'none', draft: true, station: 'ws-pf', additions: 640, deletions: 210 },
  { pr: 353, title: 'feat(search): ranking fixtures for parity tests', stage: 'build', ci: 'none', reviewer: 'none', draft: true, station: 'ws-me', additions: 120, deletions: 4 },
  { pr: 318, title: 'feat(auth): session refresh cleanup', stage: 'preview', ci: 'success', reviewer: 'pending', draft: false, labels: ['preview'], station: 'ws-pf', additions: 1800, deletions: 600, ledger: { area: 'auth', ball: 'Priya' } },
  { pr: 384, title: 'fix(billing): narrow automatic proration', stage: 'reviewer', ci: 'success', reviewer: 'changes_requested', draft: false, station: 'ws-ac', reviewer_loop: { round: 3, state: 'changes_requested' }, mergeable: 'MERGEABLE', additions: 420, deletions: 90 },
  { pr: 371, title: 'fix(billing): tax rounding on split invoices', stage: 'reviewer', ci: 'failure', reviewer: 'pending', draft: false, station: 'ws-ac', reviewer_loop: { round: 2, state: 'waiting_verdict' }, mergeable: 'CONFLICTING', failed_run_ids: [11873402211], additions: 60, deletions: 12 },
  { pr: 392, title: 'feat(invoices): itemised receipt emails', stage: 'preview', ci: 'success', reviewer: 'approved', reviewer_at_head: false, draft: false, labels: ['preview'], station: 'ws-cr', ledger: { area: 'billing', ball: 'Priya' }, additions: 300, deletions: 40 },
  { pr: 361, title: 'fix(infra): cache migration batch 3', stage: 'ci', ci: 'pending', reviewer: 'approved', reviewer_at_head: true, draft: false, station: 'ws-mf', additions: 220, deletions: 30 },
  { id: 'fix:cache-migration-b4', pr: null, kind: 'data_fix', title: 'Cache migration batch 4 (script)', station: 'ws-mf', ledger: { area: 'infra', state: 'building' } },
  { pr: 388, title: 'docs(infra): cache layer 2.0 close-out notes', stage: 'merged', ci: 'success', reviewer: 'approved', draft: false, station: 'ws-mf', closeout_owed: true, merged: 20 },
  { pr: 214, title: 'feat(mobile): offline mode PR 6', stage: 'ready', ci: 'success', reviewer: 'approved', reviewer_at_head: true, draft: false, station: 'ws-cy', mergeable: 'MERGEABLE', additions: 900, deletions: 300 },
  { pr: 207, title: 'feat(mobile): offline mode relabel', stage: 'preview', ci: 'success', reviewer: 'approved', reviewer_at_head: true, draft: true, labels: ['preview'], station: 'ws-cy', ledger: { area: 'mobile', ball: 'Priya' }, additions: 500, deletions: 100 },
  { pr: 142, title: 'feat(mobile): push notification preferences', stage: 'build', ci: 'success', reviewer: 'none', draft: true, station: 'ws-cy', ledger: { area: 'mobile', ball: 'Jordan', state: 'on hold' }, additions: 1400, deletions: 200 },
  { pr: 386, title: 'feat(auth): automated team invite rules', stage: 'reviewer', ci: 'success', reviewer: 'pending', draft: false, station: 'ws-sh', reviewer_loop: { round: 1, state: 'waiting_verdict' }, additions: 2400, deletions: 800 },
  { id: 'fix:invite-cleanup', pr: null, kind: 'data_fix', title: 'Pending invite cleanup (production script)', station: 'ws-sh', ledger: { area: 'auth', state: 'staging', ball: 'me' } },
  { pr: 356, title: 'feat(support): handoff intake form', stage: 'build', ci: 'none', reviewer: 'none', draft: true, station: 'ws-sp', additions: 260, deletions: 10 },
  { id: 'issue:api-docs-copy-button', pr: null, kind: 'issue', title: 'Priya: API docs copy button drops the last line', station: 'ws-bo', board_stage: 'In progress', ledger: { area: 'docs', state: 'triage' } },
  { pr: 411, title: 'feat(infra): token bucket rate limiter for the public API', stage: 'build', ci: 'pending', reviewer: 'none', draft: true, station: 'ws-rl', additions: 380, deletions: 40 },
  { pr: 413, title: 'fix(search): reindex job batches by tenant', stage: 'build', ci: 'success', reviewer: 'none', draft: true, station: 'ws-rx', additions: 210, deletions: 65 },
  { pr: 344, title: 'feat(docs): upgrade guide wording options', stage: 'reviewer', ci: 'success', reviewer: 'approved', reviewer_at_head: true, draft: false, station: 'ws-bo', ledger: { area: 'docs', ball: 'Jordan' }, mergeable: 'MERGEABLE', additions: 80, deletions: 20 },
  { pr: 327, title: 'feat(mobile): v2 color tokens for cards', stage: 'build', ci: 'success', reviewer: 'none', draft: true, station: 'ws-db', additions: 700, deletions: 50 },
  { pr: 366, title: 'fix(search): v2 API parity for typeahead', stage: 'preview', ci: 'success', reviewer: 'pending', draft: false, labels: ['preview'], station: 'ws-ap', additions: 330, deletions: 120 },
  { pr: 405, title: 'feat(infra): status page incident timeline', stage: 'build', ci: 'none', reviewer: 'none', draft: true, station: 'ws-fx', additions: 4400, deletions: 0 },
  { pr: 297, title: 'fix(settings): profile panel opens with no workspace', stage: 'deployed', ci: 'success', reviewer: 'approved', draft: false, station: 'ws-www', closeout_owed: true, merged: 9, deployed: 7 },
  { pr: 295, title: 'fix(settings): avatar preview uses the active workspace', stage: 'merged', ci: 'success', reviewer: 'approved', draft: false, station: 'ws-www', merged: 3 },
  { id: 'docs:release-notes-oct', pr: null, kind: 'docs', title: 'Release notes post, Oct week 4', station: 'ws-hr', ledger: { area: 'docs', state: 'review' } },
  { pr: 409, title: 'docs(release): Thursday release notes draft', stage: 'intake', ci: 'none', reviewer: 'none', draft: true, station: 'ws-hr', additions: 40, deletions: 0 },
];

const SHIPPED: [number, string, number, boolean][] = [
  [281, 'fix(settings): notification tab keeps workspace', 30, true],
  [289, 'fix(settings): task list takes the active workspace', 26, true],
  [276, 'fix(auth): password reset link expiry', 50, true],
  [284, 'fix(onboarding): setup wizard acts in the active workspace', 40, true],
  [268, 'feat(billing): guard against discarded coupon lines', 60, true],
  [328, 'feat(infra): cache layer 2.0 docs', 74, true],
  [255, 'fix(mobile): pull-to-refresh spinner stuck', 80, true],
  [249, 'fix(search): import keeps diacritics', 90, true],
  [243, 'fix(ui): button focus ring parity', 96, false],
];

const SKILL = (name: string, description: string, extra: Record<string, unknown> = {}) => ({
  name,
  slash: `/${name}`,
  description,
  scope: 'user',
  args_hint: null,
  exposed: true,
  pinned: false,
  target: null,
  args_template: null,
  confirm: 'tap',
  ...extra,
});

export const MOCK_SKILLS = [
  SKILL('issue', 'Intake a reported issue and drive it to a merged fix.', { pinned: true, placement: 'none', target: 'CONTROL', args_template: '{text}', args_hint: '<link, or text>' }),
  SKILL('pr-pre-review', 'Adversarial pre-review gate before asking the review bot.', { pinned: true, placement: 'pr', args_template: '{pr}', args_hint: '[pr#]' }),
  SKILL('review-fix', "Fix the review bot's findings on a PR and re-request review.", { pinned: true, placement: 'pr', args_template: '{pr}', args_hint: '[pr#]' }),
  SKILL('qa-pr', 'Browser QA of a PR on its preview app.', { pinned: true, placement: 'pr', args_template: '{pr}' }),
  SKILL('describe-pr', 'Draft the PR description with stats and screenshots.', { pinned: true, placement: 'pr' }),
  SKILL('code-review', 'Review the current diff for correctness bugs.', { scope: 'configured', pinned: true, placement: 'pr' }),
  SKILL('release-notes', 'Draft the weekly release notes post.', { pinned: true, placement: 'global', target: 'CONTROL' }),
  SKILL('triage-inbox', 'List the support requests you started that are still open.', { pinned: true, placement: 'global', target: 'CONTROL' }),
  SKILL('ask-docs', 'Ask the project docs a question and read the cited pages.', { pinned: true, placement: 'question', args_template: '{question}', args_hint: '"<question>"' }),
  SKILL('ce-plan', 'Create a structured plan for a multi-step task.', { scope: 'plugin', pinned: true }),
  SKILL('ce-brainstorm', 'Explore requirements before planning.', { scope: 'plugin', pinned: true }),
  SKILL('restart-claude', 'Exit, update Claude Code, and resume this session.', { pinned: true, confirm: 'typed' }),
];

/** Demo board stages, as a configured board would send them. */
export const MOCK_BOARD_STAGES = ['Backlog', 'In progress', 'In review', 'Done'];

/** Demo commands: a global one with a text input and a flag, and a per-session note setter. */
export const MOCK_COMMANDS = [
  {
    id: 'tests',
    label: 'Run tests',
    description: 'Run the test suite, optionally filtered to a path or pattern.',
    scope: 'global',
    confirm: 'tap',
    prod: false,
    inputs: [
      { name: 'filter', label: 'Filter', type: 'text', placeholder: 'path or pattern, e.g. billing', default: '.' },
      { name: 'verbose', label: 'Verbose', type: 'flag' },
    ],
  },
  {
    id: 'note',
    label: 'Session note',
    description: "Set this session's one-line note: who has the ball and what is next.",
    scope: 'station',
    confirm: 'tap',
    prod: false,
    inputs: [
      { name: 'state', label: 'State', type: 'choice', choices: ['working', 'me', 'waiting', 'staging', 'merged', 'done'] },
      { name: 'text', label: 'Note', type: 'text', max: 80, placeholder: '<who has the ball>: <what>' },
    ],
  },
];

function mockTelemetry(i: number, tokens: number, status: string, now: number, harness = 'claude') {
  const ctx = [38, 72, 88, 15, 54, 61, 27, 93, 44, 66, 12, 80, 49, 33, 70, 22, 57][i % 17];
  const codex = harness === 'codex';
  return {
    model: codex ? 'gpt-5.5-codex' : i % 4 === 3 ? 'claude-sonnet-5-5' : 'claude-opus-5-5',
    account_label: codex ? 'codex' : i % 3 === 0 ? 'work' : 'personal',
    account_email_masked: codex ? null : i % 3 === 0 ? 'al…@example.test' : 'sa…@example.test',
    context_pct: ctx,
    context_tokens: Math.round(ctx * 4000),
    context_window: 400000,
    cost_usd_session: Math.round((tokens / 1e6) * 9.5 * 100) / 100,
    tokens_in_today: Math.round(tokens * 0.82),
    tokens_out_today: Math.round(tokens * 0.18),
    rate_limit: { remaining_pct: i % 3 === 0 ? 59 : 37, used_pct: i % 3 === 0 ? 41 : 63, week_used_pct: 28, resets_at: null },
    uptime_s: 3600 * (2 + (i % 9)) + 600 * i,
    session_started_at: now - (3600 * (2 + (i % 9)) + 600 * i),
    transcript_size_bytes: 2_000_000 + i * 830_000,
    turns: status === 'active' ? 40 + i * 7 : 12 + i * 3,
    compactions: ctx > 85 ? 2 : i % 4 === 0 ? 1 : 0,
  };
}

const GROUP_COLORS = { IN_PROGRESS: '#5fa8d3', ON_HOLD: '#9a8fa6', GENERAL: '#c7b28a' };

const TERMINAL_FLAGS = ['can_send', 'can_focus', 'can_read_screen', 'can_open', 'has_groups', 'can_follow'] as const;

/**
 * The mock terminal, from the page URL: `?terminal=none` is the no-terminal mode (every terminal lever off),
 * `?caps_off=can_send,can_focus` turns single flags off on cmux. For checking greyed-out levers without a daemon.
 */
export function mockTerminal(search = typeof window !== 'undefined' ? window.location.search : ''): { kind: string; caps: Record<string, boolean> } {
  const q = new URLSearchParams(search);
  const kind = q.get('terminal') === 'none' ? 'none' : 'cmux';
  const off = new Set((q.get('caps_off') ?? '').split(',').map((x) => x.trim()));
  return { kind, caps: Object.fromEntries(TERMINAL_FLAGS.map((f) => [f, kind !== 'none' && !off.has(f)])) };
}

export function makeMockSnapshot(nowMs = Date.now(), terminal = mockTerminal()): Raw {
  // mock mode never reads /api/config, so the demo team's areas stand in for the configured domains
  setDomainDefs(MOCK_DOMAINS);
  const now = nowMs / 1000;
  const iso = (secAgo: number) => new Date((now - secAgo) * 1000).toISOString();

  const stations = STATIONS.map((s, i) => ({
    id: s.id,
    ref: `workspace:${i + 2}`,
    title: s.title,
    hall_id: s.group,
    cwd: `~/worktrees/widgets/${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    ports: s.status === 'active' ? [3000 + i * 3, 3041 + i] : [],
    session_id: `sess-${s.id}`,
    account: s.harness === 'codex' ? 'codex' : i % 3 === 0 ? 'work' : 'personal',
    harness: s.harness ?? 'claude',
    note: s.state ? { state: s.state, text: s.text, ts: now - s.idle - 120 } : null,
    activity: { last_at: now - s.idle, last_tool: s.tool, subagents: s.subagents, idle_seconds: s.idle, status: s.status },
    pr_numbers: s.prs,
    issue_slugs: s.id === 'ws-bo' ? ['api-docs-copy-button'] : [],
    ledger_area: s.id === 'ws-ac' ? 'billing' : null,
    last_prompt_at: iso(s.idle + 60),
    tokens_today: s.tokens,
    pending_question: s.question ?? null,
    last_assistant_preview: s.preview,
    issue_events: s.id === 'ws-bo' ? { 'api-docs-copy-button': [{ type: 'user_replied', ts: now - 900 }] } : {},
    telemetry: mockTelemetry(i, s.tokens, s.status, now, s.harness),
    context_pct: mockTelemetry(i, s.tokens, s.status, now, s.harness).context_pct,
    quota_pct: i % 3 === 0 ? 41 : 63,
    skill_names: MOCK_SKILLS.map((k) => k.name),
  }));

  const workpieces = WPS.map((w, i) => {
    const { station, merged, deployed, ...rest } = w;
    return {
      ...rest,
      id: w.id ?? `pr:${w.pr}`,
      url: w.pr ? `https://github.com/acme/widgets/pull/${w.pr}` : '',
      branch: w.pr ? `feat/${String(w.title.split(':')[1] ?? w.pr).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36)}` : '',
      draft: !!w.draft,
      stage: w.stage ?? 'build',
      ci: w.ci ?? 'none',
      reviewer: w.reviewer ?? 'none',
      reviewer_at_head: w.reviewer_at_head ?? (w.reviewer === 'approved' ? true : null),
      review_decision: w.reviewer === 'approved' ? 'APPROVED' : w.reviewer === 'changes_requested' ? 'CHANGES_REQUESTED' : 'REVIEW_REQUIRED',
      mergeable: w.mergeable ?? (merged ? null : 'UNKNOWN'),
      closeout_owed: !!w.closeout_owed,
      labels: w.labels ?? [],
      failed_run_ids: w.failed_run_ids ?? [],
      station_id: station,
      issue_slug: w.kind === 'issue' ? String(w.id).slice(6) : null,
      board_stage: w.board_stage ?? null,
      merged_at: merged ? iso(merged * 3600) : null,
      deployed_at: deployed ? iso(deployed * 3600) : null,
      updated_at: iso(1200 + i * 3900 + (w.pr === 318 ? 3 * 86400 : 0)),
      reviewer_loop: w.reviewer_loop ?? null,
    };
  });

  const halls = (['IN_PROGRESS', 'ON_HOLD', 'GENERAL'] as const).map((g) => ({
    id: g,
    name: g,
    color: GROUP_COLORS[g],
    station_ids: stations.filter((s) => s.hall_id === g).map((s) => s.id),
  }));

  return {
    type: 'snapshot',
    ts: now,
    halls,
    stations,
    workpieces,
    shipped: SHIPPED.map(([pr, title, h, dep]) => ({ pr, title, merged_at: iso(h * 3600), deployed: dep })),
    your_move: [],
    capabilities: {
      product: 'Shufler',
      terminal: terminal.kind,
      terminal_caps: terminal.caps,
      agent: 'claude-code',
      agents: ['claude', 'codex'],
      scm: 'github',
      reviewer: true,
      reviewer_retrigger: true,
      tracker: ['intake', 'ledgers', 'board'],
      issue_set: true,
      session_notes: true,
      deploys: true,
      preview: true,
      intake: true,
      terminals: true,
      skills: true,
      skills_config_writable: true,
      terminal_presets: ['local_console', 'preview_console', 'prod_console', 'shell_here'],
      owner_aliases: ['me'],
      board_stages: MOCK_BOARD_STAGES,
      command_titles: ['CONTROL'],
      commands: MOCK_COMMANDS,
    },
    skills: MOCK_SKILLS,
    focused_station_id: null,
    sources: {
      [terminal.kind]: { ok: true, age: 1.2 },
      groups: { ok: true, age: 8 },
      notes: { ok: true, age: 1.9 },
      transcripts: { ok: true, age: 0.4 },
      gh: { ok: true, age: 38 },
      deploys: { ok: true, age: 95 },
      issues: { ok: true, age: 6 },
      ledgers: { ok: true, age: 21 },
      board: { ok: false, error: 'board timed out' },
      reviewer_watch: { ok: true, age: 12 },
    },
  };
}

const DEMO_PHASES = ['plan', 'build', 'qa', 'review', 'merge', 'deploy'] as const;
/** One demo cycle: each district once, then a tick in the warehouse. */
const DEMO_CYCLE = DEMO_PHASES.length + 1;
export const DEMO_PR = 409;
const BOUNCE_PR = 384;

const demoPhase = (tick: number) => (tick % DEMO_CYCLE < DEMO_PHASES.length ? DEMO_PHASES[tick % DEMO_CYCLE] : 'shipped');
/** The bounce PR reaches Review, then the review bot sends it back to Build. */
const bouncePhase = (tick: number) => (tick % 4 === 1 || tick % 4 === 2 ? 'build' : 'review');

/**
 * Advances the mock world one tick: the demo PR rides the skyway through every district and onto
 * the warehouse, a second PR bounces back from Review to Build, active sessions burn tokens, idle ones age,
 * and every move is logged in events[] like the daemon does.
 */
export function tickMockSnapshot(prev: Raw, tick: number, nowMs = Date.now()): Raw {
  const now = nowMs / 1000;
  const phase = demoPhase(tick);
  const stations = prev.stations.map((s: Raw) => {
    const active = s.activity.status === 'active';
    const idle = active ? Math.floor(Math.random() * 20) : (s.activity.idle_seconds ?? 0) + 6;
    return {
      ...s,
      activity: { ...s.activity, idle_seconds: idle, last_at: now - idle },
      tokens_today: (s.tokens_today ?? 0) + (active ? 4000 + Math.floor(Math.random() * 9000) : 0),
    };
  });
  const events: Raw[] = [...(prev.events ?? [])];
  const log = (w: Raw, from: string, to: string) => {
    if (from !== to) events.push({ ts: now, kind: 'phase', pr: w.pr, workpiece_id: w.id, from, to, station_id: w.station_id ?? null });
  };
  const workpieces = prev.workpieces.map((w: Raw) => {
    if (w.pr === DEMO_PR) {
      log(w, w.phase ?? 'plan', phase);
      const idx = DEMO_PHASES.indexOf(phase as (typeof DEMO_PHASES)[number]);
      return {
        ...w,
        phase,
        state: phase === 'shipped' ? 'merged' : 'open',
        merged_at: idx >= 5 || phase === 'shipped' ? new Date(nowMs - 60_000).toISOString() : null,
        deployed_at: phase === 'shipped' ? new Date(nowMs).toISOString() : null,
        ci: phase === 'build' ? 'pending' : 'success',
        reviewer: idx >= 3 || phase === 'shipped' ? 'approved' : 'pending',
        closeout_owed: phase === 'shipped',
        stage: phase === 'merge' ? 'ready' : phase === 'deploy' ? 'merged' : phase === 'shipped' ? 'deployed' : 'reviewer',
        mergeable: 'MERGEABLE',
      };
    }
    if (w.pr === BOUNCE_PR) {
      const to = bouncePhase(tick);
      log(w, w.phase ?? 'review', to);
      return { ...w, phase: to, ci: to === 'build' ? 'pending' : 'success' };
    }
    return w;
  });
  const demo = workpieces.find((w: Raw) => w.pr === DEMO_PR);
  const others = (prev.shipped ?? []).filter((x: Raw) => x.pr !== DEMO_PR);
  const shipped = phase === 'shipped' && demo ? [{ pr: DEMO_PR, title: demo.title, merged_at: demo.merged_at, deployed: true }, ...others] : others;
  // cmux focus wanders every few ticks so Follow mode has something to follow
  const focusIds = ['ws-ac', 'ws-cy', 'ws-pf'].filter((id) => stations.some((x: Raw) => x.id === id));
  const focused_station_id = tick % 4 === 3 && focusIds.length ? focusIds[Math.floor(tick / 4) % focusIds.length] : prev.focused_station_id ?? null;
  return { ...prev, ts: now, stations, workpieces, shipped, events: events.slice(-200), focused_station_id };
}

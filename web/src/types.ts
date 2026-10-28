export type NoteState = 'working' | 'me' | 'waiting' | 'staging' | 'merged' | 'done';
export type ActivityStatus = 'active' | 'idle' | 'stalled' | 'closed';

/** Round 9: the Claude processes running in a workspace; the joined session is first. */
export interface StationClaude {
  running: boolean;
  pid: number | null;
  since: number | null;
  sessions: string[];
  /** Running Claude processes, including any with no known session. */
  count: number;
}
export type Stage = 'intake' | 'build' | 'reviewer' | 'ci' | 'preview' | 'ready' | 'merged' | 'deployed';
export type CiState = 'pending' | 'success' | 'failure' | 'none';
/** `off`: no reviewer bot is configured, so its gate is skipped. */
export type ReviewerState = 'approved' | 'changes_requested' | 'pending' | 'none' | 'off';
/** CONTRACT "Phases v4" districts, plus `shipped` (dock and warehouse). */
export type Phase = 'brainstorm' | 'plan' | 'build' | 'qa' | 'review' | 'merge' | 'deploy' | 'shipped';
export type BallWho = 'owner' | 'claude' | 'reviewer' | 'ci' | 'person' | 'testers' | 'closeout' | 'none';
export type WorkKind = 'pr' | 'issue' | 'data_fix' | 'plan' | 'docs' | 'branch';
export type Mergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null;

export interface Ball {
  who: BallWho;
  name: string | null;
}

export interface Domain {
  id: string;
  label: string;
  code: string;
  color: string;
  lane: number;
  station_ids: string[];
  workpiece_ids: string[];
  counts: { live: number; owner: number; parked: number };
}

export interface PendingQuestion {
  question: string;
  header?: string | null;
  /** Codex approvals: each option's keystroke ("y", "a", "Escape"). */
  options: { label: string; description?: string | null; recommended?: boolean; key?: string | null }[];
  /** "approval" for a harness permission prompt, "input" for a question; absent on older snapshots. */
  kind?: string | null;
  /** "screen" when read off the terminal, "transcript" when from the transcript file. */
  source?: string | null;
}

export interface StationLink {
  pr: number;
  source: string;
  since?: number | null;
}

export interface Hall {
  id: string;
  name: string;
  color: string | null;
  station_ids: string[];
}

export interface StationNote {
  state: NoteState;
  text: string;
  ts: number;
}

export interface StationActivity {
  last_at: number | null;
  last_tool: string | null;
  subagents: number;
  idle_seconds: number | null;
  status: ActivityStatus;
}

export interface Telemetry {
  model: string | null;
  account_label: string | null;
  account_email_masked: string | null;
  context_pct: number | null;
  context_tokens: number | null;
  context_window: number | null;
  cost_usd_session: number | null;
  tokens_in_today: number | null;
  tokens_out_today: number | null;
  rate_limit: { remaining_pct?: number | null; used_pct?: number | null; week_used_pct?: number | null; resets_at?: string | null; as_of?: string | number | null } | null;
  uptime_s: number | null;
  session_started_at: string | number | null;
  transcript_size_bytes: number | null;
  turns: number | null;
  compactions: number | null;
}

export interface Skill {
  name: string;
  slash: string;
  description: string;
  scope: 'user' | 'plugin' | 'project' | 'configured';
  args_hint: string | null;
  source_path?: string | null;
  exposed: boolean;
  pinned: boolean;
  target: string | null;
  args_template: string | null;
  confirm: ConfirmLevel;
  aliases?: string[];
  /** Where its button shows: session panel, PR panel, world panel, question answers, or nowhere. */
  placement?: SkillPlacement;
}

export type SkillPlacement = 'station' | 'pr' | 'global' | 'question' | 'none';

export interface CommandInput {
  name: string;
  label: string;
  type: 'text' | 'choice' | 'flag';
  choices?: string[];
  max?: number;
  multiline?: boolean;
  placeholder?: string;
  default?: string;
  /** May be left empty (the daemon then drops its argument). */
  optional?: boolean;
}

/** A user-configured command (config `[[commands]]`), run through the `run_command` action. */
export interface CommandDef {
  id: string;
  label: string;
  description: string;
  scope: 'global' | 'station';
  confirm: ConfirmLevel;
  /** Touches production: the confirm panel shows in the red style. */
  prod: boolean;
  inputs: CommandInput[];
}

export interface Capabilities {
  product?: string;
  terminal?: string | null;
  agent?: string | null;
  /** Agent harnesses the daemon watches, e.g. ["claude", "codex"]. */
  agents?: string[];
  scm?: string | null;
  reviewer?: boolean;
  reviewer_retrigger?: boolean;
  tracker?: string[];
  issue_set?: boolean;
  session_notes?: boolean;
  deploys?: boolean;
  preview?: boolean;
  intake?: boolean;
  terminals?: boolean;
  skills?: boolean;
  skills_config_writable?: boolean;
  terminal_presets?: string[];
  /** Lower-case names that mean the person running the app (default `me`). */
  owner_aliases?: string[];
  /** The board's stage names; empty when the board is off. */
  board_stages?: string[];
  /** Upper-case workspace titles configured as the control room. */
  command_titles?: string[];
  commands?: CommandDef[];
}

export interface Station {
  id: string;
  ref: string;
  title: string;
  hall_id: string | null;
  cwd: string | null;
  ports: number[];
  session_id: string | null;
  /** The agent account name from config ([[agent.accounts]] name), e.g. "personal". */
  account: string | null;
  /** Agent harness of the session: "claude" or "codex". Absent in old snapshots (read as claude). */
  harness?: string | null;
  note: StationNote | null;
  activity: StationActivity;
  pr_numbers: number[];
  issue_slugs: string[];
  last_prompt_at: string | null;
  tokens_today?: number | null;
  color?: string | null;
  domain: string;
  /** Round 3: untitled workspace with no session and no activity in 24 h; hidden by default. */
  empty?: boolean;
  /** Round 9: running Claude processes; absent in old snapshots, normalised to running. */
  claude: StationClaude;
  /** Round 9: shared utility workspaces; no row, no domain. */
  utility?: boolean;
  /** Area ledger of the session's agent process (from its environment), else null. */
  ledger_area: string | null;
  /** Round 10: world row order from the daemon (ledger sessions, the control room, then sidebar order). */
  row_order: number | null;
  /** 0-based position in the cmux sidebar across all workspaces. */
  sidebar_index?: number | null;
  /** Set when this workspace is a cmux group's anchor that runs a live session. */
  anchor_for?: string | null;
  domain_source?: string | null;
  /** Why it sits in its domain, e.g. "PR scope `billing`". */
  domain_reason?: string | null;
  group: string | null;
  workpiece_ids: string[];
  focus_workpiece_id: string | null;
  links: StationLink[];
  pending_question: PendingQuestion | null;
  last_assistant_preview?: string | null;
  issue_events?: Record<string, { type: string; ts: number }[]>;
  telemetry: Telemetry | null;
  context_pct: number | null;
  quota_pct: number | null;
  skill_names: string[];
}

export interface ReviewerLoop {
  round: number;
  state: string;
}

export interface Workpiece {
  /** Raw phase waiting out the hysteresis window; `phase` is what the world shows. */
  phase_pending?: Phase;
  /** Stable id: "pr:412", "issue:<slug>", "fix:<slug>", "plan:<slug>", "docs:<slug>", "branch:<name>". */
  id: string;
  pr: number | null;
  kind: WorkKind;
  domain: string;
  domain_source?: string | null;
  domain_reason?: string | null;
  phase: Phase;
  phase_since: number | null;
  stuck: boolean;
  parked: boolean;
  ball: Ball;
  station_ids: string[];
  size: 'S' | 'M' | 'L';
  events: { type: string; ts: number }[];
  reviewer_at_head: boolean | null;
  mergeable: Mergeable;
  merge_state?: string | null;
  closeout_owed: boolean;
  labels: string[];
  failed_run_ids: number[];
  ledger?: { area?: string | null; state?: string | null; ball?: string | null; next?: string | null } | null;
  additions?: number | null;
  deletions?: number | null;
  title: string;
  url: string;
  branch: string;
  draft: boolean;
  stage: Stage;
  ci: CiState;
  reviewer: ReviewerState;
  review_decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  station_id: string | null;
  issue_slug: string | null;
  board_stage: string | null;
  merged_at: string | null;
  deployed_at: string | null;
  /** Parent PR whose deploy this stacked PR inherited its shipped state from. */
  shipped_via?: number | null;
  updated_at: string;
  reviewer_loop: ReviewerLoop | null;
}

export interface Shipped {
  pr: number;
  title: string;
  merged_at: string;
  deployed: boolean;
  domain: string;
  /** Phases v4.1: shipped with a close-out still owed; the crate waits on the Shipping Dock, never a phase. */
  closeout_owed?: boolean;
}

export type MotionEventKind = 'phase' | 'ball' | 'note' | 'merge' | 'deploy';

export interface MotionEvent {
  ts: number;
  kind: MotionEventKind | string;
  pr: number | null;
  workpiece_id: string | null;
  from: string | null;
  to: string | null;
  station_id: string | null;
  text?: string;
  /** History: a mapped pre-v4 `docs` move, shown with the close-out chip. */
  closeout?: boolean;
}

export type MoveKind = 'note' | 'question' | 'closeout' | 'merge' | 'reply';

export interface YourMove {
  id?: string;
  prs?: number[];
  kind: MoveKind;
  station_id: string | null;
  pr: number | null;
  workpiece_id?: string | null;
  text: string;
  since: number;
  severity: number;
  /** Kinds of rows the daemon folded into this one (one row per PR). */
  also?: MoveKind[];
  /** Ids of the folded rows, so a folded close-out or reply can still be acked. */
  also_ids?: string[];
}

export interface SourceStatus {
  ok: boolean;
  age?: number | null;
  error?: string | null;
}

export interface Snapshot {
  type?: 'snapshot';
  ts: number;
  domains: Domain[];
  your_move_count: number;
  halls: Hall[];
  stations: Station[];
  workpieces: Workpiece[];
  shipped: Shipped[];
  your_move: YourMove[];
  sources: Record<string, SourceStatus>;
  capabilities: Capabilities;
  skills: Skill[];
  focused_station_id: string | null;
  /** Last transitions the daemon saw, oldest first (CONTRACT motion events). */
  events: MotionEvent[];
  /** cmux groups in sidebar order; '' is the ungrouped pseudo-group. */
  groups?: { name: string; index: number; pinned: boolean; member_count?: number }[];
  /** Ledger rows naming a branch with no PR, remote branch or worktree. */
  /** Round 9: shared utility workspaces; no row, but terminals and actions still reach them. */
  utility_stations?: { id: string; title: string }[];
  stale_ledger_rows?: { ledger_path: string; area: string; branch: string; title: string | null }[];
  /** Context library: item count and, per station, granted item ids it has not received yet. */
  library: import('./lib/library').LibraryField;
}

export type ActionName =
  | 'focus'
  | 'dispatch'
  | 'reviewer_retrigger'
  | 'ci_rerun'
  | 'pr_ready'
  | 'pr_draft'
  | 'merge'
  | 'open_pr'
  | 'open_preview'
  | 'run_command'
  | 'board_stage'
  | 'issue_set'
  | 'answer_question'
  | 'postmerge'
  | 'board_note'
  | 'new_item'
  | 'ack'
  | 'run_skill'
  | 'open_tab'
  | 'set_domain'
  | 'library_send';

/** `run_command` carries its form as a nested `values` object; everything else is flat. */
export type ActionParams = Record<string, string | number | boolean | Record<string, string | boolean>>;

export type ConfirmLevel = 'none' | 'tap' | 'typed';

export interface ActionPreview {
  command: string | null;
  warnings: string[];
  error?: string | null;
  facts?: Record<string, unknown>;
  url?: string | null;
  confirm?: ConfirmLevel;
}

export interface ActionResult {
  ok: boolean;
  output: string;
  error: string | null;
  /** Sending actions: the daemon read the screen after Return and saw the prompt. */
  landed?: boolean;
  /** Sending actions: the transcript line that shows the prompt. */
  echo?: string;
  /** Refusals: the text already sitting in the session's input box. */
  draft?: string;
}

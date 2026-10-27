import type { ActionName, ActionParams, ActionPreview, ActionResult, ConfirmLevel } from '../types';
import { useWorld } from '../store';
import { composeFor, recordSend } from './library';
import { allCommands, validateValues, type CommandValues } from '../ui/commands';

const CMUX = '/Applications/cmux.app/Contents/Resources/bin/cmux';
const BIN = '~/bin';
const REPO = 'acme/widgets';
const q = (s: unknown) => `"${String(s ?? '').replace(/(["\\$`])/g, '\\$1')}"`;

const CONFIRM: Partial<Record<ActionName, ConfirmLevel>> = { focus: 'none', open_pr: 'none', open_preview: 'none', ack: 'none', merge: 'typed' };

function item(pr: unknown) {
  return useWorld.getState().snapshot?.workpieces.find((w) => w.pr === Number(pr));
}

export function mockPreview(action: ActionName, p: ActionParams): ActionPreview {
  const warnings: string[] = ['Mock mode: nothing will run.'];
  const facts: Record<string, unknown> = {};
  let command: string | null = null;
  let url: string | null = null;
  let error: string | null = null;
  switch (action) {
    case 'focus':
      command = `${CMUX} select-workspace --workspace ${p.station_id}`;
      break;
    case 'open_tab':
      command = `${CMUX} new-surface --workspace ${p.station_id} --type terminal --cwd ${q(p.cwd ?? '~/worktrees/widgets')}`;
      break;
    case 'run_skill': {
      const skills = useWorld.getState().snapshot?.skills ?? [];
      const sk = skills.find((s) => s.name === p.skill || s.aliases?.includes(String(p.skill)));
      if (!sk) {
        error = `unknown skill ${p.skill}`;
        break;
      }
      const station = p.station_id ?? sk.target;
      if (!station) {
        error = `/${sk.name} has no default session; pick one`;
        break;
      }
      let args = String(p.args ?? '');
      if (!args && sk.args_template) {
        const st = useWorld.getState().snapshot?.stations.find((x) => x.id === station || x.title === station);
        const vals: Record<string, unknown> = { pr: p.pr ?? st?.pr_numbers[0], text: p.text, question: p.question, link_or_text: p.link_or_text, link: p.link, station };
        const missing: string[] = [];
        args = sk.args_template.replace(/\{(\w+)\}/g, (_m, k: string) => {
          const v = vals[k];
          if (v == null || v === '') missing.push(k);
          return String(v ?? '');
        });
        if (missing.length) error = `${sk.slash} needs {${missing.join('}, {')}}`;
      }
      const text = `${sk.slash}${args ? ' ' + args : ''}`;
      facts.text = text;
      facts.skill = sk.name;
      if (sk.confirm === 'typed') facts.requires_typed_confirmation = sk.name;
      command = `${CMUX} send --workspace ${station} --surface surface:1 ${q(text)} && ${CMUX} send-key --workspace ${station} --surface surface:1 Return`;
      return { command, url, warnings, error, facts, confirm: sk.confirm };
    }
    case 'dispatch':
    case 'answer_question':
      command = `${CMUX} send --workspace ${p.station_id} --surface surface:1 ${q(p.text)} && ${CMUX} send-key --workspace ${p.station_id} --surface surface:1 Return`;
      if (action === 'answer_question') facts.question = 'pending AskUserQuestion';
      break;
    case 'postmerge': {
      const w = item(p.pr);
      if (w && w.phase !== 'deploy' && w.phase !== 'shipped') error = `#${p.pr} is not merged yet`;
      command = `${CMUX} send --workspace ${p.station_id ?? 'CONTROL'} ${q(`#${p.pr} is merged. Write the short close-out message for the person who reported it.`)} && ${CMUX} send-key Return`;
      break;
    }
    case 'new_item':
      if (!String(p.text ?? '').trim()) error = 'text is required';
      command = `${CMUX} send --workspace CONTROL ${q(p.text)} && ${CMUX} send-key --workspace CONTROL Return`;
      break;
    case 'reviewer_retrigger':
      command = `${BIN}/review-watch retrigger ${p.pr}`;
      break;
    case 'ci_rerun': {
      const run = item(p.pr)?.failed_run_ids[0] ?? 11873402211;
      command = `gh run rerun --failed ${run} --repo ${REPO}`;
      facts.run_id = run;
      break;
    }
    case 'pr_ready':
      command = `gh pr ready ${p.pr} --repo ${REPO}`;
      break;
    case 'pr_draft':
      command = `gh pr ready ${p.pr} --undo --repo ${REPO}`;
      break;
    case 'merge': {
      const w = item(p.pr);
      command = `gh pr merge ${p.pr} --repo ${REPO} --squash`;
      facts.ci = w?.ci ?? 'unknown';
      facts.reviewer = w?.reviewer ?? 'unknown';
      facts.reviewer_at_head = w?.reviewer_at_head ?? null;
      facts.mergeable = w?.mergeable ?? null;
      facts.requires_typed_confirmation = String(p.pr);
      if (w && (w.ci !== 'success' || w.reviewer !== 'approved')) error = `Merge gate closed: CI ${w.ci}, review ${w.reviewer}`;
      break;
    }
    case 'open_pr':
      url = `https://github.com/${REPO}/pull/${p.pr}`;
      break;
    case 'open_preview':
      url = `https://pr-${p.pr}.preview.example.test`;
      break;
    case 'run_command': {
      const cmd = allCommands(useWorld.getState().snapshot?.capabilities).find((c) => c.id === p.command);
      if (!cmd) {
        error = `unknown command ${q(p.command)}`;
        break;
      }
      const values = (p.values ?? {}) as CommandValues;
      if (cmd.scope === 'station' && !p.station_id) error = `${cmd.label} needs a session`;
      error = error ?? validateValues(cmd, values);
      // the demo commands' argv, as a config might define them
      if (cmd.id === 'tests') command = `npm test -- ${q(values.filter || '.')}${values.verbose ? ' --reporter verbose' : ''}`;
      else if (cmd.id === 'note') command = `SESSION_ID=sess-${p.station_id} ${BIN}/session-label ${values.state} ${q(values.text)}`;
      else command = `${BIN}/${cmd.id}`;
      facts.label = cmd.label;
      if (cmd.prod) {
        facts.prod = true;
        warnings.push(`PROD: ${cmd.label} runs against production`);
      }
      if (cmd.confirm === 'typed') facts.requires_typed_confirmation = cmd.id;
      return { command, url, warnings, error, facts, confirm: cmd.confirm };
    }
    case 'board_stage':
      command = `${BIN}/board stage ${p.card_id} ${q(p.stage)}`;
      break;
    case 'board_note':
      command = `${BIN}/board note ${p.card_id} ${q(p.text)}`;
      break;
    case 'issue_set':
      command = `${BIN}/issue set ${p.slug} ${p.key}=${q(p.value)}`;
      break;
    case 'ack':
      command = `# local ack ${p.kind} ${p.id}`;
      break;
    case 'library_send': {
      const ids = String(p.item_ids ?? '').split(/[,\s]+/).filter(Boolean);
      const c = composeFor(String(p.station_id), ids, typeof p.note === 'string' ? p.note : undefined);
      if (!ids.length || c.items.length !== ids.length) {
        error = ids.length ? `no library item ${ids.filter((id) => !c.items.some((i) => i.id === id)).join(', ')}` : 'item_ids is required';
        break;
      }
      let lines = c.lines;
      if (typeof p.text === 'string' && p.text.trim()) {
        // the confirm panel's edit: /add-dir lines first, the rest joined into one prompt (as the daemon does)
        const raw = p.text.split('\n').map((l) => l.trim()).filter(Boolean);
        const prompt = raw.filter((l) => !l.startsWith('/add-dir ')).join(' ');
        lines = [...raw.filter((l) => l.startsWith('/add-dir ')), ...(prompt ? [prompt] : [])];
        if (lines.join('\n') !== c.lines.join('\n')) warnings.push('the message was edited in the confirm panel');
      }
      command = [`${CMUX} list-pane-surfaces --workspace ${p.station_id} --json`, ...lines.flatMap((l) => [`${CMUX} send --workspace ${p.station_id} --surface '<first-terminal-surface>' ${q(l)}`, `${CMUX} send-key --workspace ${p.station_id} --surface '<first-terminal-surface>' Return`]), `${CMUX} read-screen --workspace ${p.station_id} --surface '<first-terminal-surface>' --lines 20`].join('\n');
      if (c.missing.length) warnings.push(`missing on disk: ${c.missing.join(', ')}`);
      if (lines.some((l) => l.startsWith('/add-dir '))) warnings.push('each /add-dir is sent on its own; the send stops if the session is not back at an empty prompt after it');
      Object.assign(facts, { station: useWorld.getState().snapshot?.stations.find((s) => s.id === p.station_id)?.title ?? p.station_id, harness: c.harness, items: c.items.map((i) => i.name).join(', '), message: lines.join('\n'), text: lines[lines.length - 1] });
      break;
    }
    case 'set_domain':
      facts.target = p.target;
      facts.domain = p.domain;
      warnings.push(`adds a manual alias for ${p.target} to ${p.domain}; every item sharing it moves too`);
      break;
    default:
      error = `Unknown action ${action}`;
  }
  return { command, warnings, error, facts, url, confirm: CONFIRM[action] ?? 'tap' };
}

/** Mock sessions with text already typed in their input box, so the refusal path is visible. */
const MOCK_INPUT_DRAFTS: Record<string, string> = { 'ws-hr': 'also add the screenshot for the billing tab' };
const SENDING = new Set<ActionName>(['dispatch', 'answer_question', 'postmerge', 'new_item', 'run_skill', 'library_send']);

export function mockRun(action: ActionName, p: ActionParams): ActionResult {
  const pv = mockPreview(action, p);
  if (pv.error) return { ok: false, output: '', error: pv.error };
  const draft = typeof p.station_id === 'string' ? MOCK_INPUT_DRAFTS[p.station_id] : undefined;
  if (draft && SENDING.has(action)) return { ok: false, output: '', error: 'that session has unsent text in its input; finish or clear it in cmux first', draft };
  switch (action) {
    case 'library_send':
      recordSend(String(p.station_id), String(p.item_ids).split(/[,\s]+/).filter(Boolean));
      return { ok: true, error: null, landed: true, echo: `> ${String(pv.facts?.text ?? '').slice(0, 80)}`, output: `${pv.facts?.message}\n\n(mock read-screen)` };
    case 'run_skill':
      return { ok: true, error: null, landed: true, echo: `> ${pv.facts?.text}`, output: `> ${pv.facts?.text}\n\n(mock read-screen)` };
    case 'dispatch':
    case 'answer_question':
      return { ok: true, error: null, landed: true, echo: `> ${p.text}`, output: `> ${p.text}\n\n⏺ On it. Reading the PR diff and the failing checks first.\n  ⎿  Bash(gh pr checks)\n\n(mock read-screen)` };
    case 'run_command':
      if (p.command === 'tests')
        return {
          ok: true,
          error: null,
          output: JSON.stringify({
            columns: ['file', 'tests', 'passed', 'ms'],
            rows: [
              ['billing/proration.test.ts', 14, 14, 212],
              ['billing/invoice.test.ts', 9, 9, 148],
              ['auth/session.test.ts', 21, 21, 390],
            ],
          }),
        };
      return { ok: true, error: null, output: `${pv.command}\n(mock: ok)` };
    case 'merge':
      return { ok: true, error: null, output: `Squashed and merged pull request #${p.pr} (mock)` };
    case 'ci_rerun':
      return { ok: true, error: null, output: `Requested rerun of failed jobs for run ${pv.facts?.run_id} (mock)` };
    default:
      return { ok: true, error: null, output: `${pv.command ?? pv.url ?? ''}\n(mock: ok)` };
  }
}

export interface Turn {
  ts: number;
  role: 'user' | 'assistant';
  text: string;
  tools: { name: string; summary: string }[];
}

/** Fake transcript so the Conversation tab works without the daemon. */
export function mockConversation(stationId: string, before?: number): { turns: Turn[]; has_more: boolean } {
  const st = useWorld.getState().snapshot?.stations.find((s) => s.id === stationId);
  const pr = st?.pr_numbers[0] ?? 384;
  const end = before ?? Date.now() / 1000;
  const base: Omit<Turn, 'ts'>[] = [
    { role: 'user', text: `Pick up #${pr}. The review bot left two findings, fix both and push.`, tools: [] },
    {
      role: 'assistant',
      text: `Read both findings on **#${pr}**.\n\n1. The totals query ignores \`workspace_id\`, so it sums across workspaces.\n2. The new test builds state with \`update!\`, which breaks the DB-mutation rule.\n\nFixing the query first.`,
      tools: [
        { name: 'Bash', summary: `gh pr view ${pr} --comments` },
        { name: 'Read', summary: 'app/services/invoice_totals.rb' },
      ],
    },
    { role: 'assistant', text: 'Query now filters by workspace. Moved the test setup into a fixture.\n\n```ruby\nscope.where(workspace_id: workspace.id)\n```', tools: [{ name: 'Edit', summary: 'invoice_totals.rb' }, { name: 'Bash', summary: 'bin/rails test test/services/invoice_totals_test.rb' }] },
    { role: 'user', text: 'Good. Push it and re-trigger the review bot.', tools: [] },
    { role: 'assistant', text: `Pushed. Re-triggered the review bot on #${pr}. CI is running.\n\n| Check | State |\n|---|---|\n| Tests | running |\n| Rubocop | pass |`, tools: [{ name: 'Bash', summary: 'git push' }, { name: 'Bash', summary: `review-watch retrigger ${pr}` }] },
  ];
  const page = before ? base.slice(0, 2) : base;
  const turns = page.map((t, i) => ({ ...t, ts: end - (page.length - i) * 240 }));
  return { turns, has_more: !before };
}

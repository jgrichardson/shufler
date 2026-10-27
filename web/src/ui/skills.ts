import type { ActionParams, Skill, SkillPlacement } from '../types';
import { findItem, findStation, useWorld } from '../store';
import { requestAction } from './requestAction';

/** Where a skill's button shows (config `[skills.<name>] placement`); absent means the session panel. */
export const placementOf = (s: Pick<Skill, 'placement'>): SkillPlacement => s.placement ?? 'station';

export function skillByName(name: string): Skill | undefined {
  const skills = useWorld.getState().snapshot?.skills ?? [];
  return skills.find((s) => s.name === name) ?? skills.find((s) => s.aliases?.includes(name));
}

/** Pinned skills placed in one panel context; `none` never shows a button. */
export function pinnedSkills(where: Exclude<SkillPlacement, 'none'>, skills: Skill[] = useWorld.getState().snapshot?.skills ?? []): Skill[] {
  return skills.filter((s) => s.pinned && placementOf(s) === where);
}

/** The station a skill runs in, given the current selection: the selected session, the selected item's owner, else the skill's target. */
export function contextStation(): string | null {
  const sel = useWorld.getState().selection;
  if (sel?.kind === 'station') return sel.id;
  if (sel?.kind === 'item') {
    const w = findItem(sel.id);
    return w?.station_ids[0] ?? w?.station_id ?? null;
  }
  return null;
}

export function contextPr(): number | null {
  const sel = useWorld.getState().selection;
  if (sel?.kind === 'item') return findItem(sel.id)?.pr ?? null;
  if (sel?.kind === 'station') {
    const st = findStation(sel.id);
    return st?.focus_workpiece_id ? findItem(st.focus_workpiece_id)?.pr ?? st.pr_numbers[0] ?? null : st?.pr_numbers[0] ?? null;
  }
  return null;
}

export function runSkill(skill: Skill, opts: { station_id?: string | null; pr?: number | null; args?: string; text?: string } = {}) {
  const params: ActionParams = { skill: skill.name };
  const station = opts.station_id !== undefined ? opts.station_id : contextStation();
  if (station) params.station_id = station;
  const pr = opts.pr !== undefined ? opts.pr : contextPr();
  if (pr != null) params.pr = pr;
  if (opts.args) params.args = opts.args;
  if (opts.text) {
    params.text = opts.text;
    params.question = opts.text;
    params.link_or_text = opts.text;
  }
  requestAction('run_skill', params, `Run ${skill.slash}`);
}

/** Simple fuzzy score: every query char in order; contiguous and word-start matches score higher. */
export function fuzzy(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  if (t.includes(s)) return 100 - t.indexOf(s);
  let ti = 0;
  let score = 0;
  for (const ch of s) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return 0;
    score += i === ti ? 3 : 1;
    ti = i + 1;
  }
  return score;
}

import type { Phase } from '../types';
import { PHASE_ACCENT } from './colors';

export interface DomainDef {
  id: string;
  label: string;
  code: string;
  color: string;
  aliases: string[];
}

/** CONTRACT "World layout v3" domain palette, in fixed lane order. Albedo only; never emissive. */
export const DOMAIN_DEFS: DomainDef[] = [
  { id: 'auth', label: 'Auth', code: 'AU', color: '#E3C04B', aliases: ['auth', 'login', 'sso', 'session', 'oauth'] },
  { id: 'billing', label: 'Billing', code: 'BI', color: '#2BB3A0', aliases: ['billing', 'invoice', 'payments', 'stripe', 'subscription'] },
  { id: 'search', label: 'Search', code: 'SE', color: '#8C94F0', aliases: ['search', 'index', 'ranking', 'query'] },
  { id: 'mobile', label: 'Mobile', code: 'MO', color: '#D0509A', aliases: ['mobile', 'ios', 'android', 'app'] },
  { id: 'infra', label: 'Infra', code: 'IN', color: '#9CCB4A', aliases: ['infra', 'ci', 'deploy', 'terraform', 'k8s', 'observability'] },
  { id: 'docs', label: 'Docs', code: 'DO', color: '#F08C5A', aliases: ['docs', 'readme', 'guide'] },
  { id: 'unassigned', label: 'Unassigned', code: '??', color: '#8A8F98', aliases: ['unassigned'] },
];

/** The daemon's catch-all lane for sessions that match no domain. */
export const FALLBACK = 'unassigned';
export const COMMAND_DOMAIN: DomainDef = { id: 'command', label: 'Control Tower', code: 'CT', color: '#D8C3A0', aliases: [] };

const BY_ID = new Map([...DOMAIN_DEFS, COMMAND_DOMAIN].map((d) => [d.id, d]));

/** Replaces the palette with the daemon's configured domains (lane order, colours, aliases). */
export function setDomainDefs(defs: DomainDef[]) {
  if (!defs.length) return;
  DOMAIN_DEFS.splice(0, DOMAIN_DEFS.length, ...defs);
  BY_ID.clear();
  for (const d of [...DOMAIN_DEFS, COMMAND_DOMAIN]) BY_ID.set(d.id, d);
}

export function domainDef(id: string | null | undefined): DomainDef {
  return BY_ID.get(id ?? '') ?? DOMAIN_DEFS[DOMAIN_DEFS.length - 1];
}

/** Label for an area ledger's area: the domain's label when it is a domain, else the area title-cased. */
export function areaLabel(area: string): string {
  const d = BY_ID.get(area);
  if (d) return d.label;
  return area.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function domainOrder(id: string): number {
  const i = DOMAIN_DEFS.findIndex((d) => d.id === id);
  return i < 0 ? DOMAIN_DEFS.length : i;
}

function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s_\-·/:().,#[\]]+/)
    .filter(Boolean);
}

/**
 * Domain whose alias appears in the text. Multi-word aliases match as consecutive tokens;
 * single-word aliases match a whole token (or a plural/suffixed token for aliases of 5+ letters),
 * so "ci" never matches inside "social".
 */
export function matchDomain(text: string | null | undefined): string | null {
  if (!text) return null;
  const tokens = normalise(text);
  if (!tokens.length) return null;
  const joined = `_${tokens.join('_')}_`;
  for (const d of DOMAIN_DEFS) {
    for (const alias of d.aliases) {
      const parts = alias.split('_');
      if (parts.length > 1) {
        if (joined.includes(`_${alias}_`)) return d.id;
      } else if (tokens.some((t) => t === alias || (alias.length >= 5 && t.startsWith(alias) && t.length <= alias.length + 2))) {
        return d.id;
      }
    }
  }
  return null;
}

export interface PipelineStage {
  id: string;
  label: string;
  color: string;
  description?: string;
}

/** CONTRACT "Phases v4": seven districts, left to right. The snapshot's `pipeline_stages` replaces this list. */
export const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'brainstorm', label: 'Brainstorm', color: '#9aa4b2' },
  { id: 'plan', label: 'Plan', color: '#7c8cf8' },
  { id: 'build', label: 'Build', color: '#f2b544' },
  { id: 'qa', label: 'QA', color: '#45c7e0' },
  { id: 'review', label: 'Review', color: '#f28c38' },
  { id: 'merge', label: 'Merge', color: '#a56cf0' },
  { id: 'deploy', label: 'Deploy', color: '#3dd68c' },
];

/** Pre-v4 phase names mapped forward (replay, old snapshots, mock fixtures). */
/** Phases v4.1: ready is the Merge column; docs (close-out owed) is shipped with a close-out flag. */
export const OLD_PHASE: Record<string, Phase> = { test: 'build', ci: 'review', preview: 'qa', ready: 'merge', docs: 'shipped' };

/** District ids in boulevard order. Mutated in place by setPipelineStages so importers stay live. */
export const PHASES: Exclude<Phase, 'shipped'>[] = DEFAULT_STAGES.map((s) => s.id as Exclude<Phase, 'shipped'>);

/** District names. */
export const PHASE_LABEL: Record<string, string> = { ...Object.fromEntries(DEFAULT_STAGES.map((s) => [s.id, s.label])), shipped: 'Shipped' };
/** Names are short in v4; kept as an alias for narrow places. */
export const PHASE_SHORT = PHASE_LABEL;

/** Tighter names for the narrowest column tags, keyed by lower-case label; anything else keeps its label. */
const TINY: Record<string, string> = { brainstorm: 'Ideas' };
/** The shortest readable name for a district: a known abbreviation, else its label. */
export const phaseTiny = (p: string) => {
  const label = PHASE_LABEL[p] ?? p;
  return TINY[label.toLowerCase()] ?? label;
};

/** District descriptions from pipeline_stages (the daemon's words); empty until it sends them. */
export const PHASE_DESC: Record<string, string> = {};

let stagesKey = DEFAULT_STAGES.map((s) => s.id).join(',');
/** Identity of the current district list, for layout memo keys. */
export const pipelineKey = () => stagesKey;

/** Applies the daemon's `pipeline_stages` (names, colours, order). Ignores malformed input. */
export function setPipelineStages(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  const stages = raw
    .filter((x): x is PipelineStage => !!x && typeof x.id === 'string' && x.id !== 'shipped')
    .map((x) => ({ id: x.id, label: typeof x.label === 'string' && x.label ? x.label : x.id, color: typeof x.color === 'string' ? x.color : '#9aa4b2', description: typeof x.description === 'string' ? x.description : '' }));
  if (!stages.length) return false;
  const key = stages.map((s) => `${s.id}:${s.label}:${s.color}:${s.description}`).join(',');
  if (key === stagesKey) return false;
  stagesKey = key;
  PHASES.splice(0, PHASES.length, ...stages.map((s) => s.id as Exclude<Phase, 'shipped'>));
  for (const k of Object.keys(PHASE_LABEL)) if (k !== 'shipped') delete PHASE_LABEL[k];
  for (const k of Object.keys(PHASE_DESC)) delete PHASE_DESC[k];
  for (const s of stages) {
    if (s.description) PHASE_DESC[s.id] = s.description;
    PHASE_LABEL[s.id] = s.label;
    PHASE_ACCENT[s.id] = s.color;
  }
  return true;
}

/** A phase name the board can draw: current districts as-is, old names mapped forward, else null. */
export function normalizePhase(p: unknown): Phase | null {
  if (typeof p !== 'string') return null;
  if (p === 'shipped' || PHASES.includes(p as Exclude<Phase, 'shipped'>)) return p as Phase;
  const mapped = OLD_PHASE[p];
  return mapped && (PHASES.includes(mapped as Exclude<Phase, 'shipped'>) || mapped === 'shipped') ? mapped : null;
}

/** Width of one district band along the boulevard. */
export const BAND_W = 14;

/** Centre x of a district band (first district at x = 0); shipped sits past the last band. */
export function phaseX(p: string | null | undefined): number {
  const i = PHASES.indexOf(p as Exclude<Phase, 'shipped'>);
  if (i >= 0) return i * BAND_W;
  if (p === 'shipped') return PHASES.length * BAND_W + 2;
  return PHASES.indexOf('build') >= 0 ? PHASES.indexOf('build') * BAND_W : 0;
}

/** Back-compat lookup: GATE_X[phase] reads the live district position. */
export const GATE_X = new Proxy({} as Record<string, number>, { get: (_t, k) => phaseX(String(k)) });

export function phaseIndex(p: string | null | undefined): number {
  const i = PHASES.indexOf(p as Exclude<Phase, 'shipped'>);
  return i < 0 ? (p === 'shipped' ? PHASES.length : 0) : i;
}

import { create } from 'zustand';
import { PROMPTS, type Prompt } from '../ui/prompts';
import { setDomainDefs, setPipelineStages, type DomainDef } from '../lib/domains';

import { PRODUCT_NAME } from '../lib/brand';

/** The product name lives in lib/brand; the daemon's config can rename it. */
export { PRODUCT_NAME };

export interface AppConfig {
  product: string;
  prompts: Prompt[];
  postmergePrompt: string | null;
  /** 'daemon' once GET /api/config answered, else the built-in defaults. */
  source: 'default' | 'daemon';
}

export const DEFAULT_CONFIG: AppConfig = { product: PRODUCT_NAME, prompts: PROMPTS, postmergePrompt: null, source: 'default' };

export const useConfig = create<AppConfig>()(() => DEFAULT_CONFIG);

const words = (t: string) =>
  t
    .replace(/[^\w\s/#-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Daemon prompts are plain strings ("CI is red on #N: …") or {group, label, text}; #N becomes {pr}. */
export function parsePrompts(raw: unknown): Prompt[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: Prompt[] = [];
  for (const p of raw) {
    const text = typeof p === 'string' ? p : p && typeof p === 'object' && typeof (p as Prompt).text === 'string' ? (p as Prompt).text : null;
    if (!text) continue;
    const filled = text.replace(/#N\b/g, '{pr}');
    const obj = typeof p === 'object' ? (p as Partial<Prompt>) : {};
    const label = obj.label ?? words(text).slice(0, 3).join(' ');
    out.push({ group: obj.group ?? label, label, text: filled });
  }
  return out.length ? out : null;
}

export function parseDomains(raw: unknown): DomainDef[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && typeof d.id === 'string')
    .map((d) => ({
      id: String(d.id),
      label: String(d.label ?? d.id),
      code: String(d.code ?? String(d.id).slice(0, 2).toUpperCase()),
      color: typeof d.color === 'string' ? d.color : '#C2B8A6',
      aliases: Array.isArray(d.aliases) ? d.aliases.map(String) : [String(d.id)],
    }));
  return out.length ? out : null;
}

export function parseConfig(raw: unknown): AppConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    product: typeof r.product === 'string' && r.product.trim() ? r.product.trim() : PRODUCT_NAME,
    prompts: parsePrompts(r.canned_prompts) ?? PROMPTS,
    postmergePrompt: typeof r.postmerge_prompt === 'string' ? r.postmerge_prompt : null,
    source: 'daemon',
  };
}

let loading = false;

/** GET /api/config once per connection; mock mode keeps the defaults. */
export async function loadConfig(mock: boolean) {
  if (mock || loading) return;
  loading = true;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const raw = (await res.json()) as Record<string, unknown>;
    const domains = parseDomains(raw.domains);
    if (domains) setDomainDefs(domains);
    setPipelineStages(raw.pipeline_stages);
    useConfig.setState(parseConfig(raw));
  } catch {
    /* keep the defaults */
  } finally {
    loading = false;
  }
}

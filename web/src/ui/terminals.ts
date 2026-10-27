import { create } from 'zustand';
import { toast, useWorld } from '../store';

export interface TermTab {
  id: string;
  title: string;
  wsUrl: string | null;
  prod: boolean;
  prefill: string;
  mock: boolean;
}

interface TermState {
  open: boolean;
  tabs: TermTab[];
  active: string | null;
  setOpen: (open: boolean) => void;
  setActive: (id: string) => void;
}

export const useTerminals = create<TermState>()((set) => ({
  open: false,
  tabs: [],
  active: null,
  setOpen: (open) => set({ open }),
  setActive: (active) => set({ active }),
}));

export const MAX_TERMINALS = 6;

let mockSeq = 1;

/** Opens a PTY through the daemon (or a local echo terminal in mock mode) and shows it in the drawer. */
export async function openTerminal(opts: { title: string; station_id?: string; preset?: string; pr?: number }) {
  const st = useTerminals.getState();
  if (st.tabs.length >= MAX_TERMINALS) {
    toast(false, 'Terminal limit reached', `Close one of the ${MAX_TERMINALS} open terminals first.`);
    useTerminals.setState({ open: true });
    return;
  }
  const prod = opts.preset === 'prod_console';
  if (useWorld.getState().mock) {
    const prefill = prod ? './bin/console production' : opts.preset === 'preview_console' ? `./bin/console preview  # pick the preview for #${opts.pr}` : '';
    const tab: TermTab = { id: `mock-${mockSeq++}`, title: opts.title, wsUrl: null, prod, prefill, mock: true };
    useTerminals.setState((s) => ({ tabs: [...s.tabs, tab], active: tab.id, open: true }));
    return;
  }
  try {
    const body: Record<string, unknown> = {};
    if (opts.station_id) body.station_id = opts.station_id;
    if (opts.preset) body.preset = opts.preset;
    if (opts.pr != null) body.pr = opts.pr;
    const res = await fetch('/api/terminals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const b = (await res.json()) as { ok?: boolean; id?: string; ws_url?: string; prod?: boolean; prefill?: string; error?: string };
    if (!res.ok || !b.ok || !b.id) throw new Error(b.error ?? `HTTP ${res.status}`);
    const tab: TermTab = { id: b.id, title: opts.title, wsUrl: b.ws_url ?? `/term/${b.id}`, prod: !!b.prod || prod, prefill: b.prefill ?? '', mock: false };
    useTerminals.setState((s) => ({ tabs: [...s.tabs, tab], active: tab.id, open: true }));
  } catch (e) {
    toast(false, 'Could not open a terminal', (e as Error).message);
  }
}

export async function closeTerminal(id: string) {
  const tab = useTerminals.getState().tabs.find((t) => t.id === id);
  useTerminals.setState((s) => {
    const tabs = s.tabs.filter((t) => t.id !== id);
    return { tabs, active: s.active === id ? tabs[tabs.length - 1]?.id ?? null : s.active, open: tabs.length > 0 && s.open };
  });
  if (tab && !tab.mock) {
    try {
      await fetch(`/api/terminals/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      /* the daemon closes idle terminals after 2h anyway */
    }
  }
}

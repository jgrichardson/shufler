/**
 * CAPTURE-ONLY focus bridge, used to record the README hero. Inert outside a dev build.
 *
 * With a dev build, `?mock=1` and `?focusbridge=<base>`, the mock "Focus in <terminal>" lever is also forwarded to
 * a real daemon at <base>, so a throwaway terminal switches tabs on camera while the scene shows the demo world.
 * The mock row's title is looked up in that daemon's /api/snapshot and its station is focused. Every other action
 * stays mocked. The daemon accepts only its own origin, so <base> is normally a same-origin path that the capture
 * dev server proxies to the demo daemon. Bases on the default daemon port (4700) or off loopback are refused, so a
 * recording can never drive a real setup.
 */
import { useWorld } from '../store';
import type { ActionParams } from '../types';

const REAL_DAEMON_PORT = '4700';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The bridge base for this page, or null when the bridge is off. */
export function focusBridgeBase(search: string, origin: string, dev: boolean): string | null {
  if (!dev) return null;
  const q = new URLSearchParams(search);
  const raw = q.get('focusbridge');
  if (q.get('mock') !== '1' || !raw) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (!LOOPBACK.has(url.hostname) || url.port === REAL_DAEMON_PORT) return null;
  return url.href.replace(/\/+$/, '');
}

/** Focuses the bridged daemon's station whose title matches. Resolves to whether the daemon accepted it. */
export async function bridgeFocus(base: string, title: string, f: typeof fetch = fetch): Promise<boolean> {
  const snap = (await (await f(`${base}/api/snapshot`)).json()) as { stations?: { id: string; title: string | null }[] };
  const st = snap.stations?.find((s) => s.title === title);
  if (!st) return false;
  const res = await f(`${base}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'focus', params: { station_id: st.id } }),
  });
  return res.ok;
}

/** Called by the mock `focus` action: forwards it when the bridge is on, otherwise does nothing. */
export function forwardMockFocus(params: ActionParams) {
  if (typeof window === 'undefined') return;
  const base = focusBridgeBase(window.location.search, window.location.origin, import.meta.env.DEV);
  if (!base) return;
  const title = useWorld.getState().snapshot?.stations.find((s) => s.id === params.station_id)?.title;
  if (title) bridgeFocus(base, title).catch(() => undefined);
}

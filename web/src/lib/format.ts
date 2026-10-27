export function ago(tsSeconds: number | null | undefined, nowMs = Date.now()): string {
  if (!tsSeconds) return '—';
  return duration(Math.max(0, nowMs / 1000 - tsSeconds));
}

/** Age for Your move rows, capped so month-old notes read "30d+". */
export function moveAge(tsSeconds: number | null | undefined, nowMs = Date.now()): string {
  if (tsSeconds && nowMs / 1000 - tsSeconds >= 30 * 86400) return '30d+';
  return ago(tsSeconds, nowMs);
}

export function agoIso(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '—' : duration(Math.max(0, (nowMs - t) / 1000));
}

export function duration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  // round to whole minutes first, so 59.5m carries into the next hour and 23h 59.5m into the next day
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d`;
}

export function tokens(n: number | null | undefined): string {
  if (n == null) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}


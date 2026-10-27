import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Station } from '../../types';
import { useWorld } from '../../store';
import { onTurn, subscribeStation } from '../../api/ws';
import { mockConversation, type Turn } from '../../mock/actions';
import { Markdown } from './Markdown';
import { CopyButton } from './common';
import { DispatchBox } from './DispatchBox';
import { DecisionCard } from './DecisionCard';

function toTurn(raw: unknown): Turn | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const role = r.role === 'user' ? 'user' : 'assistant';
  const tools = Array.isArray(r.tools) ? (r.tools as { name?: unknown; summary?: unknown }[]).map((t) => ({ name: String(t.name ?? 'tool'), summary: String(t.summary ?? '') })) : [];
  return { ts: Number(r.ts) || Date.now() / 1000, role, text: String(r.text ?? ''), tools };
}

async function fetchPage(stationId: string, before?: number, n = 20): Promise<{ turns: Turn[]; has_more: boolean }> {
  if (useWorld.getState().mock) return mockConversation(stationId, before);
  const qs = new URLSearchParams({ n: String(n) });
  if (before) qs.set('before', String(before));
  const res = await fetch(`/api/stations/${encodeURIComponent(stationId)}/conversation?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { turns?: unknown[]; has_more?: boolean };
  return { turns: (body.turns ?? []).map(toTurn).filter((t): t is Turn => !!t), has_more: !!body.has_more };
}

interface Summary {
  started_at: number | null;
  turns: number;
  pr_links: { pr: number; ts: number }[];
  compactions: number[];
}
interface Hit {
  ts: number;
  role: string;
  snippet: string;
}

async function fetchSummary(stationId: string): Promise<Summary | null> {
  if (useWorld.getState().mock) {
    const now = Date.now() / 1000;
    return { started_at: now - 5 * 3600, turns: 64, pr_links: [{ pr: 412, ts: now - 4 * 3600 }, { pr: 398, ts: now - 2 * 3600 }], compactions: [now - 3 * 3600] };
  }
  const res = await fetch(`/api/stations/${encodeURIComponent(stationId)}/history/summary`);
  if (!res.ok) return null;
  const b = (await res.json()) as Record<string, unknown>;
  const toTs = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'object' && x && 'ts' in x ? Number((x as { ts: unknown }).ts) : Date.parse(String(x)) / 1000);
  return {
    started_at: typeof b.started_at === 'number' ? b.started_at : null,
    turns: Number(b.turns) || 0,
    pr_links: Array.isArray(b.pr_links) ? (b.pr_links as { pr: number; ts: number }[]) : [],
    compactions: Array.isArray(b.compactions) ? (b.compactions as unknown[]).map(toTs).filter((n) => Number.isFinite(n)) : [],
  };
}

async function searchHistory(stationId: string, q: string): Promise<Hit[]> {
  if (useWorld.getState().mock) {
    return mockConversation(stationId)
      .turns.filter((t) => t.text.toLowerCase().includes(q.toLowerCase()))
      .map((t) => ({ ts: t.ts, role: t.role, snippet: t.text.slice(0, 120) }));
  }
  const res = await fetch(`/api/stations/${encodeURIComponent(stationId)}/history/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const b = (await res.json()) as { results?: Hit[] };
  return b.results ?? [];
}

const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Conversation({ station }: { station: Station }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [jumping, setJumping] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const keepOffset = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    setTurns([]);
    setLoading(true);
    setError(null);
    setFollow(true);
    fetchPage(station.id)
      .then((p) => {
        if (!live) return;
        setTurns(p.turns);
        setHasMore(p.has_more);
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false));
    setSummary(null);
    setHits(null);
    setQ('');
    fetchSummary(station.id)
      .then((s) => live && setSummary(s))
      .catch(() => undefined);
    subscribeStation(station.id);
    const off = onTurn((m) => {
      if (m.station_id !== station.id) return;
      const t = toTurn(m.turn);
      if (!t) return;
      setTurns((prev) => [...prev, t]);
      setUnseen((n) => n + 1);
    });
    return () => {
      live = false;
      off();
      subscribeStation(null);
    };
  }, [station.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pendingScroll.current != null) {
      const ts = pendingScroll.current;
      pendingScroll.current = null;
      const target = [...el.querySelectorAll<HTMLElement>('[data-ts]')].find((n) => Number(n.dataset.ts) >= ts - 0.001);
      if (target) {
        el.scrollTop = target.offsetTop - 8;
        setFollow(false);
        setFlash(Number(target.dataset.ts));
        setTimeout(() => setFlash(null), 1600);
      }
      keepOffset.current = null;
    } else if (keepOffset.current != null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (follow) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    }
  }, [turns, follow]);

  const loadEarlier = useCallback(async () => {
    const first = turns[0];
    if (!first) return;
    const el = scroller.current;
    keepOffset.current = el ? el.scrollHeight - el.scrollTop : null;
    try {
      const p = await fetchPage(station.id, first.ts);
      setTurns((prev) => [...p.turns, ...prev]);
      setHasMore(p.has_more);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [turns, station.id]);

  /** Pages backwards until the turn at `ts` is loaded, then scrolls to it. ts = 0 means the very start. */
  const jumpTo = async (ts: number) => {
    setJumping(true);
    try {
      let all = turns;
      let more = hasMore;
      for (let i = 0; i < 40 && more && (all.length === 0 || all[0].ts > ts); i++) {
        const p = await fetchPage(station.id, all[0]?.ts, 200);
        if (!p.turns.length) break;
        all = [...p.turns, ...all];
        more = p.has_more;
      }
      setHasMore(more);
      pendingScroll.current = ts === 0 ? all[0]?.ts ?? 0 : ts;
      setTurns(all);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJumping(false);
    }
  };

  const runSearch = async () => {
    if (!q.trim()) return setHits(null);
    try {
      setHits(await searchHistory(station.id, q.trim()));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const now = Date.now() / 1000;
  const start = summary?.started_at ?? turns[0]?.ts ?? now;
  const span = Math.max(60, now - start);
  const pos = (ts: number) => `${Math.max(0, Math.min(100, ((ts - start) / span) * 100))}%`;

  return (
    <div className="conversation">
      <div className="history-bar">
        <input
          className="input xs"
          placeholder="Search this session…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value) setHits(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <button className="btn xs" disabled={jumping} onClick={() => jumpTo(0)}>
          {jumping ? 'Loading…' : 'Jump to start'}
        </button>
      </div>
      {summary && (
        <div
          className="scrubber"
          title="Click to jump to that point in the session"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            void jumpTo(start + ((e.clientX - r.left) / r.width) * span);
          }}
        >
          <div className="scrub-track" />
          {turns[0] && <div className="scrub-loaded" style={{ left: pos(turns[0].ts), right: 0 }} />}
          {summary.compactions.map((c, i) => (
            <span key={`c${i}`} className="scrub-mark compaction" style={{ left: pos(c) }} title={`Compaction ${new Date(c * 1000).toLocaleString()}`} />
          ))}
          {summary.pr_links.slice(-40).map((l, i) => (
            <span key={`p${i}`} className="scrub-mark pr" style={{ left: pos(l.ts) }} title={`#${l.pr} linked ${new Date(l.ts * 1000).toLocaleString()}`} />
          ))}
          <span className="scrub-label left">{new Date(start * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
          <span className="scrub-label right">{summary.turns} turns</span>
        </div>
      )}
      {hits && (
        <div className="hits">
          <div className="hits-head">
            {hits.length} match{hits.length === 1 ? '' : 'es'}
            <button className="btn xs ghost" onClick={() => setHits(null)}>
              Clear
            </button>
          </div>
          {hits.slice(0, 50).map((h, i) => (
            <button key={i} className="hit" onClick={() => jumpTo(h.ts)}>
              <span className="hit-meta">
                {h.role === 'user' ? 'You' : 'Claude'} · {new Date(h.ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="hit-snip">{h.snippet}</span>
            </button>
          ))}
        </div>
      )}
      <DecisionCard station={station} />
      <div
        className="chat"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setFollow(atBottom);
          if (atBottom) setUnseen(0);
        }}
      >
        {hasMore && (
          <button className="btn ghost xs load-earlier" onClick={loadEarlier}>
            Load earlier
          </button>
        )}
        {loading && <div className="muted pad">Loading conversation…</div>}
        {error && <div className="error-box">Conversation unavailable: {error}</div>}
        {!loading && !error && turns.length === 0 && <div className="muted pad">No turns yet.</div>}
        {turns.map((t, i) => (
          <div key={`${t.ts}-${i}`} data-ts={t.ts} className={`turn turn-${t.role}${flash === t.ts ? ' flash' : ''}`}>
            <div className="turn-meta">
              <span>{t.role === 'user' ? 'You' : 'Claude'}</span>
              <span>{clock(t.ts)}</span>
              {t.role === 'assistant' && t.text && <CopyButton text={t.text} />}
            </div>
            {t.text && <Markdown text={t.text} />}
            {t.tools.length > 0 && (
              <div className="tool-chips">
                {t.tools.map((tool, j) => (
                  <span key={j} className="tool-chip" title={tool.summary}>
                    <b>{tool.name}</b> {tool.summary}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {!follow && (
        <button
          className="jump-latest"
          onClick={() => {
            setFollow(true);
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          Jump to latest{unseen > 0 ? ` · ${unseen} new` : ''}
        </button>
      )}
      <DispatchBox stationId={station.id} pr={station.pr_numbers[0]} showLibrary={false} compact placeholder="Reply to this session…" sendLabel="Send" />
    </div>
  );
}

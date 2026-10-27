import { useState } from 'react';
import { dispatch, useWorld } from '../store';
import { PHASE_LABEL, normalizePhase } from '../lib/domains';
import { getStored, storageKey } from '../lib/storage';
import { isBackwards } from '../scene/journey';
import type { MotionEvent } from '../types';
import { REVIEWER_NAME } from '../lib/brand';

const KEY = storageKey('tickerOpen');

const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Whose move an item became, in words (a person's name falls through to "waiting on <name>"). */
const BALL_WORDS: Record<string, string> = {
  owner: 'your move',
  claude: "Claude's move",
  reviewer: `waiting on ${REVIEWER_NAME.toLowerCase()}`,
  ci: 'waiting on CI',
  testers: 'with testers',
  person: 'waiting on a person',
  closeout: 'close-out owed',
  none: "nobody's move",
};

/** Plain words for one transition: "Review to Merge", "merged", "your move". */
export function describeEvent(e: MotionEvent): string {
  const from = normalizePhase(e.from);
  const to = normalizePhase(e.to);
  const chip = e.closeout || e.to === 'docs' ? ' · close-out owed' : '';
  if (e.kind === 'phase' && from && to && from !== to) return `${PHASE_LABEL[from]} to ${PHASE_LABEL[to]}${chip}`;
  if (e.kind === 'phase' && to) return `to ${PHASE_LABEL[to]}${chip}`;
  if (e.kind === 'merge') return 'merged';
  if (e.kind === 'deploy') return 'deployed';
  if (e.kind === 'ball') return BALL_WORDS[e.to ?? 'none'] ?? `waiting on ${e.to}`;
  if (e.kind === 'note') return e.text ?? e.to ?? 'note';
  return `${e.kind}${e.to ? `: ${e.to}` : ''}`;
}

const backwards = (e: MotionEvent) => {
  const from = normalizePhase(e.from);
  const to = normalizePhase(e.to);
  return e.kind === 'phase' && !!from && !!to && isBackwards(from, to);
};

function readOpen(): boolean {
  try {
    return getStored(KEY) === '1';
  } catch {
    return false;
  }
}

/** Bottom ticker fed by the daemon's events[]: newest first, click to fly to the item. */
export function EventTicker() {
  const events = useWorld((s) => s.snapshot?.events);
  const [open, setOpen] = useState(readOpen);
  if (!events?.length) return null;
  const newest = [...events].reverse();
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(KEY, open ? '0' : '1');
    } catch {
      /* storage unavailable */
    }
  };
  const go = (e: MotionEvent) => {
    if (e.workpiece_id) dispatch({ type: 'select', selection: { kind: 'item', id: e.workpiece_id }, fly: true });
    else if (e.station_id) dispatch({ type: 'select', selection: { kind: 'station', id: e.station_id }, fly: true });
  };
  const row = (e: MotionEvent, i: number) => (
    <button key={`${e.ts}-${i}`} className={`tick-ev${backwards(e) ? ' back' : ''}`} onClick={() => go(e)} title="Fly to it">
      <span className="tick-time">{clock(e.ts)}</span>
      {e.pr != null && <span className="tick-pr">#{e.pr}</span>}
      <span className="tick-what">{describeEvent(e)}</span>
    </button>
  );
  return (
    <div className={`ticker glass${open ? ' open' : ''}`}>
      <button className="ticker-toggle" onClick={toggle} aria-expanded={open} title={open ? 'Collapse events' : 'Show the event log'}>
        Events <span className="kbd">{events.length}</span>
      </button>
      {open ? <div className="ticker-list">{newest.slice(0, 60).map(row)}</div> : <div className="ticker-line">{newest.slice(0, 8).map(row)}</div>}
    </div>
  );
}

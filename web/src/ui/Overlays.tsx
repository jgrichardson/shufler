import { useConfig } from '../api/config';
import { requestAction } from './requestAction';
import { usePalette } from './Palette';
import { useSettings } from './SkillsSettings';
import { useFollow } from './followCmux';
import { usePrefs } from './prefs';
import { listSkins, resolveSkin, useResolvedTheme, useSkinStore } from '../skins/store';
import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from './focusTrap';
import { useLibDrag } from './library/drag';
import { PRODUCT_NAME, REVIEWER_NAME, TAGLINE } from '../lib/brand';
import { useTerminalName } from '../lib/terminalName';
import { dispatch, toggleLibrary, useWorld, useItem, useStation } from '../store';
import { BALL_COLOR, stationColor } from '../lib/colors';
import { domainDef, PHASE_LABEL } from '../lib/domains';
import { ago, duration } from '../lib/format';
import { workingCount } from '../lib/derive';
import { itemLabel, owedText } from './panel/common';

export function Toasts() {
  const toasts = useWorld((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass ${t.ok ? 'ok' : 'fail'}`}>
          <div className="toast-head">
            <span className="toast-icon">{t.ok ? '✓' : '✕'}</span>
            <span className="toast-title">{t.title}</span>
            <button className="link" aria-label="Dismiss" onClick={() => dispatch({ type: 'dismiss_toast', id: t.id })}>
              ×
            </button>
          </div>
          {t.output && <pre className="toast-out">{t.output}</pre>}
          {t.cta && (
            <div className="toast-cta">
              <button
                className="btn small"
                onClick={() => {
                  requestAction(t.cta!.action, t.cta!.params);
                  dispatch({ type: 'dismiss_toast', id: t.id });
                }}
              >
                {t.cta.label}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function useClock(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function useCounts() {
  const snap = useWorld((s) => s.snapshot);
  if (!snap) return { needs: 0, waiting: 0, working: 0, live: 0, sessions: 0 };
  const live = snap.workpieces.filter((w) => w.phase !== 'shipped' && !w.parked);
  return {
    needs: snap.your_move_count || snap.your_move.length,
    waiting: live.filter((w) => ['reviewer', 'ci', 'person', 'testers'].includes(w.ball.who)).length,
    working: workingCount(snap.stations),
    live: live.length,
    sessions: snap.stations.length,
  };
}

function FollowToggle() {
  const mode = usePrefs((s) => s.terminalFollow);
  const on = mode !== 'off';
  const paused = useFollow((s) => s.pausedUntil);
  const toggle = useFollow((s) => s.toggle);
  const now = useClock();
  const isPaused = on && paused > now;
  return (
    <button
      className={`follow${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={toggle}
      title={
        mode === 'mark'
          ? 'Terminal sync: the session you switch to in the terminal is marked here; the view stays as it is. More options in Settings.'
          : 'Terminal sync: the session you switch to in the terminal is selected here. Pauses after you pick something. More options in Settings.'
      }
    >
      <span className="follow-track">
        <span className="follow-knob" />
      </span>
      Terminal sync{isPaused ? <span className="follow-paused"> · paused {Math.ceil((paused - now) / 1000)}s</span> : null}
    </button>
  );
}

/** Quick skin switch in the top bar; importing and exporting skins lives in Settings → Appearance. */
function SkinSwitch() {
  const builtins = useSkinStore((s) => s.builtins);
  const imported = useSkinStore((s) => s.imported);
  const activeId = useSkinStore((s) => s.activeId);
  const setActive = useSkinStore((s) => s.setActive);
  const skins = listSkins({ builtins, imported }).filter((s) => !s.imported || s.base);
  const shown = resolveSkin({ builtins, imported, activeId })?.id;
  if (skins.length < 2) return null;
  return (
    <label className="skin-switch" title="Skin (more in Settings → Appearance)">
      <span className="sr-only">Skin</span>
      <select value={shown} onChange={(e) => setActive(e.target.value)}>
        {skins.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Sun/moon switch between dark and light chrome; 'System' lives in Settings. */
function ThemeButton() {
  const theme = useResolvedTheme();
  const setPrefs = usePrefs((s) => s.set);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button className="theme-btn" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode (System is in Settings)`} onClick={() => setPrefs({ theme: next })}>
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

export function TopBar() {
  const c = useCounts();
  const product = useConfig((x) => x.product);
  const preset = useWorld((s) => s.preset);
  const dim = useWorld((s) => s.dim);
  const libOpen = useWorld((s) => s.selection?.kind === 'library');
  const libCount = useWorld((s) => s.snapshot?.library?.items ?? 0);
  const settingsOpen = useSettings((s) => s.open);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        {product}
      </div>
      <div className="top-stats">
        <span>
          <b>{c.sessions}</b> sessions
        </span>
        <span>
          <b>{c.live}</b> items live
        </span>
      </div>
      <button className="preset push" title="Command palette (Cmd+K)" onClick={() => usePalette.getState().set(true)}>
        Skills <span className="kbd">⌘K</span>
      </button>
      <button
        className={`preset${settingsOpen ? ' on' : ''}`}
        aria-pressed={settingsOpen}
        title="Settings: appearance, terminal sync, skills"
        onClick={() => useSettings.getState().set(!settingsOpen)}
      >
        Settings
      </button>
      <button className={`preset${libOpen ? ' on' : ''}`} aria-pressed={libOpen} title="Context library: files and folders to hand to sessions (L)" onClick={toggleLibrary}>
        Library{libCount ? <span className="lib-count">{libCount}</span> : null}
      </button>
      <div className="presets">
        {(['overview', 'needs', 'pipeline', 'domain', 'shipped'] as const).map((p, i) => (
          <button
            key={p}
            className={`preset${preset === p ? ' on' : ''}${p === 'needs' ? ' needs-tab' : ''}`}
            aria-pressed={preset === p}
            // the needs view toggles: clicking it again goes back to the overview
            onClick={() => dispatch({ type: 'preset', preset: p === 'needs' && dim ? 'overview' : p })}
            title={p === 'needs' ? `Show only what needs you (key ${i + 1})` : `Key ${i + 1}`}
          >
            {p === 'needs' ? (
              <>
                Needs you <span className={`needs-count${c.needs ? ' hot' : ''}`}>{c.needs}</span>
              </>
            ) : (
              p[0].toUpperCase() + p.slice(1)
            )}
          </button>
        ))}
      </div>
      <SkinSwitch />
      <ThemeButton />
    </header>
  );
}

/** Status-bar key legend; narrow windows keep only the last ("? keys"). */
const KEY_HINTS: [string, string][] = [['1-5', 'views'], ['0', 'clean'], ['right-drag', 'pan'], ['N', 'next move'], ['#', 'find PR'], ['/', 'commands'], ['?', 'keys']];

export function StatusBar() {
  const now = useClock();
  const conn = useWorld((s) => s.conn);
  const last = useWorld((s) => s.lastMessageAt);
  const c = useCounts();
  const label = conn === 'open' ? 'Live' : conn === 'mock' ? 'Mock data' : conn === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  return (
    <footer className="statusbar glass">
      <span className={`conn conn-${conn}`} title={conn === 'mock' ? 'Demo data (?mock=1): not your sessions, and actions are simulated' : undefined}>
        {conn === 'mock' ? <span className="demo-pill">Demo data</span> : <span className="conn-dot" />}
        {conn === 'mock' ? <span className="muted demo-note">not your sessions · actions are simulated</span> : label}
        {last ? <span className="muted updated"> · updated {duration(Math.max(0, now - last) / 1000)} ago</span> : null}
      </span>
      <span className={c.needs ? 'hot-text' : ''}>
        Needs you <b>{c.needs}</b>
      </span>
      <span>
        Waiting on others <b>{c.waiting}</b>
      </span>
      <span>
        Working <b>{c.working}</b>
      </span>
      <span className="spacer" />
      <FollowToggle />
      <span className="keys">
        {KEY_HINTS.map(([k, what]) => (
          <span key={k} className={`key-hint${k === '?' ? ' always' : ''}`}>
            <kbd>{k}</kbd> {what}
          </span>
        ))}
      </span>
      <span className="clock">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </footer>
  );
}

export function Tooltip() {
  const hover = useWorld((s) => s.hover);
  const station = useStation(hover?.kind === 'station' ? hover.id : null);
  const item = useItem(hover?.kind === 'item' ? hover.id : null);
  const dragging = useLibDrag((s) => !!s.itemIds); // the drag ghost already names the target
  if (!hover || dragging || (!station && !item)) return null;
  const style = { left: Math.min(hover.x + 16, window.innerWidth * 0.72 - 340), top: hover.y + 16 };
  if (station) {
    return (
      <div className="tooltip glass" style={style}>
        <div className="tt-title">
          <span className="dot" style={{ background: stationColor(station) }} /> {station.title}
        </div>
        {station.note && <div className="tt-note">{station.note.text}</div>}
        {station.pending_question && <div className="tt-q">? {station.pending_question.question}</div>}
        {station.last_assistant_preview && <div className="tt-preview">{station.last_assistant_preview}</div>}
        <div className="tt-meta">
          {station.activity.status} · last {station.activity.last_tool ?? 'action'} {ago(station.activity.last_at)} ago
          {station.activity.subagents ? ` · ${station.activity.subagents} subagents` : ''}
        </div>
      </div>
    );
  }
  if (item) {
    return (
      <div className="tooltip glass" style={style}>
        <div className="tt-title">
          <span className="dot" style={{ background: BALL_COLOR[item.ball.who] }} /> {itemLabel(item)} · {PHASE_LABEL[item.phase]}
        </div>
        <div className="tt-note">{item.title}</div>
        <div className="tt-meta">
          {domainDef(item.domain).label} · {owedText(item)}
          {item.phase_since ? ` · ${ago(item.phase_since)} in phase` : ''}
        </div>
        {item.kind === 'pr' && (
          <div className="tt-meta">
            CI {item.ci}
            {item.reviewer !== 'off' ? ` · ${REVIEWER_NAME} ${item.reviewer.replace('_', ' ')}` : ''}
            {item.reviewer !== 'off' && item.reviewer_at_head === false ? ' (older commit)' : ''}
            {item.mergeable === 'CONFLICTING' ? ' · conflicts' : ''}
            {item.draft ? ' · draft' : ''}
          </div>
        )}
      </div>
    );
  }
  return null;
}

const KEYS: [string, string][] = [
  ['1 – 5', 'Overview, Needs you, Pipeline, Domain, Shipped'],
  ['0', 'Clean: islands, pods and what needs you only; press again for every layer'],
  ['Right-drag', 'Pan the world (also Shift+drag, Space+drag, two-finger scroll)'],
  ['Left-drag', 'Orbit'],
  ['Wheel / pinch', 'Zoom toward the cursor'],
  ['Arrows / + -', 'Pan / zoom'],
  ['Click', 'Select a session, row, column or item; everything else greys out and the view stays put'],
  ['P', 'Pipeline board on and off (kanban by district)'],
  ['N / Shift+N', 'Next / previous item in Your move'],
  ['J / K', 'Next / previous item in the pipeline'],
  ['D / Shift+D', 'Highlight the next / previous domain'],
  ['G', 'Highlight the gate (column) of the selected item'],
  ['# then digits, Enter', 'Find a PR by number'],
  ['Enter', 'Fly the camera to the selection'],
  ['F', 'Focus the managing session in {terminal}'],
  ['O', 'Open the PR on GitHub'],
  ['/', 'Commands'],
  ['L', 'Context library'],
  ['R', 'Reset the view'],
  ['H', 'Horizon view: tilt down to the sky and skyline, and back'],
  ['Esc', 'Close dialog, drawer or selection'],
  ['?', 'This help'],
];

export function HelpOverlay() {
  const open = useWorld((s) => s.helpOpen);
  const terminal = useTerminalName();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && dispatch({ type: 'help', open: false })}>
      <div ref={ref} className="modal glass help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="help-tagline">
          <b>{PRODUCT_NAME}</b> <span className="muted">{TAGLINE}</span>
        </div>
        <div className="modal-kicker">Keyboard</div>
        <h2>Shortcuts</h2>
        <dl className="keys-list">
          {KEYS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v.replace('{terminal}', terminal)}</dd>
            </div>
          ))}
        </dl>
        <div className="modal-actions">
          <button className="btn" onClick={() => dispatch({ type: 'help', open: false })}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function SearchHint({ text }: { text: string | null }) {
  if (text == null) return null;
  return <div className="search-hint glass mono">#{text}<span className="caret" /></div>;
}

/** Tab title "(N) <product>" and a red dot on the favicon when something needs you. */
export function useWindowChrome() {
  const c = useCounts();
  const product = useConfig((x) => x.product);
  useEffect(() => {
    document.title = c.needs > 0 ? `(${c.needs}) ${product}` : product;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    if (!g) return;
    g.fillStyle = '#d8b07a';
    g.beginPath();
    g.moveTo(32, 6);
    g.lineTo(58, 22);
    g.lineTo(58, 44);
    g.lineTo(32, 58);
    g.lineTo(6, 44);
    g.lineTo(6, 22);
    g.closePath();
    g.fill();
    if (c.needs > 0) {
      g.fillStyle = '#e74c3c';
      g.beginPath();
      g.arc(48, 16, 14, 0, Math.PI * 2);
      g.fill();
    }
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = cv.toDataURL('image/png');
  }, [c.needs, product]);
}

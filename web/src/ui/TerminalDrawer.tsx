import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { closeTerminal, useTerminals, type TermTab } from './terminals';
import { useResolvedTheme, useSkin } from '../skins/store';

/** Reads a chrome token; xterm draws on a canvas, so it cannot use CSS variables directly. */
function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Background, text and cursor follow the active skin; the ANSI colours stay fixed so output reads the same. */
const theme = () => ({
  background: token('--term-bg', '#080b12'),
  foreground: token('--term-fg', '#e8eef6'),
  cursor: token('--accent', '#8fd3ff'),
  selectionBackground: 'rgba(255, 255, 255, 0.22)',
  black: '#1c222c',
  red: '#ff7b6e',
  green: '#6fe39e',
  yellow: '#ffc46b',
  blue: '#7dc0f0',
  magenta: '#d3a6ea',
  cyan: '#7fd6d0',
  white: '#e8e1dc',
});

function wsUrl(path: string): string {
  if (/^wss?:/.test(path)) return path;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path.startsWith('/') ? path : `/${path}`}`;
}

function TermView({ tab, visible }: { tab: TermTab; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const skinId = useSkin().id;
  const mode = useResolvedTheme();

  useEffect(() => {
    const term = new Terminal({ fontFamily: "'JetBrains Mono', Menlo, monospace", fontSize: 12.5, theme: theme(), cursorBlink: true, scrollback: 5000, allowProposedApi: false });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    termRef.current = term;
    fitRef.current = fit;
    let sock: WebSocket | null = null;
    const send = (data: string) => sock?.readyState === WebSocket.OPEN && sock.send(JSON.stringify({ type: 'input', data }));
    const resize = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        term.clear();
        return false;
      }
      if (e.key === 'Escape' && e.shiftKey) {
        term.blur();
        return false;
      }
      return true;
    });
    if (tab.mock) {
      term.writeln('\x1b[33mMock terminal: nothing runs. Connect the daemon for a real shell.\x1b[0m');
      let line = tab.prefill;
      term.write(`$ ${line}`);
      term.onData((d) => {
        if (d === '\r') {
          term.write(`\r\n(mock) ${line || 'ok'}\r\n$ `);
          line = '';
        } else if (d === '\x7f') {
          if (line) {
            line = line.slice(0, -1);
            term.write('\b \b');
          }
        } else {
          line += d;
          term.write(d);
        }
      });
    } else if (tab.wsUrl) {
      sock = new WebSocket(wsUrl(tab.wsUrl));
      sock.binaryType = 'arraybuffer';
      sock.onopen = () => resize();
      sock.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data as ArrayBuffer));
      sock.onclose = () => term.writeln('\r\n\x1b[90m[terminal closed]\x1b[0m');
      term.onData(send);
    }
    const ro = new ResizeObserver(() => resize());
    ro.observe(host.current!);
    setTimeout(resize, 30);
    return () => {
      ro.disconnect();
      sock?.close();
      term.dispose();
    };
  }, [tab.id, tab.mock, tab.prefill, tab.wsUrl]);

  useEffect(() => {
    // the App applies the new tokens in its own effect, which runs after this child's; wait a frame
    const id = requestAnimationFrame(() => {
      if (termRef.current) termRef.current.options.theme = theme();
    });
    return () => cancelAnimationFrame(id);
  }, [skinId, mode]);

  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* hidden */
        }
        termRef.current?.focus();
      }, 30);
    }
  }, [visible]);

  return (
    <div className={`term-view${visible ? '' : ' hidden'}`}>
      {tab.prod && <div className="prod-banner">PROD · you are on the production console · reads and writes hit live data</div>}
      <div className="term-host" ref={host} />
    </div>
  );
}

export function TerminalDrawer() {
  const { open, tabs, active, setActive, setOpen } = useTerminals();
  if (!tabs.length) return null;
  return (
    <div className={`drawer term-drawer glass ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="term-tabs">
        {tabs.map((t) => (
          <div key={t.id} className={`term-tab${t.id === active ? ' on' : ''}${t.prod ? ' prod' : ''}`} onClick={() => setActive(t.id)}>
            {t.title}
            <button
              className="link"
              aria-label={`Close ${t.title}`}
              onClick={(e) => {
                e.stopPropagation();
                void closeTerminal(t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <span className="spacer" />
        <span className="hint">Shift+Esc returns focus · Cmd+K clears</span>
        <button className="btn ghost xs" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
      <div className="term-body">
        {tabs.map((t) => (
          <TermView key={t.id} tab={t} visible={t.id === active && open} />
        ))}
      </div>
    </div>
  );
}

export function TerminalLauncherPill() {
  const { open, tabs, setOpen } = useTerminals();
  if (!tabs.length || open) return null;
  return (
    <button className="term-pill glass" onClick={() => setOpen(true)}>
      Terminals · {tabs.length}
    </button>
  );
}

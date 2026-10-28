import { useEffect, useRef, useState } from 'react';
import { dispatch, findItemByPr, useWorld } from '../store';
import { previewAction } from '../api/actions';
import { mergeGate, typedConfirmationMatches } from '../lib/mergeGate';
import type { ActionPreview } from '../types';
import { executeAction } from './requestAction';
import { useFocusTrap } from './focusTrap';
import { allCommands } from './commands';

function factText(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Actions the daemon applies itself (a config write), so their preview carries facts but no shell command. */
const IN_DAEMON = new Set(['set_domain']);

export function ConfirmDialog() {
  const pending = useWorld((s) => s.pending);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const typedRef = useRef<HTMLInputElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  const shownAt = useRef(0);
  // library_send: the composed message is editable; edits re-preview so the command shown is what runs
  const [message, setMessage] = useState<string | null>(null);
  const baseMessage = useRef<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setFetchError(null);
    setTyped(pending?.action === 'merge' ? String(pending.params.typed_confirmation ?? '') : '');
    setRunning(false);
    setMessage(null);
    baseMessage.current = null;
    if (!pending) return;
    let live = true;
    previewAction(pending.action, pending.params)
      .then((p) => {
        if (!live) return;
        shownAt.current = Date.now();
        setPreview(p);
        if (typeof p.facts?.message === 'string') {
          baseMessage.current = p.facts.message;
          setMessage(p.facts.message);
        }
      })
      .catch((e: Error) => live && setFetchError(e.message));
    return () => {
      live = false;
    };
  }, [pending]);

  const edited = message != null && baseMessage.current != null && message.trim() !== baseMessage.current;
  useEffect(() => {
    if (!pending || message == null || baseMessage.current == null) return;
    let live = true;
    const t = setTimeout(() => {
      previewAction(pending.action, edited ? { ...pending.params, text: message } : pending.params)
        .then((p) => live && setPreview(p))
        .catch((e: Error) => live && setFetchError(e.message));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  const typedLevel = pending?.action === 'merge' || preview?.confirm === 'typed';
  useEffect(() => {
    if (!preview) return;
    if (typedLevel) typedRef.current?.focus();
    else runRef.current?.focus();
  }, [preview, typedLevel]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, !!pending);

  if (!pending) return null;
  const isMerge = pending.action === 'merge';
  const pr = Number(pending.params.pr);
  const item = isMerge ? findItemByPr(pr) : undefined;
  const gate = isMerge ? mergeGate(item) : { ok: true, reasons: [] };
  const expected = String(preview?.facts?.requires_typed_confirmation ?? (isMerge ? pr : ''));
  const typedOk = !typedLevel || (isMerge ? typedConfirmationMatches(pr, typed) : typed.trim() === expected);
  const refusal = fetchError ?? preview?.error ?? null;
  const inDaemon = IN_DAEMON.has(pending.action);
  // a command marked prod gets the red treatment: banner, kicker and a danger Run button
  const prod = pending.action === 'run_command' && (preview?.facts?.prod === true || !!allCommands(useWorld.getState().snapshot?.capabilities).find((c) => c.id === pending.params.command)?.prod);
  const canRun = !!preview && !refusal && gate.ok && typedOk && !running && (inDaemon || !!(preview.command || preview.url));
  const HIDDEN_FACTS = new Set(['requires_typed_confirmation', 'prod', 'confirm', 'command_id', 'message', 'item_ids', 'session_id', ...(message != null ? ['text'] : [])]);
  const facts = Object.entries(preview?.facts ?? {}).filter(([k]) => !HIDDEN_FACTS.has(k));

  const close = () => dispatch({ type: 'cancel_action' });
  const run = async () => {
    if (!canRun || Date.now() - shownAt.current < 400) return;
    const { action, params, label } = pending;
    setRunning(true);
    const sendParams = edited && message ? { ...params, text: message } : params;
    await executeAction(action, typedLevel ? { ...sendParams, typed_confirmation: typed.trim() } : sendParams, label);
    dispatch({ type: 'cancel_action' });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={dialogRef}
        className={`modal glass${prod ? ' prod' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={pending.label}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        {prod && <div className="prod-banner">Production</div>}
        <div className="modal-kicker">Confirm</div>
        <h2>{pending.label}</h2>
        {message != null && (
          <div className="msg-edit">
            <label className="modal-label" htmlFor="confirm-message">
              Message{edited ? ' (edited)' : ''} · one line per prompt{preview?.facts?.harness === 'codex' ? '' : '; /add-dir lines go first'}
            </label>
            <textarea id="confirm-message" className="input mono" rows={Math.min(8, message.split('\n').length + 2)} value={message} spellCheck={false} onChange={(e) => setMessage(e.target.value)} />
            {edited && (
              <button className="link small" onClick={() => setMessage(baseMessage.current)}>
                Reset to the composed message
              </button>
            )}
          </div>
        )}
        {inDaemon ? (
          <div className="modal-label">{preview ? `No shell command: the daemon writes this change to ${preview.facts?.config_file ?? 'its config file'}.` : refusal ? '' : 'Loading preview…'}</div>
        ) : (
          <>
            <div className="modal-label">The daemon will run exactly this:</div>
            <pre className={`command${refusal ? ' error' : ''}`}>{preview?.command || preview?.url || (refusal ? '' : 'Loading preview…')}</pre>
          </>
        )}
        {refusal && <div className="refusal">Refused: {refusal}</div>}
        {facts.length > 0 && (
          <dl className="facts compact">
            {facts.map(([k, v]) => (
              <div key={k} className="fact">
                <dt>{k.replace(/_/g, ' ')}</dt>
                <dd>{factText(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {preview?.warnings?.length ? (
          <ul className="warnings">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {isMerge && !gate.ok && <div className="refusal">Merge locked: {gate.reasons.join(' · ')}</div>}
        {typedLevel && (
          <div className="typed-box">
            <label className="modal-label" htmlFor="typed-confirm">
              Type <b className="mono">{expected}</b> to confirm
            </label>
            <input
              id="typed-confirm"
              ref={typedRef}
              className="input mono"
              value={typed}
              autoComplete="off"
              disabled={!gate.ok}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder={expected}
            />
          </div>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button ref={runRef} className={`btn ${isMerge || prod ? 'danger' : 'primary'}`} disabled={!canRun} onClick={run}>
            {running ? 'Running…' : isMerge ? `Merge #${pr}` : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
}

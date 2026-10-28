import { useState } from 'react';
import type { Station } from '../../types';
import { requestAction } from '../requestAction';
import { useLeverOff } from '../../lib/terminalCaps';

/** Pending AskUserQuestion or harness approval: one button per option (recommended highlighted, never auto-picked;
 * an approval option shows the key it presses) + free text. */
export function DecisionCard({ station }: { station: Station }) {
  const q = station.pending_question;
  const [text, setText] = useState('');
  const off = useLeverOff('answer_question');
  if (!q) return null;
  const answer = (t: string) => requestAction('answer_question', { station_id: station.id, text: t });
  return (
    <div className="decision-card">
      <div className="decision-kicker">
        <span className="q-glyph">?</span> {q.kind === 'approval' ? 'Approval needed' : `Decision needed${q.header ? ` · ${q.header}` : ''}`}
      </div>
      <div className="decision-q">{q.question}</div>
      {off && <div className="lever-off-note">{off} Answer it in the session's own window.</div>}
      <div className="decision-options">
        {q.options.map((o) => (
          <button key={o.label} className={`decision-option${o.recommended ? ' recommended' : ''}`} disabled={!!off} title={off ?? undefined} onClick={() => answer(o.label)}>
            <span className="opt-label">
              {o.label}
              {o.recommended && <span className="rec-tag">Recommended</span>}
              {o.key && <kbd className="opt-key">{o.key === 'Escape' ? 'esc' : o.key}</kbd>}
            </span>
            {o.description && <span className="opt-desc">{o.description}</span>}
          </button>
        ))}
      </div>
      <div className="reply-row">
        <input className="input" value={text} placeholder="Or answer in your own words…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && !off && answer(text.trim())} />
        <button className="btn" disabled={!text.trim() || !!off} title={off ?? undefined} onClick={() => answer(text.trim())}>
          Answer
        </button>
      </div>
    </div>
  );
}

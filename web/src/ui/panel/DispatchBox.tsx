import { useEffect, useState } from 'react';
import type { ActionName } from '../../types';
import { SUFFIX_PLAIN, SUFFIX_SHORT, fillPrompt } from '../prompts';
import { useConfig } from '../../api/config';
import { requestAction } from '../requestAction';

interface Props {
  stationId: string;
  pr?: number | null;
  /** Text forced in front of whatever is sent, e.g. "#412: " for Deliver news. */
  prefix?: string;
  placeholder?: string;
  sendLabel?: string;
  action?: ActionName;
  showLibrary?: boolean;
  compact?: boolean;
}

/** Free text + the canned library + the two suffix toggles. Sends through the confirm flow. */
export function DispatchBox({ stationId, pr, prefix = '', placeholder, sendLabel = 'Send to session', action = 'dispatch', showLibrary = true, compact }: Props) {
  const [text, setText] = useState('');
  const [plain, setPlain] = useState(false);
  const [short, setShort] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setText(''), [stationId, pr]);
  const prompts = useConfig((c) => c.prompts);
  const groups = [...new Set(prompts.map((p) => p.group))];
  const final = `${prefix}${text.trim()}${plain ? SUFFIX_PLAIN : ''}${short ? SUFFIX_SHORT : ''}`;
  return (
    <div className={`dispatch-box${compact ? ' compact' : ''}`}>
      {showLibrary && (
        <div className="library">
          {groups.map((g) => (
            <div key={g} className="lib-group">
              <button
                className={`lib-head${open === g ? ' open' : ''}`}
                onClick={() => {
                  const only = prompts.filter((p) => p.group === g);
                  // a group of one fills the box straight away
                  if (only.length === 1) {
                    setText(fillPrompt(only[0].text, pr));
                    setOpen(null);
                  } else setOpen(open === g ? null : g);
                }}
                title={prompts.filter((p) => p.group === g).length === 1 ? prompts.find((p) => p.group === g)!.text : undefined}
              >
                {g}
              </button>
              {open === g &&
                prompts.filter((p) => p.group === g).length > 1 &&
                prompts.filter((p) => p.group === g).map((p) => (
                  <button key={p.label} className="lib-item" onClick={() => setText(fillPrompt(p.text, pr))} title={p.text}>
                    {p.label}
                    <span className="lib-text">{fillPrompt(p.text, pr)}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
      <div className="reply-row">
        {prefix && <span className="reply-prefix">{prefix.trim()}</span>}
        <textarea
          className="input"
          rows={compact ? 2 : 3}
          value={text}
          placeholder={placeholder ?? 'Type a prompt for this session…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) requestAction(action, { station_id: stationId, text: final });
          }}
        />
      </div>
      <div className="btn-row">
        <label className="check">
          <input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} /> plain speak
        </label>
        <label className="check">
          <input type="checkbox" checked={short} onChange={(e) => setShort(e.target.checked)} /> short, no opening line
        </label>
        <button className="btn primary" disabled={!text.trim()} onClick={() => requestAction(action, { station_id: stationId, text: final })}>
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useWorld } from '../../store';
import type { Station } from '../../types';
import { stationContext } from '../../lib/library';
import { ago } from '../../lib/format';
import { Section } from '../panel/common';
import { ensureLibrary, openSend, useLibrary } from './store';
import { useLeverOff } from '../../lib/terminalCaps';

/** The session panel's Context section: what the library gave this session (pinned, sent, owed) and Send. */
export function ContextSection({ s }: { s: Station }) {
  const data = useLibrary((x) => x.data);
  const owed = useWorld((x) => x.snapshot?.library?.owed[s.id]) ?? [];
  const [pick, setPick] = useState('');
  const off = useLeverOff('library_send');
  useEffect(ensureLibrary, []);
  const rows = data ? stationContext(s, data, owed) : [];
  const others = (data?.items ?? []).filter((i) => !rows.some((r) => r.item.id === i.id));
  return (
    <Section
      title="Context"
      className={owed.length ? 'ctx-owed' : ''}
      right={
        owed.length > 0 ? (
          <button className="btn primary xs" disabled={!!off} title={off ?? undefined} onClick={() => openSend(s.id, owed)}>
            Send owed · {owed.length}
          </button>
        ) : undefined
      }
    >
      {!data && <div className="muted small">Loading the library…</div>}
      {data && rows.length === 0 && <div className="muted small">Nothing from the library yet. Drag a card from the Library (L) onto this row, or pick one below.</div>}
      {rows.map((r) => (
        <div key={r.item.id} className="ctx-row">
          <span className="ctx-name" title={r.item.paths.join('\n')}>
            {r.item.name}
          </span>
          <span className="ctx-flags">
            {r.owed && <span className="lib-tag warn">owed</span>}
            {r.pinned && <span className="lib-tag">pinned</span>}
            {!r.pinned && r.grants.length > 0 && <span className="lib-tag">once</span>}
            {r.sentAt && <span className="muted small">sent {ago(r.sentAt)} ago</span>}
          </span>
          <button className="btn xs" disabled={!!off} title={off ?? undefined} onClick={() => openSend(s.id, [r.item.id])}>
            Send
          </button>
        </div>
      ))}
      {others.length > 0 && (
        <div className="ctx-more">
          <select className="input xs" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Library item to send">
            <option value="">Send another library item…</option>
            {others.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <button className="btn xs" disabled={!pick || !!off} title={off ?? undefined} onClick={() => (openSend(s.id, [pick]), setPick(''))}>
            Send
          </button>
        </div>
      )}
    </Section>
  );
}

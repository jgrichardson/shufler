import { useMemo } from 'react';
import { dispatch, useWorld } from '../store';
import { useLayout, useRedSets } from '../scene/useLayout';
import { outside, useFocus } from '../scene/focus';
import { rowHeads } from '../scene/RowProjector';
import { useLayers } from './layers';
import { areaLabel } from '../lib/domains';
import { useTerminalStation } from './followCmux';
import { sessionCount } from '../lib/derive';
import { useLibDrag } from './library/drag';
import { harnessLabel } from '../lib/library';

/**
 * The pinned 2D row-header column: one header per cmux workspace row (title as cmux shows it, domain
 * colour swatch, a harness badge on non-Claude rows, an area-ledger "L" chip, items and needs-you counts), Unowned last. No group dividers (round 10).
 */
export function RowHeaders() {
  const layout = useLayout();
  const snapshot = useWorld((s) => s.snapshot);
  const selection = useWorld((s) => s.selection);
  const hover = useWorld((s) => s.hover);
  const needsOn = useLayers((s) => s.needs);
  const red = useRedSets();
  const focus = useFocus();
  const terminalStation = useTerminalStation();
  const dropOver = useLibDrag((s) => (s.itemIds ? s.over : null));
  const owed = snapshot?.library?.owed;
  const counts = useMemo(() => {
    const m = new Map<number, { items: number; needs: number }>();
    if (!layout) return m;
    for (const [id, p] of layout.pods) {
      const c = m.get(p.lane) ?? { items: 0, needs: 0 };
      c.items += 1;
      if (red.items.has(id)) c.needs += 1;
      m.set(p.lane, c);
    }
    return m;
  }, [layout, red.items]);
  if (!layout || !snapshot) return null;
  // round 12: the ×N chip moved here from the building plate, which is gone
  const sessions = new Map(snapshot.stations.map((s) => [s.id, sessionCount(s.claude)]));
  // Claude Code is the default harness, so only other harnesses get a badge
  const harness = new Map(snapshot.stations.filter((s) => s.harness && s.harness !== 'claude').map((s) => [s.id, s.harness!]));
  const ref = (id: string) => (el: HTMLElement | null) => {
    if (el) rowHeads.items.set(id, el);
    else rowHeads.items.delete(id);
  };
  return (
    <div className="row-heads" ref={(el) => void (rowHeads.col = el)}>
      {layout.lanes.map((l, i) => {
        const c = counts.get(i) ?? { items: 0, needs: 0 };
        const needs = c.needs + (l.stationId && red.stations.has(l.stationId) ? 1 : 0);
        const selected = selection?.kind === 'station' && selection.id === l.stationId;
        const hovered = hover?.kind === 'station' && hover.id === l.stationId;
        const dimmed = outside(focus?.lanes, i, focus) && outside(focus?.stations, l.stationId, focus) ? ' is-dim' : '';
        const body = (
          <>
            <span className="row-swatch" style={{ background: l.domain.color }} title={l.domain.label} />
            <span className="row-title">{l.title}</span>
            {harness.has(l.stationId ?? '') && (
              <span className="harness-chip" title={`${harnessLabel(harness.get(l.stationId!))} session`}>
                {harness.get(l.stationId!)}
              </span>
            )}
            {terminalStation && l.stationId === terminalStation && (
              <span className="terminal-chip" title="Your terminal is on this session">
                &gt;_
              </span>
            )}
            {(sessions.get(l.stationId ?? '') ?? 0) >= 2 && (
              <span className="multi-chip" title={`${sessions.get(l.stationId ?? '')} ${harnessLabel(harness.get(l.stationId ?? ''))} sessions running here`}>
                ×{sessions.get(l.stationId ?? '')}
              </span>
            )}
            {l.stationId && (owed?.[l.stationId]?.length ?? 0) > 0 && (
              <span className="owed-chip" title={`${owed![l.stationId].length} pinned library item(s) this session has not received; send from its Context section`}>
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                  <path d="M2 2.2c1.4-.6 2.8-.5 4 .4 1.2-.9 2.6-1 4-.4v7.6c-1.4-.6-2.8-.5-4 .4-1.2-.9-2.6-1-4-.4z M6 2.6v7.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                {owed![l.stationId].length}
              </span>
            )}
            {l.ledgerArea && (
              <span className="row-ledger" title={`Area ledger · ${areaLabel(l.ledgerArea)}`}>
                L
              </span>
            )}
            <span className="row-counts">
              {c.items}
              {needs > 0 && needsOn && <span className="row-needs">{needs}</span>}
            </span>
          </>
        );
        if (!l.stationId)
          return (
            <div key={l.id} ref={ref(l.id)} className={`row-head is-unowned${dimmed}`} title="Items no workspace manages">
              {body}
            </div>
          );
        const sid = l.stationId;
        return (
          <button
            key={l.id}
            ref={ref(l.id)}
            data-station-id={sid}
            className={`row-head${dropOver === sid ? ' is-drop' : ''}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}${needs ? ' is-red' : ''}${dimmed}`}
            title={`${l.title} · ${l.domain.label}${l.group ? ` · ${l.group}` : ''}`}
            onClick={() => dispatch({ type: 'select', selection: { kind: 'station', id: sid } })}
            onPointerEnter={(e) => dispatch({ type: 'hover', hover: { kind: 'station', id: sid, x: e.clientX, y: e.clientY } })}
            onPointerLeave={() => dispatch({ type: 'hover', hover: null })}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

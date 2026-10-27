import { dispatch, openPile, useWorld } from '../store';
import { PILE_ALL, PILE_DOCK } from '../store/reducer';
import { useLayout, useLod, useRedSets } from '../scene/useLayout';
import { outside, useFocus } from '../scene/focus';
import { registerPlate } from '../scene/plateRegistry';
import { inflightPrs, useRides } from '../scene/rides';
import { WAREHOUSE_WALL_H, bayGeometry, warehouseGeometry, warehouseRacks } from '../scene/warehouseLayout';
import { isPipeline } from '../scene/morph';
import { nav } from '../scene/CameraRig';
import { isPanGesture } from '../lib/navInput';
import { plateVisible, useLayers } from './layers';
import { BALL_COLOR } from '../lib/colors';
import { domainDef } from '../lib/domains';
import { ballLabel } from '../lib/derive';
import { duration } from '../lib/format';
import type { Workpiece } from '../types';
import { itemLabel } from './panel/common';

const PRIORITY = { selected: 10, red: 8, island: 6, dock: 5, gate: 4.5, building: 3, pile: 2, pod: 1.5, crate: 1 } as const;

function PodLabel({ w, selected, red, full, conflicts, dot, far, stack, dimmed }: { w: Workpiece; selected: boolean; red: boolean; full: boolean; conflicts: boolean; dot: boolean; far: boolean; stack: string | undefined; dimmed: boolean }) {
  const lift = dot ? 1.0 : { S: 1.3, M: 1.6, L: 2.0 }[w.size];
  const ball = full ? ballLabel(w.ball) : null;
  return (
    <button
      ref={(el) => registerPlate(`p:${w.id}`, el, [0, 0, 0], selected ? PRIORITY.selected : red ? PRIORITY.red : PRIORITY.pod, { fixed: true, follow: w.id, lift, stack })}
      className={`plate pod-tag${selected ? ' is-selected' : ''}${red ? ' is-red' : ''}${w.parked ? ' is-parked' : ''}${dot ? ' is-compact' : ''}${far && !full ? ' is-far' : ''}${dimmed ? ' is-dim' : ''}`}
      title={w.pr != null ? `#${w.pr} ${w.title}` : w.title}
      onClick={() => dispatch({ type: 'select', selection: { kind: 'item', id: w.id } })}
      onPointerEnter={(e) => dispatch({ type: 'hover', hover: { kind: 'item', id: w.id, x: e.clientX, y: e.clientY } })}
      onPointerLeave={() => dispatch({ type: 'hover', hover: null })}
    >
      {ball && (
        <span className="ball-ini" style={{ background: BALL_COLOR[w.ball.who] }}>
          {ball}
        </span>
      )}
      <span className="pod-num">{itemLabel(w, 18)}</span>
      {full && w.reviewer_loop && w.phase === 'review' && <span className="pod-badge">R{w.reviewer_loop.round}</span>}
      {full && conflicts && w.mergeable === 'CONFLICTING' && <span className="pod-badge bad">conflict</span>}
      {w.closeout_owed && <span className="pod-badge env" title="Close-out owed">✉</span>}
      {full && w.stuck && w.phase_since && <span className="pod-badge warn">{duration(Date.now() / 1000 - w.phase_since)}</span>}
    </button>
  );
}

export function Plates() {
  const layout = useLayout();
  const snapshot = useWorld((s) => s.snapshot);
  const selection = useWorld((s) => s.selection);
  const dim = useWorld((s) => s.dim);
  const rides = useRides((s) => s.rides);
  const pipeline = useWorld((s) => isPipeline(s.preset));
  const lod = useLod((s) => s.lod);
  const zoomed = useLod((s) => s.zoomed);
  const hover = useWorld((s) => s.hover);
  const layers = useLayers();
  const red = useRedSets();
  const focus = useFocus();
  if (!layout || !snapshot) return null;
  const whDim = focus && !focus.warehouse ? ' is-dim' : '';
  const byId = new Map(snapshot.stations.map((s) => [s.id, s]));
  const air = inflightPrs(rides);
  const landed = air.size ? snapshot.shipped.filter((s) => !air.has(s.pr)) : snapshot.shipped;
  const racks = warehouseRacks(layout, landed);
  const wh = warehouseGeometry(layout, racks);
  const bay = bayGeometry(wh);
  const owedAll = landed.filter((s) => s.closeout_owed).length;
  const selPile = selection?.kind === 'pile' ? selection.id : null;
  const labels = layers.labels;
  // the Pipeline board reads like a zoomed-in view: every card shows its number
  const zoomedIn = zoomed || pipeline;
  const hoverItem = hover?.kind === 'item' ? hover.id : null;
  const selItem = selection?.kind === 'item' ? selection.id : null;
  const selStation = selection?.kind === 'station' ? byId.get(selection.id) : undefined;
  const showPod = (w: Workpiece) => {
    const slot = layout.pods.get(w.id);
    if (!slot || !layers.prs) return false;
    if (pipeline ? slot.parked : slot.hidden) return false;
    const isRed = red.items.has(w.id);
    if (dim && !isRed && w.id !== selItem) return false;
    return plateVisible('pod', {
      labels,
      zoomed: zoomedIn,
      selected: w.id === selItem || !!selStation?.workpiece_ids.includes(w.id),
      hovered: w.id === hoverItem,
      red: isRed,
      needsOn: layers.needs,
    });
  };
  // round 12: badges in one lane + district stack upward instead of covering each other
  const podStackKey = (w: Workpiece) => {
    const slot = layout.pods.get(w.id);
    if (!slot) return undefined;
    return pipeline ? `pipe:${slot.phase}` : slot.parked ? `park:${slot.lane}` : `${slot.lane}:${slot.phase}`;
  };
  // badges (ball, conflict, round, age) need room: near zoom, the Pipeline board, hover or selection
  const podFull = (w: Workpiece) => labels === 'all' || lod === 'near' || pipeline || w.id === selItem || w.id === hoverItem;
  const forward = (e: React.PointerEvent) => {
    // pan gestures that start on a plate still move the world
    if (!isPanGesture(e.button, e.shiftKey, nav.space)) return;
    const canvas = document.querySelector('.scene-canvas canvas');
    if (!canvas) return;
    e.preventDefault();
    e.stopPropagation();
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
        button: e.button,
        buttons: e.buttons,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  return (
    <div className="plates-layer" onPointerDownCapture={forward} onContextMenu={(e) => e.preventDefault()}>
      {plateVisible('dock', { labels, zoomed: zoomedIn }) && (
        <button
          type="button"
          ref={(el) => registerPlate('warehouse', el, [(wh.roofFromX + wh.backX) / 2, wh.floor + WAREHOUSE_WALL_H + 7, wh.cz], PRIORITY.dock)}
          className={`plate island-plate dock-plate${selPile === PILE_ALL ? ' is-selected' : ''}${whDim}`}
          style={{ ['--accent' as string]: '#f5c542' }}
          title="Everything shipped this week"
          onClick={() => openPile(PILE_ALL)}
        >
          <span className="island-name">Warehouse</span>
          <span className="plate-stats">
            <span key={landed.length} className="ship-count">
              {landed.length}
            </span>{' '}
            shipped this week · {landed.filter((s) => s.deployed).length} live
          </span>
        </button>
      )}
      {plateVisible('dock', { labels, zoomed: zoomedIn }) && (
        <button
          type="button"
          ref={(el) => registerPlate('bay', el, [bay.cx, bay.beltY + 3.2, bay.z], owedAll ? PRIORITY.red : PRIORITY.pile)}
          className={`plate pile-plate bay-plate${selPile === PILE_DOCK ? ' is-selected' : ''}${whDim}`}
          title="Shipped, close-out message still owed"
          onClick={() => openPile(PILE_DOCK)}
        >
          Shipping Dock
          {owedAll > 0 ? (
            <span className="pod-badge env" title={`Close-out owed on ${owedAll}`}>
              ✉{owedAll}
            </span>
          ) : (
            <span className="muted">clear</span>
          )}
        </button>
      )}
      {racks.map((r) => {
        // a close-out still owed keeps the rack badge visible, like a needs-me plate
        const owed = r.owed.length;
        if (!plateVisible('pile', { labels, zoomed: zoomedIn, red: owed > 0, needsOn: layers.needs })) return null;
        return (
          <button
            type="button"
            key={r.domain}
            ref={(el) => registerPlate(`pile:${r.domain}`, el, [wh.rackFrontX + 0.4, wh.floor + 4.6, r.z], owed ? PRIORITY.red : PRIORITY.pile)}
            className={`plate pile-plate${selPile === r.domain ? ' is-selected' : ''}${whDim}`}
            title={`${domainDef(r.domain).label}: ${r.items.length} shipped this week, ${r.stored.length} on the rack`}
            onClick={() => openPile(r.domain)}
          >
            <span className="island-code" style={{ background: domainDef(r.domain).color }}>
              {domainDef(r.domain).code}
            </span>
            {r.items.length}
            {owed > 0 && (
              <span className="pod-badge env" title={`Close-out owed on ${owed}; waiting on the Shipping Dock`}>
                ✉{owed > 1 ? owed : ''}
              </span>
            )}
          </button>
        );
      })}
      {snapshot.workpieces.filter(showPod).map((w) => (
        <PodLabel key={w.id} w={w} selected={w.id === selItem} red={red.items.has(w.id) && layers.needs} full={podFull(w)} conflicts={layers.conflicts} dot={!zoomedIn && !podFull(w)} far={lod === 'far' && !pipeline} stack={podStackKey(w)} dimmed={outside(focus?.items, w.id, focus)} />
      ))}
      {layers.prs &&
        !pipeline &&
        plateVisible('crate', { labels, zoomed: zoomedIn }) &&
        layout.crates.map((c) => (
          <button
            key={`${c.lane}-${c.phase}`}
            ref={(el) => registerPlate(`c:${c.lane}:${c.phase}`, el, [c.pos[0], c.pos[1] + 1.6, c.pos[2]], PRIORITY.crate, { fixed: true })}
            className={`plate crate-tag${focus && outside(focus.lanes, c.lane, focus) && outside(focus.phases, c.phase, focus) ? ' is-dim' : ''}`}
            onClick={() => dispatch({ type: 'select', selection: { kind: 'gate', phase: c.phase } })}
          >
            +{c.count}
          </button>
        ))}
    </div>
  );
}

import { dispatch, useWorld } from '../store';
import { strip } from '../scene/StripProjector';
import { outside, useFocus } from '../scene/focus';
import { PHASE_ACCENT } from '../lib/colors';
import { PHASES, PHASE_LABEL, phaseTiny } from '../lib/domains';

/** The one header strip naming the nine districts, each cell centred over its band, with live counts. */
export function DistrictStrip() {
  const snapshot = useWorld((s) => s.snapshot);
  const selection = useWorld((s) => s.selection);
  const focus = useFocus();
  if (!snapshot) return null;
  const counts = new Map<string, number>();
  for (const w of snapshot.workpieces) if (w.phase !== 'shipped' && !w.parked) counts.set(w.phase, (counts.get(w.phase) ?? 0) + 1);
  return (
    <div className="district-strip" ref={(el) => void (strip.bar = el)}>
      {PHASES.map((p, i) => {
        const n = counts.get(p) ?? 0;
        const sel = selection?.kind === 'gate' && selection.phase === p;
        return (
          <button
            key={p}
            ref={(el) => {
              if (el) strip.cells.set(p, el);
              else strip.cells.delete(p);
            }}
            className={`strip-cell${sel ? ' is-selected' : ''}${n ? '' : ' is-empty'}${i % 2 ? ' odd' : ''}${outside(focus?.phases, p, focus) ? ' is-dim' : ''}`}
            style={{ ['--accent' as string]: PHASE_ACCENT[p] }}
            data-n={n}
            title={`${PHASE_LABEL[p]}: ${n} live`}
            onClick={() => dispatch({ type: 'select', selection: { kind: 'gate', phase: p } })}
          >
            <span className="strip-step">{i + 1}</span>
            <span className="strip-name full">{PHASE_LABEL[p]}</span>
            <span className="strip-name short">{phaseTiny(p)}</span>
            <span className="strip-n">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

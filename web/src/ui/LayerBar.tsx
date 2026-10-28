import { toggleHorizon, useHorizon } from '../scene/horizon';
import { LAYER_HINT, LAYER_KEYS, LAYER_LABEL, isClean, useLayers, type LabelMode } from './layers';

const LABEL_MODES: LabelMode[] = ['auto', 'all', 'none'];

/** The layer bar under the top bar: what the world draws. Choices persist per viewer. */
export function LayerBar() {
  const l = useLayers();
  const clean = isClean(l);
  const horizon = useHorizon((s) => s.on);
  return (
    <div className="layerbar" role="toolbar" aria-label="Layers">
      <button className={`layer-btn clean${clean ? ' on' : ''}`} onClick={l.toggleClean} title="Clean: islands, pods and what needs you only (0)">
        Clean <kbd>0</kbd>
      </button>
      <span className="layer-sep" />
      {LAYER_KEYS.map((k) => (
        <button key={k} className={`layer-btn${l[k] ? ' on' : ''}`} aria-pressed={l[k]} title={LAYER_HINT[k]} onClick={() => l.toggle(k)}>
          <span className={`layer-tick layer-${k}`} />
          {LAYER_LABEL[k]}
        </button>
      ))}
      <span className="layer-sep" />
      <span className="layer-cap">Labels</span>
      <span className="seg">
        {LABEL_MODES.map((m) => (
          <button key={m} className={`seg-btn${l.labels === m ? ' on' : ''}`} aria-pressed={l.labels === m} onClick={() => l.setLabels(m)}>
            {m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </span>
      <span className="layer-sep" />
      {/* a camera mode, not a layer: lives at the end of the bar because the view tabs above are full */}
      <button className={`layer-btn horizon${horizon ? ' on' : ''}`} aria-pressed={horizon} onClick={toggleHorizon} title="Horizon view: tilt down to the sky, the skyline and the landmarks (H)">
        Horizon <kbd>H</kbd>
      </button>
    </div>
  );
}

import { chooseLayout, useWorldLayout, type WorldLayout } from './worldLayout';

const CHOICES: [WorldLayout, string, string][] = [
  ['grid', 'Grid', 'Grid: one row per session across the stage columns (I)'],
  ['islands', 'Islands', 'Big islands: one island per session with its own loop of track (I). Pipeline keeps the grid.'],
];

/** Top-bar switch between the grid and big islands, beside the view buttons. */
export function LayoutSwitch() {
  const mode = useWorldLayout((s) => s.mode);
  return (
    <div className="presets layout-switch" role="group" aria-label="World layout">
      {CHOICES.map(([id, label, title]) => (
        <button key={id} className={`preset${mode === id ? ' on' : ''}`} aria-pressed={mode === id} title={title} onClick={() => chooseLayout(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

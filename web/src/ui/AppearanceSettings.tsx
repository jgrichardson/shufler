import { useRef, useState } from 'react';
import { toast } from '../store';
import { listSkins, resolveSkin, useSkinStore } from '../skins/store';
import { parseSkinJson, toJsonTemplate } from '../skins/define';
import { usePrefs } from './prefs';

/** Saves `data` as a JSON file through a temporary link. */
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Skin picker. Code skins come from src/skins/ at build time; JSON recolours are imported here and kept
 * in this browser. "Export template" writes the active skin as an editable JSON recolour.
 */
export function AppearanceSettings() {
  const builtins = useSkinStore((s) => s.builtins);
  const imported = useSkinStore((s) => s.imported);
  const activeId = useSkinStore((s) => s.activeId);
  const setActive = useSkinStore((s) => s.setActive);
  const addImported = useSkinStore((s) => s.addImported);
  const removeImported = useSkinStore((s) => s.removeImported);
  const [error, setError] = useState<string | null>(null);
  const theme = usePrefs((s) => s.theme);
  const setPrefs = usePrefs((s) => s.set);
  const file = useRef<HTMLInputElement>(null);
  const skins = listSkins({ builtins, imported });
  const shown = resolveSkin({ builtins, imported, activeId })?.id;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const json = parseSkinJson(JSON.parse(await f.text()));
      if (!builtins.some((b) => b.id === json.extends)) throw new Error(`"extends": "${json.extends}" is not an installed skin`);
      addImported(json);
      setActive(json.id);
      toast(true, `Skin "${json.name}" imported`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  const exportTemplate = () => {
    const skin = resolveSkin({ builtins, imported, activeId });
    if (!skin) return;
    // a recolour of a recolour still extends the code skin underneath
    const base = imported.find((j) => j.id === skin.id)?.extends ?? skin.id;
    const tpl = toJsonTemplate(skin, base);
    download(`${tpl.id}.skin.json`, tpl);
  };

  return (
    <div className="settings-appearance">
      <div className="settings-section-title">Appearance</div>
      <div className="settings-row">
        <span className="settings-label">Theme</span>
        <span className="seg" role="radiogroup" aria-label="Theme">
          {(['dark', 'light', 'system'] as const).map((t) => (
            <button key={t} className={`seg-btn${theme === t ? ' on' : ''}`} role="radio" aria-checked={theme === t} onClick={() => setPrefs({ theme: t })}>
              {t === 'system' ? 'Match system' : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </span>
        <span className="muted small">Sets the panels and the 3D world's lighting; skins can tune their light colours.</span>
      </div>
      <div className="skin-list" role="radiogroup" aria-label="Skin">
        {skins.map((s) => (
          <div key={s.id} className={`skin-card${s.id === shown ? ' is-active' : ''}${s.imported && !s.base ? ' is-broken' : ''}`}>
            <button className="skin-pick" role="radio" aria-checked={s.id === shown} disabled={s.imported && !s.base} onClick={() => setActive(s.id)}>
              <span className="skin-name">{s.name}</span>
              <span className="muted small">
                {s.imported ? (s.base ? `Recolour of ${s.base}` : 'Base skin not installed') : (s.author ?? 'Built in')}
              </span>
              <span className="skin-desc small">{s.description}</span>
            </button>
            {s.imported && (
              <button className="btn ghost xs" aria-label={`Remove ${s.name}`} onClick={() => removeImported(s.id)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="btn-row">
        <button className="btn ghost" onClick={() => file.current?.click()}>
          Import skin JSON…
        </button>
        <button className="btn ghost" onClick={exportTemplate}>
          Export current as template
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {error && <div className="form-error small">{error}</div>}
      <span className="muted small">
        Imported skins recolour an installed one and stay in this browser. To change shapes, write a code skin: see docs/SKINS.md.
      </span>
    </div>
  );
}

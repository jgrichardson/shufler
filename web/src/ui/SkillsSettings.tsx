import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { Skill, SkillPlacement } from '../types';
import { placementOf } from './skills';
import { dispatch, toast, useWorld } from '../store';
import { useMotion } from './motionPrefs';
import { FOLLOW_PAUSE_CHOICES, usePrefs } from './prefs';
import { AppearanceSettings } from './AppearanceSettings';

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="settings-toggle">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
      <span className="muted small">{hint}</span>
    </div>
  );
}

function Choice<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <span className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} className={`seg-btn${v === value ? ' on' : ''}`} role="radio" aria-checked={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </span>
  );
}

function GeneralSettings() {
  const reduced = useMotion((s) => s.reduced);
  const setReduced = useMotion((s) => s.setReduced);
  const prefs = usePrefs();
  const following = prefs.terminalFollow === 'select';
  return (
    <div className="settings-general">
      <div className="settings-section-title">Terminal sync</div>
      <div className="settings-row">
        <span className="settings-label">When I switch session in my terminal</span>
        <Choice
          label="When I switch session in my terminal"
          value={prefs.terminalFollow}
          onChange={(terminalFollow) => prefs.set({ terminalFollow })}
          options={[
            ['select', 'Select it here'],
            ['mark', 'Only mark it'],
            ['off', 'Do nothing'],
          ]}
        />
        <span className="muted small">
          {prefs.terminalFollow === 'select'
            ? 'The session becomes the selection, so the rest greys out if that is on below.'
            : prefs.terminalFollow === 'mark'
              ? 'A marker shows which session the terminal is on; the world stays fully in view.'
              : 'The app ignores the terminal.'}
        </span>
      </div>
      <div className={`settings-row${following ? '' : ' is-off'}`}>
        <span className="settings-label">After I pick here, pause terminal sync for</span>
        <Choice
          label="Pause after a manual pick"
          value={prefs.followPauseSec}
          onChange={(followPauseSec) => prefs.set({ followPauseSec })}
          options={FOLLOW_PAUSE_CHOICES.map((n) => [n, n ? `${n}s` : 'no pause'] as [number, string])}
        />
      </div>
      <div className="settings-section-title">Selecting</div>
      <Toggle
        checked={prefs.selectDims}
        onChange={(selectDims) => prefs.set({ selectDims })}
        label="Grey out the rest"
        hint="Picking a row, domain, column or item greys out everything else. Off: it is outlined and the world stays lit."
      />
      <Toggle
        checked={prefs.flyOnSelect}
        onChange={(flyOnSelect) => prefs.set({ flyOnSelect })}
        label="Move the camera to it"
        hint="Off keeps your view where you left it. Enter always flies to the selection."
      />
      <Toggle
        checked={prefs.redArcsAlways}
        onChange={(redArcsAlways) => prefs.set({ redArcsAlways })}
        label="Always draw arcs to items that need you"
        hint="Red arcs from each session to its items that need you, all the time. Off: only for the item or session you hover or select."
      />
      <div className="settings-section-title">Context library</div>
      <Toggle
        checked={prefs.autoSendPinned}
        onChange={(autoSendPinned) => prefs.set({ autoSendPinned })}
        label="Auto-send pinned context to new sessions"
        hint="When a session starts or compacts and owes pinned library items, send them without the confirm panel. Off: the row shows a book chip and you send from the session's Context section."
      />
      <div className="settings-section-title">Motion</div>
      <Toggle checked={reduced} onChange={setReduced} label="Reduced motion" hint="Journeys, rides to the warehouse and the Pipeline morph take 0.3s." />
    </div>
  );
}

export const useSettings = create<{ open: boolean; set: (open: boolean) => void }>()((set) => ({ open: false, set: (open) => set({ open }) }));

interface ConfigMeta {
  config_file: string | null;
  writable: boolean;
}

interface Patch {
  skill: string;
  expose?: boolean;
  hide?: boolean;
  pin?: boolean;
  target?: string | null;
  args_template?: string | null;
  /** null clears it back to the default (the session panel). */
  placement?: SkillPlacement | null;
}

const PLACEMENTS: [SkillPlacement, string][] = [
  ['station', 'Session panel'],
  ['pr', 'PR panel'],
  ['global', 'World panel'],
  ['question', 'Ask box'],
  ['none', 'No button'],
];

async function saveSkill(patch: Patch): Promise<{ ok: boolean; error?: string }> {
  const s = useWorld.getState();
  if (s.mock) {
    const snap = s.snapshot;
    if (snap) {
      const skills = snap.skills.map((k) =>
        k.name !== patch.skill
          ? k
          : {
              ...k,
              exposed: patch.expose ?? k.exposed,
              pinned: patch.pin ?? k.pinned,
              target: patch.target !== undefined ? patch.target || null : k.target,
              args_template: patch.args_template !== undefined ? patch.args_template || null : k.args_template,
              placement: patch.placement !== undefined ? (patch.placement ?? undefined) : k.placement,
            },
      );
      dispatch({ type: 'snapshot', snapshot: { ...snap, skills }, at: Date.now() });
    }
    return { ok: true };
  }
  const res = await fetch('/api/config/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  if (res.status === 409) return { ok: false, error: body.error ?? 'The active config is the in-repo example. Copy it to your own config file first.' };
  return { ok: false, error: body.error ?? `HTTP ${res.status}` };
}

function SkillRow({ k, stations }: { k: Skill; stations: string[] }) {
  const [target, setTarget] = useState(k.target ?? '');
  const [tpl, setTpl] = useState(k.args_template ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTarget(k.target ?? '');
    setTpl(k.args_template ?? '');
  }, [k.target, k.args_template]);
  const dirty = target !== (k.target ?? '') || tpl !== (k.args_template ?? '');
  const send = async (patch: Omit<Patch, 'skill'>) => {
    setBusy(true);
    const r = await saveSkill({ skill: k.name, ...patch });
    setBusy(false);
    toast(r.ok, r.ok ? `Saved ${k.slash}` : `Could not save ${k.slash}`, r.error ?? '');
  };
  return (
    <tr className={k.exposed || k.pinned ? '' : 'row-dim'}>
      <td>
        <div className="mono strong">{k.slash}</div>
        <div className="muted small clamp1" title={k.description}>
          {k.description}
        </div>
      </td>
      <td className="muted small">{k.scope}</td>
      <td>
        <input type="checkbox" checked={k.exposed} disabled={busy} onChange={(e) => send({ expose: e.target.checked })} aria-label={`Expose ${k.slash}`} />
      </td>
      <td>
        <input type="checkbox" checked={k.pinned} disabled={busy} onChange={(e) => send({ pin: e.target.checked })} aria-label={`Pin ${k.slash}`} />
      </td>
      <td>
        <select className="input xs" value={placementOf(k)} disabled={busy} aria-label={`Where ${k.slash} shows`} onChange={(e) => send({ placement: e.target.value as SkillPlacement })}>
          {PLACEMENTS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select className="input xs" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">selected session</option>
          {stations.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {target && !stations.includes(target) && <option value={target}>{target}</option>}
        </select>
      </td>
      <td>
        <input className="input xs mono" value={tpl} placeholder={k.args_hint ?? 'no args'} onChange={(e) => setTpl(e.target.value)} />
      </td>
      <td>
        <button className="btn xs" disabled={!dirty || busy} onClick={() => send({ target: target || null, args_template: tpl || null })}>
          Save
        </button>
      </td>
    </tr>
  );
}

export function SkillsSettings() {
  const open = useSettings((s) => s.open);
  const setOpen = useSettings((s) => s.set);
  const skills = useWorld((s) => s.snapshot?.skills);
  const stationList = useWorld((s) => s.snapshot?.stations);
  const mock = useWorld((s) => s.mock);
  const [q, setQ] = useState('');
  const [onlyExposed, setOnlyExposed] = useState(true);
  const [meta, setMeta] = useState<ConfigMeta | null>(null);

  useEffect(() => {
    if (!open || mock) return;
    fetch('/api/config/skills')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMeta({ config_file: d.config_file ?? null, writable: !!d.writable }))
      .catch(() => setMeta(null));
  }, [open, mock]);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (skills ?? [])
      .filter((k) => (!onlyExposed || k.exposed || k.pinned) && (!ql || k.name.toLowerCase().includes(ql) || k.description.toLowerCase().includes(ql)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.exposed) - Number(a.exposed) || a.name.localeCompare(b.name));
  }, [skills, q, onlyExposed]);

  if (!open) return null;
  const stations = Array.from(new Set((stationList ?? []).map((x) => x.title))).sort();
  return (
    <div className="drawer settings-drawer glass open" role="dialog" aria-label="Settings">
      <div className="drawer-head">
        <div className="drawer-title">Settings</div>
        <button className="btn ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="settings-body">
        <AppearanceSettings />
        <GeneralSettings />
        <div className="settings-section-title settings-skills-title">Skills</div>
        <div className="form-hint">
          {mock
            ? 'Mock mode: changes apply to this page only.'
            : meta
              ? meta.writable
                ? `Saved to ${meta.config_file ?? 'config.toml'}. Exposed skills show in the palette, pinned ones also show as buttons.`
                : 'The daemon reports this config as read-only.'
              : 'Loading config…'}
        </div>
        <div className="settings-filters">
          <input className="input" placeholder="Filter skills" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={onlyExposed} onChange={(e) => setOnlyExposed(e.target.checked)} /> Exposed or pinned only
          </label>
          <span className="muted small">{list.length} shown</span>
        </div>
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Scope</th>
                <th>Expose</th>
                <th>Pin</th>
                <th>Button in</th>
                <th>Default session</th>
                <th>Args template</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 200).map((k) => (
                <SkillRow key={k.name} k={k} stations={stations} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast, useWorld } from '../../store';
import { addGrant, browse, deleteGrant, deleteItem, resolveDrop, saveItem, type BrowseEntry, type ResolveResult } from '../../api/library';
import { dropSpecs, filterItems, parseDroppedText, parseTarget, shortPath, statusText, type GrantMode, type LibraryItem } from '../../lib/library';
import { domainDef } from '../../lib/domains';
import { CLI_NAME } from '../../lib/brand';
import { openSend, refreshLibrary, useLibrary } from './store';
import { startCardDrag, useLibDrag } from './drag';

/* Library management (design/LIBRARY.md), shown in the right panel when the library building is selected: drop zone, path field, item cards, search and the grant menu. */

function targetLabel(target: string, titles: Map<string, string>): string {
  const t = parseTarget(target);
  if (t.kind === 'all') return 'All sessions';
  if (t.kind === 'domain') return domainDef(t.id).label;
  return titles.get(t.id) ?? t.id;
}

// ------------------------------------------------------------ getting files in

interface DraftEntry {
  key: string;
  name: string;
  status: 'one' | 'many' | 'none' | 'path';
  matches: string[];
  chosen: string;
}

async function readEntries(entry: FileSystemEntry): Promise<string[]> {
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  return new Promise((done) => reader.readEntries((list) => done(list.slice(0, 8).map((e) => e.name)), () => done([])));
}

/** Names the browser gives for a drop (files and folders via webkitGetAsEntry), plus any absolute paths in dropped text. */
async function readDrop(dt: DataTransfer): Promise<{ specs: ReturnType<typeof dropSpecs>; paths: string[] }> {
  const raw: { name: string; isDirectory: boolean; children?: string[] }[] = [];
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  for (const e of entries) raw.push({ name: e.name, isDirectory: e.isDirectory, children: await readEntries(e) });
  if (!entries.length) for (const f of Array.from(dt.files)) raw.push({ name: f.name, isDirectory: false });
  const text = dt.getData('text/uri-list') || dt.getData('text/plain');
  return { specs: dropSpecs(raw), paths: text ? parseDroppedText(text) : [] };
}

function PathField({ onAdd }: { onAdd: (path: string) => void }) {
  const [value, setValue] = useState('');
  const [list, setList] = useState<BrowseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) return;
    let live = true;
    const t = setTimeout(() => {
      browse(value)
        .then((r) => live && (setList(r.entries.slice(0, 40)), setError(null), setActive(0)))
        .catch((e: Error) => live && (setList([]), setError(value ? e.message : null)));
    }, 140);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [value, focused]);
  const pick = (e: BrowseEntry) => setValue(e.kind === 'dir' ? `${e.path}/` : e.path);
  const add = () => {
    const v = value.trim().replace(/(.)\/+$/, '$1');
    if (!v) return;
    onAdd(v);
    setValue('');
  };
  return (
    <div className="lib-path">
      <div className="lib-path-row">
        <input
          className="input mono xs"
          value={value}
          spellCheck={false}
          placeholder="~/path/to/file-or-folder  (Tab completes)"
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && list[active]) {
              e.preventDefault();
              pick(list[active]);
            } else if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, list.length - 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            else if (e.key === 'Enter') add();
            else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        <button className="btn xs" disabled={!value.trim()} onClick={add}>
          Add
        </button>
      </div>
      {focused && (list.length > 0 || error) && (
        <div className="lib-suggest" role="listbox">
          {error && <div className="lib-suggest-err">{error}</div>}
          {list.map((e, i) => (
            <button key={e.path} role="option" aria-selected={i === active} className={`lib-suggest-row${i === active ? ' on' : ''}`} onMouseDown={(ev) => (ev.preventDefault(), pick(e))}>
              <span className={`lib-kind ${e.kind}`}>{e.kind === 'dir' ? '▸' : '·'}</span>
              <span className="mono">{e.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Draft({ entries, setEntries, items }: { entries: DraftEntry[]; setEntries: (e: DraftEntry[]) => void; items: LibraryItem[] }) {
  const first = entries[0]?.name.split('/').pop() ?? '';
  const [name, setName] = useState(first.replace(/[_-]+/g, ' ').replace(/\.\w+$/, ''));
  const [tags, setTags] = useState('');
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = entries.filter((e) => e.chosen.trim());
  const set = (key: string, chosen: string) => setEntries(entries.map((e) => (e.key === key ? { ...e, chosen } : e)));
  const save = async () => {
    setBusy(true);
    try {
      const base = items.find((i) => i.id === into);
      const paths = ready.map((e) => e.chosen.trim());
      const it = base
        ? await saveItem({ id: base.id, name: base.name, description: base.description, tags: base.tags, paths: [...base.paths, ...paths] })
        : await saveItem({ name: name.trim(), paths, tags: tags.split(/[,\s]+/).filter(Boolean) });
      toast(true, base ? `Added to ${it.name}` : `Added ${it.name} to the library`, paths.map(shortPath).join('\n'));
      setEntries([]);
      void refreshLibrary();
    } catch (e) {
      toast(false, 'Could not save to the library', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lib-draft">
      {entries.map((e) => (
        <div key={e.key} className="lib-draft-row">
          <div className="lib-draft-name">
            <span className="mono">{e.name}</span>
            <span className={`lib-tag ${e.status === 'none' ? 'bad' : e.status === 'many' ? 'warn' : 'ok'}`}>
              {e.status === 'one' ? 'found' : e.status === 'many' ? `${e.matches.length} matches, pick one` : e.status === 'none' ? 'not found, paste the path' : 'path'}
            </span>
            <button className="link" aria-label="Remove" onClick={() => setEntries(entries.filter((x) => x.key !== e.key))}>
              ×
            </button>
          </div>
          {e.status === 'many' ? (
            <div className="lib-picks">
              {e.matches.map((m) => (
                <label key={m} className="check mono small">
                  <input type="radio" name={e.key} checked={e.chosen === m} onChange={() => set(e.key, m)} /> {shortPath(m)}
                </label>
              ))}
            </div>
          ) : e.status === 'none' ? (
            <input className="input mono xs" placeholder="/absolute/path (Finder: ⌥⌘C copies it)" value={e.chosen} onChange={(ev) => set(e.key, ev.target.value)} />
          ) : (
            <div className="mono small muted">{shortPath(e.chosen)}</div>
          )}
        </div>
      ))}
      <div className="lib-draft-form">
        <select className="input xs" value={into} onChange={(e) => setInto(e.target.value)} aria-label="Save as">
          <option value="">New item</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              Add to {i.name}
            </option>
          ))}
        </select>
        {!into && (
          <>
            <input className="input xs" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input xs" placeholder="tags, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} />
          </>
        )}
        <div className="btn-row">
          <button className="btn ghost xs" onClick={() => setEntries([])}>
            Cancel
          </button>
          <button className="btn primary xs" disabled={busy || !ready.length || (!into && !name.trim())} onClick={save}>
            {into ? 'Add paths' : 'Add to library'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ granting

function GrantMenu({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const stations = useWorld((s) => s.snapshot?.stations) ?? [];
  const utility = useWorld((s) => s.snapshot?.utility_stations) ?? [];
  const domains = useWorld((s) => s.snapshot?.domains) ?? [];
  const [mode, setMode] = useState<GrantMode>('pinned');
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('mousedown', off);
      window.removeEventListener('keydown', esc, true);
    };
  }, [onClose]);
  const ql = q.toLowerCase();
  const sessions = [...stations.map((s) => ({ id: s.id, title: s.title, domain: s.domain as string | null })), ...utility.map((u) => ({ id: u.id, title: u.title, domain: null }))].filter((s) => !ql || s.title.toLowerCase().includes(ql));
  const doms = domains.filter((d) => !ql || d.label.toLowerCase().includes(ql) || d.id.includes(ql));
  const grant = async (target: string) => {
    const t = parseTarget(target);
    // once to one session is simply a send; once to a domain marks each of its sessions as owed until sent
    if (mode === 'once' && t.kind === 'station') {
      onClose();
      return openSend(t.id, [item.id]);
    }
    try {
      await addGrant(item.id, target, mode);
      toast(true, `${item.name}: ${mode} for ${t.kind === 'all' ? 'all sessions' : t.kind === 'domain' ? domainDef(t.id).label : stations.find((s) => s.id === t.id)?.title ?? t.id}`, mode === 'pinned' ? 'Sessions that have not had it show a book chip; send from the row chip or the session panel.' : '');
      void refreshLibrary();
      onClose();
    } catch (e) {
      toast(false, 'Could not grant', (e as Error).message);
    }
  };
  return (
    <div className="lib-menu glass" ref={ref} role="menu" aria-label={`Make ${item.name} available to`}>
      <div className="lib-menu-head">
        <span className="modal-kicker">Make available to…</span>
        <span className="seg" role="radiogroup" aria-label="Mode">
          {(['pinned', 'once'] as const).map((m) => (
            <button key={m} className={`seg-btn${mode === m ? ' on' : ''}`} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} title={m === 'pinned' ? 'Always: offered whenever a matching session starts or compacts' : 'One-off: a session gets the send panel now; a domain owes it until each session gets it once'}>
              {m === 'pinned' ? 'Pinned' : 'Once'}
            </button>
          ))}
        </span>
      </div>
      <input className="input xs" autoFocus placeholder="Filter sessions and domains" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="lib-menu-list">
        {!ql && (
          <button className="lib-menu-row" onClick={() => grant('all')}>
            <span className="lib-menu-kind">all</span> All sessions
          </button>
        )}
        {doms.length > 0 && <div className="lib-menu-sub">Domains</div>}
        {doms.map((d) => (
          <button key={d.id} className="lib-menu-row" onClick={() => grant(`domain:${d.id}`)}>
            <span className="lib-swatch" style={{ background: d.color }} /> {d.label} <span className="muted small">{d.station_ids.length} session{d.station_ids.length === 1 ? '' : 's'}</span>
          </button>
        ))}
        {sessions.length > 0 && <div className="lib-menu-sub">Sessions</div>}
        {sessions.map((s) => (
          <button key={s.id} className="lib-menu-row" onClick={() => grant(`station:${s.id}`)}>
            <span className="lib-swatch" style={{ background: s.domain ? domainDef(s.domain).color : 'var(--faint)' }} /> {s.title}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ cards

/** Dev only: ?libmenu=<item id> opens that card's grant menu (for screenshots). */
const DEV_MENU = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('libmenu') : null;

function ItemCard({ item, titles }: { item: LibraryItem; titles: Map<string, string> }) {
  const allGrants = useLibrary((s) => s.data?.grants);
  const grants = useMemo(() => (allGrants ?? []).filter((g) => g.item_id === item.id), [allGrants, item.id]);
  const [menu, setMenu] = useState(DEV_MENU === item.id);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(item.name);
  const [desc, setDesc] = useState(item.description);
  const [tags, setTags] = useState(item.tags.join(', '));
  const dragging = useLibDrag((s) => !!s.itemIds?.includes(item.id));
  const missing = (item.status ?? []).filter((s) => !s.exists).length;
  const save = async (paths = item.paths) => {
    try {
      await saveItem({ id: item.id, name, description: desc, paths, tags: tags.split(/[,\s]+/).filter(Boolean) });
      setEditing(false);
      void refreshLibrary();
    } catch (e) {
      toast(false, 'Could not save', (e as Error).message);
    }
  };
  const remove = async () => {
    try {
      await deleteItem(item.id);
      toast(true, `Removed ${item.name} from the library`, 'The files themselves are untouched.');
      void refreshLibrary();
    } catch (e) {
      toast(false, 'Could not remove', (e as Error).message);
    }
  };
  return (
    <div className={`lib-card${dragging ? ' is-dragging' : ''}${missing ? ' has-missing' : ''}`}>
      <div className="lib-card-head" onPointerDown={(e) => !(e.target as HTMLElement).closest('button,input,textarea') && startCardDrag(e, [item.id], item.name)} title="Drag onto a row or a session to send it">
        <span className="lib-grip" aria-hidden>
          ⋮⋮
        </span>
        {editing ? <input className="input xs" value={name} onChange={(e) => setName(e.target.value)} /> : <span className="lib-card-name">{item.name}</span>}
        <span className="lib-card-tools">
          <button className="btn xs" onClick={() => setMenu(!menu)} aria-expanded={menu}>
            Make available to…
          </button>
          <button className="btn ghost xs" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </span>
      </div>
      {menu && <GrantMenu item={item} onClose={() => setMenu(false)} />}
      {editing ? (
        <div className="lib-edit">
          <textarea className="input xs" rows={2} placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <input className="input xs" placeholder="tags, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} />
          <div className="btn-row">
            {confirmDelete ? (
              <button className="btn danger xs" onClick={remove}>
                Remove from library
              </button>
            ) : (
              <button className="btn ghost xs" onClick={() => setConfirmDelete(true)}>
                Delete…
              </button>
            )}
            <button className="btn primary xs" disabled={!name.trim()} onClick={() => save()}>
              Save
            </button>
          </div>
        </div>
      ) : (
        item.description && <div className="lib-desc">{item.description}</div>
      )}
      <ul className="lib-paths">
        {item.paths.map((p, i) => {
          const st = item.status?.[i];
          return (
            <li key={p} className={st && !st.exists ? 'is-missing' : ''} title={p}>
              <span className={`lib-mark ${st?.exists === false ? 'bad-text' : 'ok-text'}`}>{st?.exists === false ? '✕' : '✓'}</span>
              <span className="mono lib-path-text">{shortPath(p)}</span>
              <span className="muted small lib-path-meta">{statusText(st)}</span>
              {editing && item.paths.length > 1 && (
                <button className="link" aria-label={`Remove ${p}`} onClick={() => save(item.paths.filter((x) => x !== p))}>
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {(item.tags.length > 0 || grants.length > 0) && (
        <div className="lib-chips">
          {item.tags.map((t) => (
            <span key={t} className="lib-tag">
              #{t}
            </span>
          ))}
          {grants.map((g) => {
            const t = parseTarget(g.target);
            return (
              <span key={g.id} className={`lib-grant ${g.mode}`} title={`${g.mode === 'pinned' ? 'Pinned' : 'Once'} for ${targetLabel(g.target, titles)}`}>
                {t.kind === 'domain' && <span className="lib-swatch" style={{ background: domainDef(t.id).color }} />}
                {t.kind === 'domain' ? domainDef(t.id).label.toUpperCase() : t.kind === 'all' ? 'all' : targetLabel(g.target, titles)}
                {g.mode === 'once' && <span className="lib-grant-mode">once</span>}
                <button
                  className="link"
                  aria-label={`Remove grant for ${targetLabel(g.target, titles)}`}
                  onClick={() =>
                    deleteGrant(g.id)
                      .then(() => refreshLibrary())
                      .catch((e: Error) => toast(false, 'Could not remove the grant', e.message))
                  }
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LibDragGhost() {
  const d = useLibDrag();
  const titles = useWorld((s) => s.snapshot?.stations);
  if (!d.itemIds) return null;
  const over = d.over ? (titles?.find((s) => s.id === d.over)?.title ?? d.over) : null;
  return (
    <div className="lib-ghost glass" style={{ left: d.x + 14, top: d.y + 10 }}>
      <b>{d.label}</b>
      <span className={over ? 'ok-text' : 'muted'}>{over ? `→ send to ${over}` : 'drop on a row or a session'}</span>
    </div>
  );
}

/** After a drop on a session that has a domain: send to just that session, or pin for every session in the domain. */
export function LibDropChooser() {
  const p = useLibDrag((s) => s.pending);
  const stations = useWorld((s) => s.snapshot?.stations);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => useLibDrag.setState({ pending: null });
  useEffect(() => {
    if (!p) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), close());
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('mousedown', off);
      window.removeEventListener('keydown', esc, true);
    };
  }, [p]);
  if (!p) return null;
  const title = stations?.find((s) => s.id === p.stationId)?.title ?? p.stationId;
  const dom = domainDef(p.domain);
  const peers = (stations ?? []).filter((s) => s.domain === p.domain).length;
  const justHere = () => {
    close();
    openSend(p.stationId, p.itemIds);
  };
  const wholeDomain = async () => {
    close();
    try {
      for (const id of p.itemIds) await addGrant(id, `domain:${p.domain}`, 'pinned');
      toast(true, `${p.label}: pinned for ${dom.label}`, 'Every session in the domain, now and future, is offered it; sending here now.');
      void refreshLibrary();
      openSend(p.stationId, p.itemIds);
    } catch (e) {
      toast(false, 'Could not pin', (e as Error).message);
    }
  };
  const left = Math.min(p.x + 12, window.innerWidth - 300);
  const top = Math.min(p.y + 8, window.innerHeight - 170);
  return (
    <div className="lib-menu lib-drop-choice glass" ref={ref} role="menu" aria-label={`Send ${p.label}`} style={{ position: 'fixed', left, top }}>
      <span className="modal-kicker">Send {p.label} to…</span>
      <button className="lib-menu-row" autoFocus onClick={justHere}>
        <b>Just {title}</b> <span className="muted small">this session, now</span>
      </button>
      <button className="lib-menu-row" onClick={wholeDomain}>
        <span className="lib-swatch" style={{ background: dom.color }} /> <b>Every {dom.label} session</b>
        <span className="muted small">pinned · {peers} now, plus new ones</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------ panel

export function LibraryManager() {
  const data = useLibrary((s) => s.data);
  const error = useLibrary((s) => s.error);
  const loading = useLibrary((s) => s.loading);
  const mock = useWorld((s) => s.mock);
  const stations = useWorld((s) => s.snapshot?.stations);
  const utility = useWorld((s) => s.snapshot?.utility_stations);
  const [q, setQ] = useState('');
  const [over, setOver] = useState(false);
  const [draft, setDraft] = useState<DraftEntry[]>([]);
  const [resolving, setResolving] = useState(false);
  const titles = useMemo(() => new Map([...(stations ?? []), ...(utility ?? [])].map((s) => [s.id, s.title])), [stations, utility]);
  const items = useMemo(() => filterItems(data?.items ?? [], q), [data, q]);

  const addEntries = (more: DraftEntry[]) => setDraft((cur) => [...cur, ...more.filter((m) => !cur.some((c) => c.key === m.key))]);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const { specs, paths } = await readDrop(e.dataTransfer);
    if (paths.length) addEntries(paths.map((p) => ({ key: p, name: p.split('/').pop() || p, status: 'path', matches: [p], chosen: p })));
    if (!specs.length) return;
    setResolving(true);
    try {
      const res: ResolveResult[] = await resolveDrop(specs);
      addEntries(res.map((r) => ({ key: `drop:${r.name}`, name: r.name, status: r.status, matches: r.matches, chosen: r.status === 'one' ? r.matches[0] : '' })));
    } catch (err) {
      toast(false, 'Could not resolve the drop', (err as Error).message);
      addEntries(specs.map((s) => ({ key: `drop:${s.name}`, name: s.name, status: 'none', matches: [], chosen: '' })));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="lib-manager" aria-label="Context library">
      <div className="lib-intro muted small">Files and folders any session can be handed. Nothing is copied; sends point at the live files. Drag a card onto a row or a session to send it.</div>
      <div
        className={`lib-drop${over ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div className="lib-drop-title">{resolving ? 'Finding those in your sessions’ folders…' : 'Drop files or folders here'}</div>
        <div className="muted small">The browser only gives names; they are matched against the session folders. Or type a path:</div>
        <PathField onAdd={(p) => addEntries([{ key: p, name: p.split('/').pop() || p, status: 'path', matches: [p], chosen: p }])} />
      </div>
      {draft.length > 0 && <Draft key={draft[0].key} entries={draft} setEntries={setDraft} items={data?.items ?? []} />}
      <div className="lib-search">
        <input className="input xs" placeholder="Search names, tags and paths" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">
          {items.length}/{data?.items.length ?? 0}
        </span>
      </div>
      <div className="lib-list">
        {error && <div className="refusal">{error}</div>}
        {!data && loading && <div className="muted pad">Loading the library…</div>}
        {data && !data.items.length && <div className="muted pad">Nothing here yet. Drop a folder above, or run {CLI_NAME} library add &lt;path&gt;.</div>}
        {data && data.items.length > 0 && !items.length && (
          <div className="muted pad">
            Nothing matches “{q.trim()}”.{' '}
            <button className="link" onClick={() => setQ('')}>
              Clear the search
            </button>
          </div>
        )}
        {items.map((it) => (
          <ItemCard key={it.id} item={it} titles={titles} />
        ))}
      </div>
      <div className="lib-foot muted small">{mock ? 'Mock library: changes last until reload.' : data?.file ? `Saved in ${shortPath(data.file)}` : ''}</div>
    </div>
  );
}

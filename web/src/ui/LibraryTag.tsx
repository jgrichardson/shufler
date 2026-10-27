import { selectLibrary, useWorld } from '../store';
import { owedSessions } from '../lib/library';
import { libTag } from '../scene/Library';
import { useFocus } from '../scene/focus';

/** The name tag floating over the library building; scene/Library.tsx places it every frame. */
export function LibraryTag() {
  const hasData = useWorld((s) => !!s.snapshot);
  const items = useWorld((s) => s.snapshot?.library?.items ?? 0);
  const owed = useWorld((s) => owedSessions(s.snapshot?.library?.owed));
  const selected = useWorld((s) => s.selection?.kind === 'library');
  const focus = useFocus();
  if (!hasData) return null;
  return (
    <button
      ref={(el) => void (libTag.el = el)}
      className={`lib-sign${selected ? ' is-selected' : ''}${focus && !focus.library ? ' is-dim' : ''}`}
      title={`Context library: ${items} item${items === 1 ? '' : 's'}${owed ? `, pinned context owed to ${owed} session${owed === 1 ? '' : 's'}` : ''} (L)`}
      onClick={() => selectLibrary()}
    >
      <span className="lib-sign-name">Library</span>
      <span className="strip-n">{items}</span>
      {owed > 0 && (
        <span className="owed-chip" aria-label={`${owed} owed`}>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
            <path d="M2 2.2c1.4-.6 2.8-.5 4 .4 1.2-.9 2.6-1 4-.4v7.6c-1.4-.6-2.8-.5-4 .4-1.2-.9-2.6-1-4-.4z M6 2.6v7.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          {owed}
        </span>
      )}
    </button>
  );
}

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Next focus target for Tab inside a dialog: wraps from the last control to the first and back. Pure, for tests. */
export function wrapFocus<T>(list: T[], current: T | null, back: boolean): T | null {
  if (!list.length) return null;
  const i = current == null ? -1 : list.indexOf(current);
  if (i < 0) return back ? list[list.length - 1] : list[0];
  if (back && i === 0) return list[list.length - 1];
  if (!back && i === list.length - 1) return list[0];
  return null; // inside the list: let the browser move focus
}

/**
 * Keeps Tab inside a modal dialog while `active`, focuses `initial` (or the first control) when it opens,
 * and hands focus back to whatever had it before when it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean, initial?: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!active) return;
    const before = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) (initial?.current ?? root.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      const next = wrapFocus(list, document.activeElement as HTMLElement | null, e.shiftKey);
      if (!next) return;
      e.preventDefault();
      next.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (before && document.contains(before)) before.focus();
    };
  }, [ref, active, initial]);
}

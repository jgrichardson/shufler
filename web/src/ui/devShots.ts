import { useEffect } from 'react';
import { dispatch, toast, useWorld } from '../store';
import { usePalette } from './Palette';
import { openTerminal } from './terminals';
import { useLibDrag } from './library/drag';
import { requestAction } from './requestAction';
import { REVIEWER_NAME } from '../lib/brand';

/*
 * Dev only: URL params that open chrome states a headless screenshot cannot click to. They run once, a few
 * seconds after load (after DevProbe's ?sel= and ?preset=), and do nothing in a production build.
 *   ?help=1  ?palette=1  ?cmd=<id> (the command drawer on that command)  ?toast=1 (one ok, one failed)  ?term=1 (normal + prod tab)
 *   ?confirm=merge|dispatch  ?chooser=1 (library drop chooser)  ?ghost=1 (library drag ghost)
 *   ?hover=N (tooltip for the Nth station)  ?unreachable=1 (the daemon-down screen)  ?tab=fleet|conversation|actions|data
 *   ?focus=<css selector> (keyboard-style focus on the first match, to check focus rings)
 */
export function useDevShots() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const qs = new URLSearchParams(window.location.search);
    if (![...qs.keys()].some((k) => ['help', 'palette', 'cmd', 'toast', 'term', 'confirm', 'chooser', 'ghost', 'hover', 'unreachable', 'tab', 'focus'].includes(k))) return;
    const t = setTimeout(() => {
      const snap = useWorld.getState().snapshot;
      const st = snap?.stations[0];
      if (qs.get('help') === '1') dispatch({ type: 'help', open: true });
      if (qs.get('palette') === '1') usePalette.getState().set(true);
      const cmd = qs.get('cmd');
      if (cmd) dispatch({ type: 'command_drawer', open: true, id: cmd });
      if (qs.get('toast') === '1') {
        toast(true, 'Sent to CONTROL', 'cmux send --workspace 3 "status"');
        toast(false, 'Merge refused', `${REVIEWER_NAME} has not approved the current head.`);
      }
      if (qs.get('term') === '1') {
        void openTerminal({ title: st?.title ?? 'Terminal' });
        void openTerminal({ title: 'Prod console', preset: 'prod_console' });
      }
      const confirm = qs.get('confirm');
      const w = snap?.workpieces.find((x) => x.pr != null);
      if (confirm === 'merge' && w) requestAction('merge', { pr: w.pr!, typed_confirmation: '' });
      if (confirm === 'dispatch' && st) requestAction('dispatch', { station_id: st.id, text: 'Rebase on main and push.' });
      if (qs.get('chooser') === '1' && st) useLibDrag.setState({ pending: { stationId: st.id, domain: st.domain, itemIds: ['lib_0000a001'], label: 'Billing context', x: 520, y: 360 } });
      if (qs.get('ghost') === '1') useLibDrag.setState({ itemIds: ['lib_0000a001'], label: 'Billing context', x: 520, y: 360, over: st?.id ?? null });
      const hover = qs.get('hover');
      const hs = hover != null ? snap?.stations[Number(hover)] : undefined;
      if (hs) dispatch({ type: 'hover', hover: { kind: 'station', id: hs.id, x: 420, y: 300 } });
      const focus = qs.get('focus');
      if (focus) document.querySelector<HTMLElement>(focus)?.focus();
      if (qs.get('unreachable') === '1') useWorld.setState({ snapshot: null, wsFailures: 99, conn: 'closed' });
    }, 5000);
    // a tab only sticks once DevProbe's ?sel= has landed (selecting resets the tab)
    const tab = qs.get('tab');
    const wantSel = qs.has('sel');
    const poll = tab
      ? setInterval(() => {
          if (wantSel && !useWorld.getState().selection) return;
          dispatch({ type: 'tab', tab: tab as never });
          clearInterval(poll);
        }, 400)
      : undefined;
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
  }, []);
}

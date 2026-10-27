import { useEffect } from 'react';
import { useWorld } from '../../store';
import { usePrefs } from '../prefs';
import { executeAction } from '../requestAction';

/*
 * Settings → "Auto-send pinned context to new sessions" (off by default). When on, owed items go out
 * without the confirm panel. Each station, session, compaction count and item set is tried once per
 * tab, so a failed send never loops; one send at a time keeps cmux calls serial.
 */
const tried = new Set<string>();
let busy = false;

export function useAutoSendContext() {
  useEffect(() => {
    const check = async () => {
      if (busy || !usePrefs.getState().autoSendPinned) return;
      const snap = useWorld.getState().snapshot;
      for (const [sid, ids] of Object.entries(snap?.library?.owed ?? {})) {
        const st = snap?.stations.find((s) => s.id === sid);
        if (st && st.claude && !st.claude.running) continue;
        const key = `${sid}|${st?.session_id ?? ''}|${st?.telemetry?.compactions ?? ''}|${[...ids].sort().join(',')}`;
        if (tried.has(key)) continue;
        tried.add(key);
        busy = true;
        try {
          await executeAction('library_send', { station_id: sid, item_ids: ids.join(',') }, `Auto-sent pinned context to ${st?.title ?? sid}`);
        } finally {
          busy = false;
        }
        return; // the next snapshot carries on with the rest
      }
    };
    const offSnap = useWorld.subscribe((s, prev) => s.snapshot !== prev.snapshot && void check());
    const offPref = usePrefs.subscribe((s, prev) => s.autoSendPinned && !prev.autoSendPinned && void check());
    return () => {
      offSnap();
      offPref();
    };
  }, []);
}

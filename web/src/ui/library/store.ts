import { create } from 'zustand';
import { useWorld } from '../../store';
import { fetchLibrary } from '../../api/library';
import type { LibraryData } from '../../lib/library';
import type { ActionParams } from '../../types';
import { requestAction } from '../requestAction';

interface LibraryState {
  data: LibraryData | null;
  loading: boolean;
  error: string | null;
}

/** Library contents. Managed in the right panel when the library building is selected (selection kind 'library'). */
export const useLibrary = create<LibraryState>()(() => ({
  data: null,
  loading: false,
  error: null,
}));

let inflight: Promise<void> | null = null;

export function refreshLibrary(): Promise<void> {
  if (inflight) return inflight;
  useLibrary.setState({ loading: true });
  inflight = fetchLibrary()
    .then((data) => useLibrary.setState({ data, error: data.error ?? null }))
    .catch((e: Error) => useLibrary.setState({ error: e.message }))
    .finally(() => {
      inflight = null;
      useLibrary.setState({ loading: false });
    });
  return inflight;
}

/** Loads once for whoever needs the library first (library panel, session panel). */
export function ensureLibrary() {
  if (!useLibrary.getState().data && !inflight) void refreshLibrary();
}

// item counts move when the CLI or another tab edits the library; follow them. Opening the panel refreshes too.
useWorld.subscribe((s, prev) => {
  if (s.snapshot?.library?.items !== prev.snapshot?.library?.items && useLibrary.getState().data) void refreshLibrary();
  else if (s.selection?.kind === 'library' && prev.selection?.kind !== 'library') void refreshLibrary();
});

/** The single way the UI sends library context: the send confirm with the composed, editable message. */
export function openSend(stationId: string, itemIds: string[], note?: string) {
  if (!itemIds.length) return;
  const params: ActionParams = { station_id: stationId, item_ids: itemIds.join(',') };
  if (note) params.note = note;
  requestAction('library_send', params);
}

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { dispatch, selectLibrary, useWorld } from '../store';
import type { Phase } from '../types';
import { useSettings } from '../ui/SkillsSettings';
import { openSend } from '../ui/library/store';
import { usePrefs } from '../ui/prefs';

const QS = new URLSearchParams(window.location.search);
const CAM = QS.get('cam')?.split(',').map(Number);
/** ?sel=gate:review | domain:billing | item:#412 | station:N (Nth station) | library */
const SEL = QS.get('sel');
/** ?settings=1 opens the settings drawer (for screenshots of the skin picker). */
const SETTINGS = QS.get('settings') === '1';
/** ?library=1 (or ?libmenu=<item id>, which also opens that card's grant menu) selects the library and flies there, like the L key. */
const LIBRARY = QS.get('library') === '1' || QS.has('libmenu');
/** ?libsend=N opens the library send confirm for the Nth station with the first library item. */
const LIBSEND = QS.get('libsend');
/** ?preset=pipeline|needs|shipped|domain switches the view (for screenshots). */
const PRESET = QS.get('preset');
/** ?theme=light|dark|system sets the theme (for screenshots), at load so the first frame already has it. */
const THEME = QS.get('theme');
if (import.meta.env.DEV && (THEME === 'light' || THEME === 'dark' || THEME === 'system')) usePrefs.getState().set({ theme: THEME });

function devSelect(spec: string) {
  const [kind, arg] = spec.split(':');
  const snap = useWorld.getState().snapshot;
  if (!snap) return;
  if (kind === 'gate') dispatch({ type: 'select', selection: { kind: 'gate', phase: arg as Phase } });
  else if (kind === 'domain') dispatch({ type: 'select', selection: { kind: 'domain', id: arg } });
  else if (kind === 'item') {
    const w = snap.workpieces.find((x) => `#${x.pr}` === arg || x.id === arg);
    if (w) dispatch({ type: 'select', selection: { kind: 'item', id: w.id } });
  } else if (kind === 'library') selectLibrary();
  else if (kind === 'station') {
    const st = snap.stations[Number(arg)];
    if (st) dispatch({ type: 'select', selection: { kind: 'station', id: st.id } });
  }
}

/** Dev only: window.__probe(x, y) resolves with the rendered RGBA at that canvas pixel, read after the composer. ?cam=x,y,z,tx,ty,tz frames a fixed shot, ?sel= selects something and ?settings=1 opens Settings once the rig settles. */
export function DevProbe() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target?: { set: (x: number, y: number, z: number) => void }; update?: () => void } | null;
  const placed = useRef(false);
  useFrame(({ clock }) => {
    if (placed.current || clock.elapsedTime < 2.5) return;
    placed.current = true;
    if (PRESET === 'pipeline' || PRESET === 'needs' || PRESET === 'shipped' || PRESET === 'domain') dispatch({ type: 'preset', preset: PRESET });
    if (SEL) devSelect(SEL);
    if (SETTINGS) useSettings.getState().set(true);
    if (LIBRARY) selectLibrary(true);
    const sendTo = LIBSEND != null ? useWorld.getState().snapshot?.stations[Number(LIBSEND)] : undefined;
    if (sendTo) openSend(sendTo.id, ['lib_0000a001']);
    if (!CAM || CAM.length !== 6) return;
    camera.position.set(CAM[0], CAM[1], CAM[2]);
    controls?.target?.set(CAM[3], CAM[4], CAM[5]);
    controls?.update?.();
    camera.lookAt(CAM[3], CAM[4], CAM[5]);
  });
  (window as unknown as { __scene?: unknown }).__scene = useThree((s) => s.scene);
  const w = window as unknown as { __probe?: (x: number, y: number) => Promise<number[]>; __probeReq?: { x: number; y: number; done: (v: number[]) => void } | null };
  w.__probe = (x, y) => new Promise((done) => (w.__probeReq = { x, y, done }));
  useFrame(() => {
    const r = w.__probeReq;
    if (!r) return;
    w.__probeReq = null;
    const ctx = gl.getContext();
    const px = new Uint8Array(4);
    const dpr = gl.getPixelRatio();
    ctx.readPixels(Math.round(r.x * dpr), Math.round(ctx.drawingBufferHeight - r.y * dpr), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    r.done([...px]);
  }, 10);
  return null;
}

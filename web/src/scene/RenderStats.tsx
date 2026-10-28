import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/** ?stats=1 (dev only): a corner readout of the renderer's draw calls and triangles per frame, to budget skins. */
export const STATS = new URLSearchParams(window.location.search).get('stats') === '1';

export interface FrameStats {
  /** Draw calls per frame, every pass included (shadow maps, AO, bloom, the scene). */
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

/**
 * The composer renders several passes a frame and three resets `renderer.info` on each, so the counters
 * are summed by hand: reset once at the top of every frame, read the totals of the frame before. Runs at
 * the default priority, before the composer's render.
 */
export function RenderStats() {
  const gl = useThree((s) => s.gl);
  const box = useRef<HTMLDivElement | null>(null);
  const last = useRef(0);
  useEffect(() => {
    gl.info.autoReset = false;
    const el = document.createElement('div');
    el.className = 'render-stats';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;font:12px/1.35 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.7);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    box.current = el;
    return () => {
      gl.info.autoReset = true;
      el.remove();
    };
  }, [gl]);
  useFrame(({ clock }) => {
    const { render, memory, programs } = gl.info;
    const s: FrameStats = { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, programs: programs?.length ?? 0 };
    (window as unknown as { __stats?: FrameStats }).__stats = s;
    gl.info.reset();
    if (box.current && clock.elapsedTime - last.current > 0.5) {
      last.current = clock.elapsedTime;
      box.current.textContent = `calls ${s.calls}\ntris  ${(s.triangles / 1000).toFixed(1)}k\ngeo   ${s.geometries}  tex ${s.textures}  prog ${s.programs}`;
    }
  });
  return null;
}

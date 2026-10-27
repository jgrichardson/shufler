import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion } from '../ui/motionPrefs';
import { useResolvedTheme, useSkinScene } from '../skins/store';

/*
 * Shared hover feedback for everything clickable in the scene: the thing lifts a little, and a soft pool
 * of light with a fine ring fades in under it. Quieter than the selection ring (no pulse, thinner), in the
 * same skin colour, so hover reads as "this will select".
 */

const DAMP = 14;
const ease = (k: number, on: boolean, dt: number) => (reducedMotion() ? (on ? 1 : 0) : THREE.MathUtils.damp(k, on ? 1 : 0, DAMP, dt));

/** Eases its children up by `lift` and `grow` larger while `on`. Scales about the group's origin, so put it where that is the base. */
export function HoverLift({ on, lift = 0.3, grow = 0.04, children }: { on: boolean; lift?: number; grow?: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const k = useRef(0);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g || (k.current === (on ? 1 : 0) && g.position.y === k.current * lift)) return;
    k.current = ease(k.current, on, dt);
    if (Math.abs(k.current - (on ? 1 : 0)) < 0.002) k.current = on ? 1 : 0;
    g.position.y = k.current * lift;
    g.scale.setScalar(1 + k.current * grow);
  });
  return <group ref={ref}>{children}</group>;
}

/** Radial falloff for the light pool, built once. */
const poolTexture = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

/** A soft light pool and a fine ring of `radius` that fade in on the ground while `on`. */
export function HoverHalo({ on, radius, y = 0.06 }: { on: boolean; radius: number; y?: number }) {
  const color = useSkinScene().ring ?? '#cfe8ff';
  const light = useResolvedTheme() === 'light';
  const group = useRef<THREE.Group>(null);
  const k = useRef(0);
  const { ring, pool, ringGeo } = useMemo(() => {
    // a glow on a dark scene; on a bright one the colour itself, so it reads against pale decks
    const c = new THREE.Color(color).multiplyScalar(light ? 1 : 1.5);
    return {
      ring: new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true, opacity: 0, depthWrite: false }),
      pool: new THREE.MeshBasicMaterial({
        color: c,
        map: poolTexture,
        toneMapped: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
      }),
      ringGeo: new THREE.RingGeometry(radius, radius + 0.1, 72),
    };
  }, [color, light, radius]);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g || (k.current === 0 && !on && !g.visible)) return;
    k.current = ease(k.current, on, dt);
    if (k.current < 0.004 && !on) k.current = 0;
    g.visible = k.current > 0;
    ring.opacity = 0.75 * k.current;
    pool.opacity = (light ? 0.3 : 0.45) * k.current;
    g.scale.setScalar(0.9 + 0.1 * k.current);
  });
  return (
    <group ref={group} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <mesh geometry={ringGeo} material={ring} renderOrder={2} />
      <mesh material={pool} renderOrder={1}>
        <circleGeometry args={[radius * 1.15, 48]} />
      </mesh>
    </group>
  );
}

/** Never drawn, still raycast: the material for hit proxies. */
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

/**
 * An invisible sphere (or box, given `size`) that widens a small object's hover and click target. Pods and
 * sessions are a few pixels tall at overview zoom; this roughly doubles what the pointer has to find.
 */
export function HitProxy({ radius = 1, size, y = 0 }: { radius?: number; size?: [number, number, number]; y?: number }) {
  return (
    <mesh position={[0, y, 0]} material={hitMat}>
      {size ? <boxGeometry args={size} /> : <sphereGeometry args={[radius, 12, 8]} />}
    </mesh>
  );
}

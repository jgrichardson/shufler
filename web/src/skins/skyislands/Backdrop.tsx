import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import { rng, useResolvedTheme } from '../api';
import { ASSET_BASE, islandVariant, useKit } from './kit';

/** Low sun behind the board and to the left, as in the concept painting. */
export const SUN_DIR = new THREE.Vector3(-0.78, 0.5, 0.22).normalize();
const SUN_DIR_LIGHT = new THREE.Vector3(-0.55, 0.62, -0.35).normalize();
/** Rough centre of a 12-row board; the shadow camera and the scenery ring centre on it. */
const BOARD_CENTRE = new THREE.Vector3(38, 0, -40);

/**
 * Sky and cloud sea in one dome: a dusk gradient with painted cloud streaks above the horizon, and below
 * it a soft sea of clouds far under the islands, lit warm toward the sun and violet away from it, fading
 * into the horizon haze. Rays start at the camera, so the sea has real parallax as the view moves.
 */
function SkyDome({ light }: { light: boolean }) {
  const { p } = useKit();
  const sun = light ? SUN_DIR_LIGHT : SUN_DIR;
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color(p.skyZenith) },
          upper: { value: new THREE.Color(p.skyUpper) },
          horizon: { value: new THREE.Color(p.skyHorizon) },
          glow: { value: new THREE.Color(p.skyGlow) },
          sunCol: { value: new THREE.Color(p.sun) },
          cloudLit: { value: new THREE.Color(p.cloudLit) },
          cloudShade: { value: new THREE.Color(p.cloudShade) },
          cloudDeep: { value: new THREE.Color(p.cloudDeep) },
          sunDir: { value: sun },
          seaY: { value: -140 },
          streakK: { value: light ? 0.35 : 0.75 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith, upper, horizon, glow, sunCol, cloudLit, cloudShade, cloudDeep, sunDir;
          uniform float seaY, streakK;
          varying vec3 vWorld;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
          }
          float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; }
            return v;
          }
          void main() {
            vec3 d = normalize(vWorld - cameraPosition);
            float h = d.y;
            float s = max(dot(d, sunDir), 0.0);
            vec3 flat2 = normalize(vec3(d.x, 0.0, d.z));
            float sh = max(dot(flat2, normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
            // sky: horizon glow toward the sun, violet overhead
            vec3 sky = mix(horizon, upper, smoothstep(0.0, 0.32, h));
            sky = mix(sky, zenith, smoothstep(0.28, 0.95, h));
            sky = mix(sky, glow, pow(sh, 3.0) * exp(-max(h, 0.0) * 9.0) * 0.85);
            // painted cloud streaks, stretched along the horizon
            vec2 sp = d.xz / (h + 0.12) * vec2(0.9, 2.6);
            float st = smoothstep(0.5, 0.8, fbm(sp * 1.3 + 3.0));
            vec3 streak = mix(cloudShade, cloudLit, pow(sh, 2.0) * 0.8 + 0.1);
            sky = mix(sky, streak, st * streakK * smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.45, 0.8, h)));
            sky += sunCol * (pow(s, 400.0) * 3.0 + pow(s, 30.0) * 0.25 + pow(s, 6.0) * 0.12);

            vec3 col = sky;
            if (h < 0.02) {
              // cloud sea: soft billows on a plane far below
              float t = (seaY - cameraPosition.y) / min(d.y, -0.0005);
              vec2 q = (cameraPosition.xz + d.xz * t) / 55.0;
              vec2 toSun = normalize(sunDir.xz) * 0.08;
              float n = fbm(q) * 0.6 + fbm(q * 2.7 + 4.0) * 0.4;
              float nS = fbm(q + toSun) * 0.6 + fbm((q + toSun) * 2.7 + 4.0) * 0.4;
              float puff = smoothstep(0.3, 0.72, n);
              // billows facing the sun catch it; the far sides fall into violet shade
              float litSide = clamp(0.5 + (nS - n) * 9.0, 0.0, 1.0);
              vec3 sea = mix(cloudDeep, cloudShade, puff);
              sea = mix(sea, cloudLit, puff * litSide * (0.35 + 0.65 * pow(sh, 1.2)));
              sea += glow * pow(sh, 6.0) * 0.18;
              // dissolve into the horizon haze with distance
              float far = 1.0 - exp(-t / 2600.0);
              sea = mix(sea, mix(horizon, glow, pow(sh, 3.0) * 0.6), clamp(far * 1.2, 0.0, 1.0));
              col = mix(sky, sea, smoothstep(0.02, -0.01, h));
            }
            col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [p, sun, light],
  );
  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[2600, 48, 32]} />
    </mesh>
  );
}

/** Far islands around the board: silhouettes in the haze that give the sky its depth. */
function DistantIslands() {
  const kit = useKit();
  const items = useMemo(() => {
    const r = rng(0x51a7);
    return Array.from({ length: 14 }, (_, i) => {
      // mostly behind and to the sides of the board, never between the default camera and the rows
      const a = -Math.PI * 0.05 - (i / 14) * Math.PI * 1.1 + (r() - 0.5) * 0.2;
      const dist = 260 + r() * 520;
      const size = 10 + r() * 26;
      return {
        g: islandVariant(i * 3 + 1, 1.6),
        pos: [BOARD_CENTRE.x + Math.cos(a) * dist, -30 + r() * 70, BOARD_CENTRE.z + Math.sin(a) * dist] as [number, number, number],
        size,
        rot: r() * Math.PI * 2,
      };
    });
  }, []);
  return (
    <group>
      {items.map((it, i) => (
        <group key={i} position={it.pos} rotation={[0, it.rot, 0]} scale={[it.size, it.size * 0.9, it.size]}>
          <mesh geometry={it.g.top} material={kit.grass} />
          <mesh geometry={it.g.under} material={[kit.lip, kit.rock]} />
        </group>
      ))}
    </group>
  );
}

function Lights({ light }: { light: boolean }) {
  const { p } = useKit();
  const scene = useThree((s) => s.scene);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const dir = light ? SUN_DIR_LIGHT : SUN_DIR;
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.copy(BOARD_CENTRE);
    return o;
  }, []);
  useLayoutEffect(() => {
    scene.add(target);
    if (sunRef.current) sunRef.current.target = target;
    return () => {
      scene.remove(target);
    };
  }, [scene, target]);
  const pos = dir.clone().multiplyScalar(260).add(BOARD_CENTRE);
  return (
    <>
      <hemisphereLight args={[p.hemiSky, p.hemiGround, light ? 1.2 : 1.5]} />
      {/* the glow low in the west behind the board: a warm rim on the far side of everything */}
      <directionalLight position={[-60, 40, -200]} intensity={light ? 0.6 : 1.4} color={p.skyGlow} />
      <directionalLight
        ref={sunRef}
        position={pos.toArray()}
        intensity={light ? 3.2 : 4.2}
        color={p.sunLight}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-125}
        shadow-camera-right={125}
        shadow-camera-top={95}
        shadow-camera-bottom={-95}
        shadow-camera-near={40}
        shadow-camera-far={520}
        shadow-bias={-0.0003}
        shadow-normalBias={0.05}
        shadow-radius={4}
      />
    </>
  );
}

/** Sky Islands backdrop: dusk sky over a cloud sea, far islands in the haze, a low warm sun and HDRI light. */
export function Backdrop() {
  const light = useResolvedTheme() === 'light';
  return (
    <>
      <SkyDome light={light} />
      <DistantIslands />
      <Lights light={light} />
      <Suspense fallback={null}>
        <Environment
          files={ASSET_BASE + (light ? 'kloppenheim_06_puresky.hdr' : 'qwantani_sunset_puresky.hdr')}
          environmentIntensity={light ? 0.8 : 0.9}
          environmentRotation={[0, light ? 0.6 : 2.2, 0]}
        />
      </Suspense>
    </>
  );
}

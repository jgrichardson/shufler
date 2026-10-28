import { useMemo } from 'react';
import * as THREE from 'three';
import { useResolvedTheme } from '../api';
import { useKit } from './kit';
import { ConceptBackdrop, HorizonDisc, Ridge } from '../ConceptBackdrop';
import { CONCEPT } from '../concepts';

export const SUN_DIR = new THREE.Vector3(-0.78, 0.36, 0.42).normalize();

/**
 * A low-contrast gradient dome: muted zenith, a soft haze band at the horizon (where the fog colour
 * matches it), a quiet tone below the board so the board reads against it, and a faint sun halo.
 */
function SkyDome() {
  const { p } = useKit();
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
          below: { value: new THREE.Color(p.skyBelow) },
          sun: { value: new THREE.Color(p.sun) },
          sunDir: { value: SUN_DIR },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * p;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith, upper, horizon, below, sun, sunDir;
          varying vec3 vDir;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          void main() {
            vec3 d3 = normalize(vDir);
            float h = d3.y;
            vec3 col = mix(horizon, upper, smoothstep(0.0, 0.4, h));
            col = mix(col, zenith, smoothstep(0.35, 1.0, h));
            col = mix(col, below, 1.0 - smoothstep(-0.45, -0.02, h));
            // a soft haze band where sky meets fog
            col = mix(col, horizon, exp(-pow(h / 0.07, 2.0)) * 0.6);
            float d = max(dot(d3, sunDir), 0.0);
            col += sun * (pow(d, 60.0) * 0.12 + pow(d, 8.0) * 0.06);
            // dither, so the long gradients never band
            col += (hash(d3 * 913.0) - 0.5) / 255.0;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [p],
  );
  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[1200, 48, 24]} />
    </mesh>
  );
}

function Lights() {
  const { p } = useKit();
  const light = useResolvedTheme() === 'light';
  const sunPos = SUN_DIR.clone().multiplyScalar(160);
  return (
    <>
      <hemisphereLight args={[p.hemiSky, p.hemiGround, light ? 1.05 : 0.9]} />
      <ambientLight intensity={light ? 0.2 : 0.15} color={p.ambient} />
      <directionalLight
        position={sunPos.toArray()}
        intensity={light ? 2.7 : 2.6}
        color={p.sunLight}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-camera-near={10}
        shadow-camera-far={400}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      {/* cool fill from the opposite side so shadowed faces read lavender, not black */}
      <directionalLight position={[120, 60, -80]} intensity={0.55} color={p.fillLight} />
    </>
  );
}

/**
 * Three low ridgelines far below and around the board, dissolving into the haze at their foot. They sit
 * under the horizon line and outside the Overview's frame, so only the horizon camera ever sees them.
 */
function HorizonRidges() {
  const { p } = useKit();
  return (
    <>
      <Ridge radius={1150} base={-260} height={170} color={p.ridgeFar} fog={p.skyBelow} seed={2.1} />
      <Ridge radius={900} base={-260} height={130} color={p.ridgeMid} fog={p.skyBelow} seed={4.7} />
      <Ridge radius={680} base={-260} height={95} color={p.ridgeNear} fog={p.skyBelow} seed={0.9} />
    </>
  );
}

/** Quiet Horizon: a calm gradient sky, its lights and a soft pool under the board. No clouds: the board is the only busy thing on screen. */
export function Backdrop() {
  const { p } = useKit();
  return (
    <>
      <SkyDome />
      <Lights />
      {CONCEPT ? (
        <ConceptBackdrop />
      ) : (
        <>
          <HorizonDisc color={p.hemiGround} />
          <HorizonRidges />
        </>
      )}
    </>
  );
}

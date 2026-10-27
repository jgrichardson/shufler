import { useMemo } from 'react';
import * as THREE from 'three';
import { Environment, Lightformer } from '@react-three/drei';
import { useResolvedTheme } from '../api';
import { useKit } from './kit';
import { ConceptBackdrop } from '../ConceptBackdrop';
import { CONCEPT } from '../concepts';

export const SUN_DIR = new THREE.Vector3(-0.62, 0.55, 0.56).normalize();

/** Deep-space dome: graded black-blue, a faint nebula band, and a hashed star field. In light mode, a pale day-side haze with no stars. */
function SkyDome() {
  const { p } = useKit();
  const light = useResolvedTheme() === 'light';
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color(p.spaceZenith) },
          upper: { value: new THREE.Color(p.spaceUpper) },
          horizon: { value: new THREE.Color(p.spaceHorizon) },
          below: { value: new THREE.Color(p.spaceBelow) },
          nebula: { value: new THREE.Color(p.nebula) },
          nebulaK: { value: light ? 0.22 : 0.55 },
          starK: { value: light || CONCEPT?.starship ? 0 : 1.0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith, upper, horizon, below, nebula;
          uniform float nebulaK, starK;
          varying vec3 vDir;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float stars(vec3 d, float scale, float density) {
            vec3 p = d * scale;
            vec3 c = floor(p);
            float h = hash(c);
            vec3 o = vec3(hash(c + 3.1), hash(c + 7.7), hash(c + 1.3)) - 0.5;
            float r = length(fract(p) - 0.5 - o * 0.6);
            return step(density, h) * smoothstep(0.09, 0.0, r) * (0.35 + 0.65 * hash(c + 9.2));
          }
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(horizon, upper, smoothstep(-0.05, 0.35, h));
            col = mix(col, zenith, smoothstep(0.3, 0.95, h));
            col = mix(col, below, 1.0 - smoothstep(-0.4, -0.05, h));
            float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.9, -0.25))) * 3.2, 2.0));
            col += nebula * band * nebulaK;
            float s = stars(d, 220.0, 0.975) + stars(d, 520.0, 0.985) * 0.6;
            col += vec3(0.85, 0.9, 1.0) * s * starK;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [p, light],
  );
  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[1200, 48, 24]} />
    </mesh>
  );
}

/** Below and left of the default view, so its limb arcs through the lower corner and the rest stays deep space. */
const PLANET_POS: [number, number, number] = [-1010, -2860, -380];
const PLANET_R = 1400;

/** The planet: oceans, continents and cloud bands from noise, city lights on the night side, a thin blue limb. */
function Planet() {
  const { p } = useKit();
  // light mode shows the day side only: no terminator, no city lights
  const light = useResolvedTheme() === 'light';
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        fog: false,
        depthWrite: false,
        uniforms: {
          sunDir: { value: SUN_DIR },
          ocean: { value: new THREE.Color(p.planetOcean) },
          ground: { value: new THREE.Color(p.planetLand) },
          atmosphere: { value: new THREE.Color(p.planetAtmosphere) },
          city: { value: new THREE.Color(p.cityLights) },
          dayMin: { value: light ? 0.85 : 0 },
          cloudCol: { value: light ? new THREE.Color('#ffffff') : new THREE.Color(0.55, 0.6, 0.68) },
          cloudK: { value: light ? 0.85 : 0.7 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vView;
          varying vec3 vObj;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vObj = normalize(position);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 sunDir, ocean, ground, atmosphere, city;
          uniform float dayMin, cloudK;
          uniform vec3 cloudCol;
          varying vec3 vN;
          varying vec3 vView;
          varying vec3 vObj;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float noise(vec3 p) {
            vec3 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                       mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
          }
          float fbm(vec3 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
            return v;
          }
          void main() {
            float lit = dot(vObj, sunDir);
            float day = max(dayMin, smoothstep(-0.08, 0.35, lit));
            float land = smoothstep(0.5, 0.6, fbm(vObj * 2.4));
            float cloud = smoothstep(0.52, 0.75, fbm(vObj * 6.0 + vec3(4.0, 0.0, 2.0)));
            // terrain variety: the land colour drifts toward a sunlit sand on high ground
            vec3 terrain = mix(ground, ground * vec3(1.3, 1.18, 0.86), smoothstep(0.35, 0.7, fbm(vObj * 9.0 + 1.7)));
            vec3 surf = mix(ocean, terrain, land);
            surf = mix(surf, cloudCol, cloud * cloudK);
            vec3 col = surf * day * 1.2;
            // sparse and faint, so the night side reads as a calm surface, not glitter
            float cityK = land * (1.0 - cloud) * step(0.985, hash(floor(vObj * 600.0))) * (1.0 - day);
            col += city * cityK * 0.2;
            float rim = pow(1.0 - max(dot(vN, vView), 0.0), 3.5);
            col += atmosphere * rim * (0.15 + 0.85 * smoothstep(-0.35, 0.3, lit));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [p, light],
  );
  return (
    <mesh material={material} position={PLANET_POS} renderOrder={-9} frustumCulled={false}>
      <sphereGeometry args={[PLANET_R, 128, 96]} />
    </mesh>
  );
}

function Lights() {
  const { p } = useKit();
  const light = useResolvedTheme() === 'light';
  const sunPos = SUN_DIR.clone().multiplyScalar(160);
  return (
    <>
      {light ? <hemisphereLight args={['#f2f7ff', '#9eabbd', 1.15]} /> : <hemisphereLight args={['#a9bddc', '#07090e', 0.45]} />}
      <directionalLight
        position={sunPos.toArray()}
        intensity={light ? 2.6 : 2.4}
        color={p.sun}
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
      {/* planet-shine from below and behind: a cold blue rim on every edge facing away from the sun */}
      <directionalLight position={[90, -40, -140]} intensity={light ? 0.6 : 0.9} color={p.planetShine} />
    </>
  );
}

/** Studio light rig baked into an env map once, so the lacquered hulls and glass have something sleek to reflect. */
function StudioEnvironment() {
  const light = useResolvedTheme() === 'light';
  return (
    <Environment resolution={256} frames={1} environmentIntensity={light ? 0.85 : 0.55}>
      {/* day side: metals reflect a bright sky, not black space, so graphite reads as anodised slate */}
      {light && <color attach="background" args={['#cfdced']} />}
      <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 6, 1]} />
      <Lightformer form="rect" intensity={1.4} color="#dce8ff" position={[-8, 2, 3]} rotation-y={Math.PI / 2} scale={[10, 1.2, 1]} />
      <Lightformer form="rect" intensity={1.1} color="#dce8ff" position={[8, 2, -3]} rotation-y={-Math.PI / 2} scale={[10, 1.2, 1]} />
      <Lightformer form="rect" intensity={light ? 0.9 : 0.6} color={light ? '#a9c4e6' : '#3f7cff'} position={[0, -5, 0]} rotation-x={-Math.PI / 2} scale={[14, 14, 1]} />
    </Environment>
  );
}

/** Starship backdrop: deep space, the planet, a cool key light with planet-shine, and studio reflections. */
export function Backdrop() {
  return (
    <>
      <SkyDome />
      {/* the dev concepts that bring their own ground drop the planet */}
      {!(CONCEPT?.starship && (CONCEPT.id === 'glow' || CONCEPT.id === 'studio')) && <Planet />}
      <Lights />
      <StudioEnvironment />
      {CONCEPT?.starship && <ConceptBackdrop />}
    </>
  );
}

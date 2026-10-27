import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, SMAA, N8AO } from '@react-three/postprocessing';
import * as THREE from 'three';
import { World } from './World';
import { CameraRig } from './CameraRig';
import { DevProbe } from './DevProbe';
import { useLayout } from './useLayout';
import { dispatch } from '../store';
import { useResolvedTheme, useSkin, useSkinScene } from '../skins/store';
import type { SkinScene } from '../skins/types';

const NO_FX = new URLSearchParams(window.location.search).get('fx') === '0';

const TONE: Record<NonNullable<SkinScene['toneMapping']>, THREE.ToneMapping> = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

function Rig() {
  const layout = useLayout();
  return <CameraRig layout={layout} />;
}

/** Applies the skin's renderer settings; materials recompile when the tone mapping changes. */
function SkinRenderer({ scene }: { scene: SkinScene }) {
  const gl = useThree((s) => s.gl);
  const root = useThree((s) => s.scene);
  useEffect(() => {
    const tone = TONE[scene.toneMapping ?? 'aces'];
    const changed = gl.toneMapping !== tone;
    gl.toneMapping = tone;
    gl.toneMappingExposure = scene.exposure ?? 1;
    if (!changed) return;
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
    });
  }, [gl, root, scene.toneMapping, scene.exposure]);
  return null;
}

function Effects({ fx }: { fx: SkinScene['fx'] }) {
  const ao = fx?.ao;
  const bloom = fx?.bloom;
  const vignette = fx?.vignette;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {ao ? <N8AO halfRes aoRadius={ao.radius} distanceFalloff={1} intensity={ao.intensity} color="#000000" /> : <></>}
      {bloom ? <Bloom mipmapBlur luminanceThreshold={bloom.threshold} luminanceSmoothing={0.15} intensity={bloom.intensity} radius={bloom.radius} /> : <></>}
      {vignette ? <Vignette offset={vignette.offset} darkness={vignette.darkness} /> : <></>}
      <SMAA />
    </EffectComposer>
  );
}

export function Scene() {
  const skin = useSkin();
  const theme = useResolvedTheme();
  const scene = useSkinScene();
  const { Backdrop } = skin.components;
  return (
    <Canvas
      className="scene-canvas"
      shadows="soft"
      dpr={[1, 2]}
      camera={{ position: [50, 300, 210], fov: 25, near: 1, far: 6000 }}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      onPointerMissed={() => dispatch({ type: 'select', selection: null })}
    >
      <SkinRenderer scene={scene} />
      <color attach="background" args={[scene.background]} />
      {scene.fog && <fog attach="fog" args={[scene.fog.color, scene.fog.near, scene.fog.far]} />}
      {/* keyed so a skin or theme switch rebuilds the backdrop cleanly (lights, env map) */}
      <Backdrop key={`backdrop-${skin.id}-${theme}`} />
      <World />
      <Rig />
      {!NO_FX && <Effects key={`fx-${skin.id}-${theme}`} fx={scene.fx} />}
      {import.meta.env.DEV && !NO_FX && <DevProbe />}
    </Canvas>
  );
}

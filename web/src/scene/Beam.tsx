import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSkinScene } from '../skins/store';

/**
 * Where beams step aside: an upright capsule (base, height, radius in world units) that beams fade out in
 * front of, so a need-me column never draws across the library spire. The library sets it; radius 0 is off.
 */
export const beamAvoid = { pos: { value: new THREE.Vector3() }, height: { value: 0 }, radius: { value: 0 } };

const beamVertex = /* glsl */ `
  uniform vec3 avoidPos;
  uniform float avoidH, avoidR;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec4 vClip;
  varying vec2 vA;
  varying vec2 vB;
  varying float vR;
  varying float vAspect;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    vClip = gl_Position;
    // the avoid capsule in aspect-corrected screen space: its axis A..B and its radius
    vAspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    vec2 sx = vec2(vAspect, 1.0);
    vec4 a = projectionMatrix * viewMatrix * vec4(avoidPos, 1.0);
    vec4 b = projectionMatrix * viewMatrix * vec4(avoidPos + vec3(0.0, avoidH, 0.0), 1.0);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec4 c = projectionMatrix * viewMatrix * vec4(avoidPos + right * avoidR, 1.0);
    vA = a.xy / a.w * sx;
    vB = b.xy / b.w * sx;
    vR = avoidR > 0.0 ? length(c.xy / c.w * sx - vA) : -1.0;
  }`;

const beamFragment = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  uniform float additive;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec4 vClip;
  varying vec2 vA;
  varying vec2 vB;
  varying float vR;
  varying float vAspect;
  void main() {
    float facing = abs(dot(vNormalV, vViewDir));
    float core = pow(facing, 2.0);
    float fade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.04, vUv.y);
    if (vR > 0.0) {
      vec2 p = vClip.xy / vClip.w * vec2(vAspect, 1.0);
      vec2 ab = vB - vA;
      float t = clamp(dot(p - vA, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      fade *= smoothstep(vR * 0.8, vR * 1.5, length(p - (vA + ab * t)));
    }
    // additive glow on a dark sky; on a bright sky a translucent coloured column reads better
    vec3 lit = additive > 0.5 ? color * (0.6 + core * 1.6) : color * (0.85 + core * 0.3);
    float a = additive > 0.5 ? core * fade * opacity : (0.3 + core * 0.7) * fade * opacity;
    gl_FragColor = vec4(lit, a);
  }`;

export function makeBeamMaterial(color: string, opacity: number, additive = true) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      color: { value: new THREE.Color(color) },
      opacity: { value: opacity },
      additive: { value: additive ? 1 : 0 },
      avoidPos: beamAvoid.pos,
      avoidH: beamAvoid.height,
      avoidR: beamAvoid.radius,
    },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
  });
}

interface BeamProps {
  color: string;
  height?: number;
  radius?: number;
  pulse?: boolean;
  flicker?: boolean;
  intensity?: number;
}

/** Light beam rising from the origin into the sky; base sits at y=0. Blending and strength follow the skin's scene. */
export function Beam({ color, height = 70, radius = 0.55, pulse = false, flicker = false, intensity: own = 1 }: BeamProps) {
  const beams = useSkinScene().beams;
  const additive = beams?.additive ?? true;
  const intensity = own * (beams?.intensity ?? 1);
  const inner = useMemo(() => makeBeamMaterial(color, 0.9 * intensity, additive), [color, intensity, additive]);
  const outer = useMemo(() => makeBeamMaterial(color, 0.28 * intensity, additive), [color, intensity, additive]);
  const t0 = useRef(Math.random() * 10);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + t0.current;
    let k = 1;
    if (pulse) k = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3.2));
    if (flicker) k = Math.random() > 0.9 ? 0.15 : 0.7;
    inner.uniforms.opacity.value = 0.9 * intensity * k;
    outer.uniforms.opacity.value = 0.28 * intensity * k;
  });
  return (
    <group>
      <mesh position={[0, height / 2, 0]} material={inner} renderOrder={5}>
        <cylinderGeometry args={[radius * 0.7, radius, height, 16, 1, true]} />
      </mesh>
      <mesh position={[0, height / 2, 0]} material={outer} renderOrder={5}>
        <cylinderGeometry args={[radius * 2.2, radius * 2.6, height, 16, 1, true]} />
      </mesh>
    </group>
  );
}

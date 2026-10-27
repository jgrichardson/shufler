import { useMemo } from 'react';
import * as THREE from 'three';
import { useResolvedTheme } from './store';
import { BOARD_C, CONCEPT, type ConceptTheme } from './concepts';

/* Dev-only geometry for the ?concept= backdrops. Static, low-frequency, no textures with detail. */

/** Radial falloff, dark centre to clear edge. */
const disc = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
})();

const [CX, , CZ] = BOARD_C;

/** A soft dark pool under the board, so a floating board has something to float over. */
function ShadowDisc({ y, radius, color, opacity, dx = 0, dz = 0 }: { y: number; radius: number; color: string; opacity: number; dx?: number; dz?: number }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, map: disc, transparent: true, opacity, depthWrite: false, fog: false }), [color, opacity]);
  return (
    <mesh position={[CX + dx, y, CZ + dz]} rotation={[-Math.PI / 2, 0, 0]} material={mat} renderOrder={-5}>
      <circleGeometry args={[radius, 64]} />
    </mesh>
  );
}

/** A huge flat surface with a radial blend from `centre` to `edge`, plus up to three soft blobs of light. */
function Field({
  y,
  centre,
  edge,
  inner,
  outer,
  blobs = [],
}: {
  y: number;
  centre: string;
  edge: string;
  inner: number;
  outer: number;
  blobs?: { x: number; z: number; r: number; color: string; k: number }[];
}) {
  const mat = useMemo(() => {
    const b = [...blobs, ...Array(3).fill({ x: 0, z: 0, r: 1, color: '#000000', k: 0 })].slice(0, 3);
    return new THREE.ShaderMaterial({
      depthWrite: false,
      fog: false,
      uniforms: {
        centre: { value: new THREE.Color(centre) },
        edge: { value: new THREE.Color(edge) },
        c: { value: new THREE.Vector2(CX, CZ) },
        radii: { value: new THREE.Vector2(inner, outer) },
        bp: { value: b.map((x) => new THREE.Vector3(CX + x.x, CZ + x.z, x.r)) },
        bc: { value: b.map((x) => new THREE.Color(x.color).multiplyScalar(x.k)) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vXZ = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 centre, edge;
        uniform vec2 c, radii;
        uniform vec3 bp[3];
        uniform vec3 bc[3];
        varying vec2 vXZ;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          float d = length(vXZ - c);
          vec3 col = mix(centre, edge, smoothstep(radii.x, radii.y, d));
          for (int i = 0; i < 3; i++) col += bc[i] * exp(-pow(length(vXZ - bp[i].xy) / bp[i].z, 2.0));
          col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }, [centre, edge, inner, outer, blobs]);
  return (
    <mesh position={[CX, y, CZ]} rotation={[-Math.PI / 2, 0, 0]} material={mat} renderOrder={-6}>
      <planeGeometry args={[6000, 6000]} />
    </mesh>
  );
}

/** One ring of low ridgeline around the board: a smooth sine-sum profile, fading to fog at its foot. */
function Ridge({ radius, base, height, color, fog, seed }: { radius: number; base: number; height: number; color: string; fog: string; seed: number }) {
  const geo = useMemo(() => {
    const n = 256;
    const pos: number[] = [];
    const t: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = height * (0.55 + 0.25 * Math.sin(a * 2 + seed) + 0.15 * Math.sin(a * 5 + seed * 2.3) + 0.05 * Math.sin(a * 11 + seed * 0.7));
      const x = CX + Math.cos(a) * radius;
      const z = CZ + Math.sin(a) * radius;
      pos.push(x, base, z, x, base + h, z);
      t.push(0, 1);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('t', new THREE.Float32BufferAttribute(t, 1));
    g.setIndex(idx);
    return g;
  }, [radius, base, height, seed]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        fog: false,
        uniforms: { top: { value: new THREE.Color(color) }, foot: { value: new THREE.Color(fog) } },
        vertexShader: /* glsl */ `
          attribute float t;
          varying float vT;
          void main() { vT = t; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top, foot;
          varying float vT;
          void main() {
            gl_FragColor = vec4(mix(foot, top, smoothstep(0.0, 0.85, vT)), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [color, fog],
  );
  return <mesh geometry={geo} material={mat} renderOrder={-7} />;
}

function Extras({ t, kind }: { t: ConceptTheme; kind: string }) {
  switch (kind) {
    case 'horizon':
      return <HorizonDisc color={t.hemiGround} />;
    case 'paper':
      return (
        <>
          <Field y={-30} centre={t.ground} edge={t.extra.tableEdge} inner={120} outer={900} />
          <ShadowDisc y={-29.5} radius={120} color="#000000" opacity={0.22} dx={30} dz={-18} />
        </>
      );
    case 'ridges':
      return (
        <>
          <Field y={-260} centre={t.ground} edge={t.fog} inner={300} outer={1100} />
          <Ridge radius={1150} base={-260} height={170} color={t.extra.ridgeFar} fog={t.fog} seed={2.1} />
          <Ridge radius={900} base={-260} height={130} color={t.extra.ridgeMid} fog={t.fog} seed={4.7} />
          <Ridge radius={680} base={-260} height={95} color={t.extra.ridgeNear} fog={t.fog} seed={0.9} />
        </>
      );
    case 'glow':
      return (
        <Field
          y={-300}
          centre={t.ground}
          edge={t.fog}
          inner={250}
          outer={1300}
          blobs={[
            { x: -160, z: 120, r: 260, color: t.extra.glowA, k: 0.55 },
            { x: 220, z: -80, r: 300, color: t.extra.glowB, k: 0.45 },
            { x: 40, z: 380, r: 220, color: t.extra.glowA, k: 0.35 },
          ]}
        />
      );
    case 'studio':
      return (
        <>
          <Field y={-40} centre={t.ground} edge={t.extra.wall} inner={150} outer={700} />
          <ShadowDisc y={-39.5} radius={110} color="#000000" opacity={0.18} />
        </>
      );
    default:
      return null;
  }
}

/** Quiet Horizon's soft pool under the board: Factory's default backdrop uses it outside the concepts too. */
export function HorizonDisc({ color }: { color: string }) {
  return <ShadowDisc y={-60} radius={150} color={color} opacity={0.45} />;
}

/** The active ?concept= backdrop's extra geometry; nothing without one. */
export function ConceptBackdrop() {
  const theme = useResolvedTheme();
  if (!CONCEPT) return null;
  return <Extras t={CONCEPT[theme]} kind={CONCEPT.id} />;
}

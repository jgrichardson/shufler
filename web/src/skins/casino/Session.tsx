import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { domainDef, reducedMotion, rng, type SessionProps } from '../api';
import { canvas, canvasTexture, roundRect, spaced, useKit } from './kit';

/*
 * A session is a slot machine on its row's dais: a lacquered cabinet with a topper in the row's colour,
 * three reels behind glass, a button deck and a brass lever. The reels spin while the session works and
 * stop on the house S when its note is done; an on-hold machine wears a RESERVED card over its glass. The
 * status lamp sits on top as the machine's candle, which is what casinos call that light anyway.
 */

const SYMBOLS = ['7', '♠', '♥', 'S', '♦', '♣', '★', 'BAR'] as const;
const N = SYMBOLS.length;
const S_INDEX = SYMBOLS.indexOf('S');
/** How many symbols show in the window at once. */
const VISIBLE = 1.7;

const reelStrip = (() => {
  const made = canvas(128, 128 * N);
  if (!made) return null;
  const [c, g] = made;
  g.fillStyle = '#fbf6ea';
  g.fillRect(0, 0, 128, 128 * N);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  SYMBOLS.forEach((s, i) => {
    // canvas y runs down, texture v runs up: symbol i is centred at v = (i + 0.5) / N from the bottom
    const y = 128 * N - (i + 0.5) * 128;
    const colour = s === '7' || s === '♥' || s === '♦' ? '#c3262f' : s === 'S' || s === '★' ? '#b8892e' : '#17161b';
    g.fillStyle = colour;
    if (s === 'BAR') {
      roundRect(g, 18, y - 22, 92, 44, 8);
      g.fill();
      g.fillStyle = '#fbf6ea';
      g.font = '700 30px Georgia, serif';
      g.fillText('BAR', 64, y + 2);
    } else {
      g.font = s === 'S' ? 'italic 700 96px Georgia, serif' : s === '7' ? '700 100px Georgia, serif' : '90px Georgia, serif';
      g.fillText(s, 64, y + 6);
    }
  });
  const t = canvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  return t;
})();

/** Shading over the reels so they read as drums. */
const reelShade = (() => {
  const made = canvas(4, 128);
  if (!made) return null;
  const [c, g] = made;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.3, 'rgba(0,0,0,0)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  return canvasTexture(c);
})();
const shadeMat = new THREE.MeshBasicMaterial({ map: reelShade, transparent: true, depthWrite: false });

const reserved = (() => {
  const made = canvas(256, 128);
  if (!made) return null;
  const [c, g] = made;
  g.fillStyle = '#1a120e';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#d6b86e';
  g.lineWidth = 4;
  roundRect(g, 8, 8, 240, 112, 10);
  g.stroke();
  g.fillStyle = '#e9cf8a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 34px Georgia, serif';
  spaced(g, 'RESERVED', 128, 66, 4);
  return canvasTexture(c);
})();
const reservedMat = new THREE.MeshStandardMaterial({ map: reserved, roughness: 0.5 });

/** The v offset that centres symbol i in the window. */
const offsetFor = (i: number) => (i + 0.5) / N - VISIBLE / N / 2;

function Reels({ w, h, active, stalled, done, closed, seed, light }: { w: number; h: number; active: boolean; stalled: boolean; done: boolean; closed: boolean; seed: number; light: boolean }) {
  const mats = useMemo(() => {
    const r = rng(seed);
    return [0, 1, 2].map(() => {
      const t = reelStrip?.clone() ?? null;
      if (t) {
        t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1, VISIBLE / N);
        t.offset.y = offsetFor(Math.floor(r() * N));
        t.needsUpdate = true;
      }
      return new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, roughness: 0.6 });
    });
  }, [seed]);
  const speeds = useMemo(() => [2.1, 2.6, 3.1], []);
  const spin = active && !closed && !done;
  useFrame((_, dt) => {
    mats.forEach((m, i) => {
      const t = m.map;
      if (!t) return;
      if (spin && !reducedMotion() && !(stalled && Math.sin(performance.now() / 300 + i) < 0)) t.offset.y = (t.offset.y + dt * speeds[i]) % 1;
      else if (done) t.offset.y = offsetFor(S_INDEX);
      else {
        // ease to the nearest symbol so a stopped reel always shows a whole symbol
        const want = Math.round(t.offset.y * N - 0.5 + VISIBLE / 2) / N + 0.5 / N - VISIBLE / N / 2;
        t.offset.y += (want - t.offset.y) * Math.min(1, dt * 8);
      }
    });
  });
  const glow = closed ? 0 : light ? 0.15 : active ? 0.55 : 0.3;
  mats.forEach((m) => {
    m.emissiveIntensity = glow;
    m.color.set(closed ? '#4a4440' : '#ffffff');
  });
  const rw = (w - 0.12) / 3;
  return (
    <group>
      {mats.map((m, i) => (
        <mesh key={i} position={[(i - 1) * rw, 0, 0]} material={m}>
          <planeGeometry args={[rw - 0.04, h]} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.005]} material={shadeMat}>
        <planeGeometry args={[w - 0.08, h]} />
      </mesh>
    </group>
  );
}

export function Session({ station, shape, height: bodyH, lampColor, active, stalled, closed, selected, hovered, seed }: SessionProps) {
  const kit = useKit();
  const row = domainDef(station.domain).color;
  const w = shape.width * 0.74;
  const d = shape.depth * 0.62;
  const baseH = 0.85;
  const topperH = Math.min(0.55, bodyH * 0.2);
  const cabH = Math.max(0.5, bodyH - baseH - topperH);
  const screenH = Math.min(cabH - 0.18, 0.9);
  const done = station.note?.state === 'done';
  const geo = useMemo(() => {
    const deck = new THREE.BoxGeometry(w * 1.02, 0.12, 0.42).rotateX(-0.35).translate(0, baseH + 0.02, d / 2 + 0.12);
    return {
      base: new THREE.BoxGeometry(w * 1.04, baseH, d).translate(0, baseH / 2, 0),
      kick: new THREE.BoxGeometry(w * 1.06, 0.1, d + 0.02).translate(0, 0.05, 0),
      deck,
      cab: new THREE.BoxGeometry(w, cabH, d * 0.92).translate(0, baseH + cabH / 2, -0.04),
      bezel: new THREE.BoxGeometry(w * 0.9, screenH + 0.14, 0.06).translate(0, baseH + cabH - screenH / 2 - 0.12, d * 0.42 + 0.01),
      topper: new THREE.CylinderGeometry(w / 2, w / 2, d * 0.92, 28, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, topperH / (w / 2), 1).translate(0, baseH + cabH, -0.04),
      marquee: new THREE.BoxGeometry(w * 0.7, 0.07, 0.02).translate(0, baseH + cabH + topperH * 0.4, d * 0.42 + 0.02),
      candle: new THREE.CylinderGeometry(0.07, 0.09, 0.3, 10).translate(0, bodyH + 0.12, -0.04),
      lever: new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8).rotateZ(0.12).translate(w / 2 + 0.1, baseH + 0.6, 0),
      leverBall: new THREE.SphereGeometry(0.11, 12, 10).translate(w / 2 + 0.155, baseH + 1.06, 0),
      leverHub: new THREE.CylinderGeometry(0.12, 0.12, 0.12, 12).rotateZ(Math.PI / 2).translate(w / 2 + 0.05, baseH + 0.15, 0),
      buttons: [-0.3, 0, 0.3].map((x) => new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12).rotateX(-0.35).translate(x * w, baseH + 0.1, d / 2 + 0.14)),
    };
  }, [w, d, cabH, screenH, topperH, bodyH]);
  const lampRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!lampRef.current) return;
    lampRef.current.visible = !stalled || reducedMotion() || Math.sin(clock.elapsedTime * 2.2) > -0.2;
  });
  const body = useMemo(() => {
    if (!hovered && !selected && !closed) return kit.slotBody;
    const m = kit.slotBody.clone();
    if (closed) m.color.multiplyScalar(0.6);
    if (hovered || selected) {
      m.emissive.set(lampColor);
      m.emissiveIntensity = 0.12;
    }
    return m;
  }, [kit.slotBody, hovered, selected, closed, lampColor]);
  const working = active && !closed;
  const screenY = baseH + cabH - screenH / 2 - 0.12;
  return (
    <group>
      <mesh geometry={geo.base} material={body} castShadow receiveShadow />
      <mesh geometry={geo.kick} material={kit.brass} />
      <mesh geometry={geo.deck} material={kit.painted(row, 0.35)} castShadow />
      {geo.buttons.map((b, i) => (
        <mesh key={i} geometry={b} material={kit.glow(i === 1 ? kit.p.slotGlowB : kit.p.ivory, working ? 1.6 : 0.6)} />
      ))}
      <mesh geometry={geo.cab} material={body} castShadow receiveShadow />
      <mesh geometry={geo.bezel} material={kit.brass} castShadow />
      <group position={[0, screenY, d * 0.42 + 0.045]}>
        {shape.shuttered ? (
          <mesh material={reservedMat}>
            <planeGeometry args={[w * 0.82, screenH * 0.7]} />
          </mesh>
        ) : (
          <Reels w={w * 0.82} h={screenH} active={active} stalled={stalled} done={done} closed={closed} seed={seed} light={kit.light} />
        )}
      </group>
      <mesh geometry={geo.topper} material={kit.painted(row, 0.25)} castShadow />
      <mesh geometry={geo.marquee} material={kit.glow(row, closed ? 0.4 : working ? 2.4 : 1.3)} />
      <mesh geometry={geo.lever} material={kit.brass} castShadow />
      <mesh geometry={geo.leverHub} material={kit.brass} />
      <mesh geometry={geo.leverBall} material={kit.painted('#b3202a', 0.2)} castShadow />
      <mesh geometry={geo.candle} material={kit.brass} />
      {!done && !closed && <mesh ref={lampRef} position={[0, bodyH + 0.42, -0.04]} material={kit.glow(lampColor, 2.8)}>
        <sphereGeometry args={[0.2, 14, 10]} />
      </mesh>}
    </group>
  );
}

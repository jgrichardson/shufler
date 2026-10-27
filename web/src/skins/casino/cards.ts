import * as THREE from 'three';
import type { PodKind } from '../api';
import { canvas, canvasTexture, roundRect, spaced } from './kit';

/*
 * Card faces, card backs and chip faces, drawn to canvases at runtime and cached by what they show, so a
 * board of cards costs a handful of textures and no downloads.
 */

export type Suit = '♠' | '♥' | '♦' | '♣';
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

/** Suit per kind: pull requests are spades, issues hearts, data fixes diamonds, plans and docs clubs. */
export const SUIT: Record<PodKind, Suit> = { pr: '♠', issue: '♥', data_fix: '♦', plan: '♣', docs: '♣' };
const KIND_LABEL: Record<PodKind, string> = { pr: 'PULL REQUEST', issue: 'ISSUE', data_fix: 'DATA FIX', plan: 'PLAN', docs: 'DOCS' };

const W = 320;
const H = 448;
const SERIF = 'Georgia, "Times New Roman", serif';
const red = (s: Suit) => s === '♥' || s === '♦';

const cache = new Map<string, THREE.Texture>();
function cached(key: string, draw: () => HTMLCanvasElement | null): THREE.Texture | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = draw();
  if (!c) return null;
  const t = canvasTexture(c);
  cache.set(key, t);
  return t;
}

function blank(paper: string): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const made = canvas(W, H);
  if (!made) return null;
  const [, g] = made;
  g.fillStyle = paper;
  g.fillRect(0, 0, W, H);
  return made;
}

/** Rank and suit in the top-left corner, and turned in the bottom-right. */
function indices(g: CanvasRenderingContext2D, rank: string, suit: Suit, ink: string) {
  const corner = () => {
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = `700 ${rank === '10' ? 54 : 62}px ${SERIF}`;
    g.fillText(rank, 46, 76);
    g.font = `48px ${SERIF}`;
    g.fillText(suit, 46, 124);
  };
  corner();
  g.save();
  g.translate(W, H);
  g.rotate(Math.PI);
  corner();
  g.restore();
}

/**
 * A card face: ivory stock, a hairline frame in the row's colour, indices in two corners, the suit large in
 * the middle (framed in gold for court cards) and what the item is in small capitals under it.
 */
export function faceTexture(kind: PodKind, rank: string, domain: string, paper: string): THREE.Texture | null {
  const suit = SUIT[kind];
  return cached(`face|${kind}|${rank}|${domain}|${paper}`, () => {
    const made = blank(paper);
    if (!made) return null;
    const [c, g] = made;
    const ink = red(suit) ? '#c3262f' : '#17161b';
    // frame in the row's colour
    g.strokeStyle = domain;
    g.lineWidth = 7;
    roundRect(g, 14, 14, W - 28, H - 28, 22);
    g.stroke();
    indices(g, rank, suit, ink);
    const court = rank === 'J' || rank === 'Q' || rank === 'K';
    if (court) {
      g.strokeStyle = '#b8913e';
      g.lineWidth = 4;
      roundRect(g, 86, 116, W - 172, H - 232, 14);
      g.stroke();
      g.lineWidth = 1.5;
      roundRect(g, 94, 124, W - 188, H - 248, 10);
      g.stroke();
    }
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${rank === 'A' ? 210 : court ? 120 : 168}px ${SERIF}`;
    g.fillText(suit, W / 2, H / 2 - 8);
    if (court) {
      g.font = `700 44px ${SERIF}`;
      g.fillText(rank, W / 2, H / 2 - 92);
    }
    g.fillStyle = '#6d6560';
    g.font = `600 16px ${SERIF}`;
    g.textBaseline = 'alphabetic';
    spaced(g, KIND_LABEL[kind], W / 2, H - 96, 3);
    return c;
  });
}

/** The jester's cap: three drooping points with bells, drawn in red. */
function jesterCap(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, ink: string) {
  g.fillStyle = ink;
  g.strokeStyle = ink;
  // the band
  roundRect(g, cx - 62 * s, cy + 40 * s, 124 * s, 22 * s, 8 * s);
  g.fill();
  const tips: [number, number][] = [[-86, 4], [0, -70], [86, 4]];
  for (const [tx, ty] of tips) {
    g.beginPath();
    g.moveTo(cx - 52 * s, cy + 42 * s);
    g.quadraticCurveTo(cx + (tx * 0.4 - 10) * s, cy + (ty * 0.2 - 10) * s, cx + tx * s, cy + ty * s);
    g.quadraticCurveTo(cx + (tx * 0.4 + 10) * s, cy + (ty * 0.2 + 18) * s, cx + 52 * s, cy + 42 * s);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#d4a84a';
  for (const [tx, ty] of tips) {
    g.beginPath();
    g.arc(cx + tx * s, cy + ty * s - 2, 12 * s, 0, Math.PI * 2);
    g.fill();
  }
}

/** The needs-you card: a red joker, "your call". */
export function jokerTexture(kind: PodKind, domain: string, paper: string): THREE.Texture | null {
  return cached(`joker|${kind}|${domain}|${paper}`, () => {
    const made = blank(paper);
    if (!made) return null;
    const [c, g] = made;
    const ink = '#c3262f';
    g.strokeStyle = ink;
    g.lineWidth = 9;
    roundRect(g, 12, 12, W - 24, H - 24, 22);
    g.stroke();
    g.strokeStyle = domain;
    g.lineWidth = 4;
    roundRect(g, 26, 26, W - 52, H - 52, 16);
    g.stroke();
    // JOKER down the corners
    const corner = () => {
      g.fillStyle = ink;
      g.font = `700 30px ${SERIF}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      [...'JOKER'].forEach((ch, i) => g.fillText(ch, 50, 62 + i * 30));
      g.font = `30px ${SERIF}`;
      g.fillText('★', 50, 62 + 5 * 30 + 4);
    };
    corner();
    g.save();
    g.translate(W, H);
    g.rotate(Math.PI);
    corner();
    g.restore();
    jesterCap(g, W / 2, H / 2 - 40, 1, ink);
    g.fillStyle = ink;
    g.font = `700 27px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    spaced(g, 'YOUR CALL', W / 2 - 6, H / 2 + 84, 3);
    g.fillStyle = '#6d6560';
    g.font = `600 15px ${SERIF}`;
    spaced(g, KIND_LABEL[kind], W / 2 - 6, H - 74, 3);
    return c;
  });
}

const shade = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
const tint = (hex: string, k: number) => `#${new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k).getHexString()}`;

/** A card back in the row's colour: white border, a fine lattice, a central oval with a serif S. */
export function backTexture(color: string, paper: string): THREE.Texture | null {
  return cached(`back|${color}|${paper}`, () => {
    const made = blank(paper);
    if (!made) return null;
    const [c, g] = made;
    const inset = 22;
    roundRect(g, inset, inset, W - inset * 2, H - inset * 2, 16);
    g.fillStyle = color;
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = tint(color, 0.35);
    g.globalAlpha = 0.55;
    g.lineWidth = 2;
    for (let k = -H; k < W + H; k += 20) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + H, H);
      g.moveTo(k, H);
      g.lineTo(k + H, 0);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
    // inner frame
    g.strokeStyle = tint(color, 0.75);
    g.lineWidth = 3;
    roundRect(g, inset + 12, inset + 12, W - (inset + 12) * 2, H - (inset + 12) * 2, 10);
    g.stroke();
    // central oval and monogram
    g.beginPath();
    g.ellipse(W / 2, H / 2, 74, 98, 0, 0, Math.PI * 2);
    g.fillStyle = shade(color, 0.62);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#f3e6c4';
    g.stroke();
    g.fillStyle = '#f7ecd2';
    g.font = `italic 700 132px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('S', W / 2, H / 2 + 6);
    return c;
  });
}

/** A chip's top: the domain colour with six white edge spots, an inner ring and the house S. */
export function chipTopTexture(color: string): THREE.Texture | null {
  return cached(`chip|${color}`, () => {
    const made = canvas(256, 256);
    if (!made) return null;
    const [c, g] = made;
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#f6efe0';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.save();
      g.translate(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108);
      g.rotate(a);
      g.fillRect(-12, -22, 24, 44);
      g.restore();
    }
    g.strokeStyle = '#f6efe0';
    g.lineWidth = 5;
    g.setLineDash([10, 8]);
    g.beginPath();
    g.arc(128, 128, 74, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = shade(color, 0.8);
    g.beginPath();
    g.arc(128, 128, 64, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f6efe0';
    g.font = `italic 700 84px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('S', 128, 134);
    return c;
  });
}

/** A chip's edge: the domain colour with white inserts, wrapped round the rim. */
export function chipEdgeTexture(color: string): THREE.Texture | null {
  return cached(`chipEdge|${color}`, () => {
    const made = canvas(256, 16);
    if (!made) return null;
    const [c, g] = made;
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 16);
    g.fillStyle = '#f6efe0';
    for (let i = 0; i < 6; i++) g.fillRect(i * (256 / 6) + 8, 0, 18, 16);
    return c;
  });
}

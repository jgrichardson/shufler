import { create } from 'zustand';
import { getStored, storageKey } from '../lib/storage';

const KEY = storageKey('reducedMotion');

function initial(): boolean {
  try {
    const v = getStored(KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* storage unavailable */
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Reduced motion: every journey, ride and morph shortens to 0.3s. */
export const REDUCED_SECONDS = 0.3;

export const useMotion = create<{ reduced: boolean; setReduced: (v: boolean) => void }>()((set) => ({
  reduced: initial(),
  setReduced: (reduced) => {
    try {
      localStorage.setItem(KEY, reduced ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    set({ reduced });
  },
}));

export const reducedMotion = () => useMotion.getState().reduced;

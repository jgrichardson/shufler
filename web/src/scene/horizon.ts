import { create } from 'zustand';

/*
 * Horizon camera: an opt-in view that tilts the camera low over the front rows, so the sky, the skyline and
 * the landmarks a skin draws behind the board fill the top of the frame. It is a camera mode, not a preset:
 * the rows, selection and layers stay exactly as they were. The rig (CameraRig) owns the framing and the
 * flight; this module owns only the on/off state, so the top bar, the H key and ?camera= share it.
 */

/** Wider lens than the Overview's 25°: the near rows stay large while the horizon fits in the same frame. */
export const HORIZON_FOV = 60;
/** The camera's own look-down angle at the horizon; the horizon line sits tan(pitch)/tan(fov/2) above centre. */
export const HORIZON_PITCH_DEG = 18;
/** How low the user may orbit while the view is on (radians from straight down); the default view stops at 1.3. */
export const HORIZON_MAX_POLAR = 1.5;
/** Seconds for the tilt in and out; reduced motion shortens it like every other flight. */
export const HORIZON_SECONDS = 1.6;

/** ?camera=horizon opens on the horizon view (for screenshots and links); anything else keeps the default camera. */
export function cameraFromQuery(search: string): 'horizon' | 'default' {
  const v = new URLSearchParams(search).get('camera');
  return v != null && v.toLowerCase() === 'horizon' ? 'horizon' : 'default';
}

const initial = () => {
  try {
    return cameraFromQuery(window.location.search) === 'horizon';
  } catch {
    return false;
  }
};

interface HorizonState {
  on: boolean;
  /** Bumps when the user turns the view on or off, so the rig flies in or out. `drop` leaves it alone. */
  seq: number;
  /** True when the last bump was `reframe`: the view stays on and the rig re-frames it for a new layout. */
  reframed: boolean;
  set: (on: boolean) => void;
  toggle: () => void;
  /** Another flight (a preset, Enter, N, R) took the camera; clear the flag without flying back. */
  drop: () => void;
  /** The world layout changed (grid or big islands) while the view is on: stay on and re-frame it. */
  reframe: () => void;
}

export const useHorizon = create<HorizonState>()((set, get) => ({
  on: initial(),
  seq: 0,
  reframed: false,
  set: (on) => {
    if (on !== get().on) set({ on, seq: get().seq + 1, reframed: false });
  },
  toggle: () => get().set(!get().on),
  drop: () => {
    if (get().on) set({ on: false });
  },
  reframe: () => {
    if (get().on) set({ seq: get().seq + 1, reframed: true });
  },
}));

export const toggleHorizon = () => useHorizon.getState().toggle();

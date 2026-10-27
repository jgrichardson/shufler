/** Pointer and wheel rules for moving around the world (morning review round 1, item 3). Pure; tested. */

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  /** Non-standard Chromium/WebKit fields; trackpads report exactly -3x the delta. */
  wheelDeltaX?: number;
  wheelDeltaY?: number;
}

/**
 * Trackpad two-finger scroll pans; pinch (ctrlKey) and a mouse wheel zoom.
 * A mouse wheel notch reports wheelDelta in multiples of 120 or uses line mode; a trackpad
 * reports exactly -3x the delta, or moves sideways.
 */
export function classifyWheel(e: WheelLike): 'zoom' | 'pan' {
  if (e.ctrlKey) return 'zoom';
  if (e.deltaMode !== 0) return 'zoom';
  const wy = e.wheelDeltaY;
  const wx = e.wheelDeltaX;
  if (typeof wy === 'number' || typeof wx === 'number') {
    const y = wy ?? 0;
    const x = wx ?? 0;
    if ((y !== 0 && y % 120 === 0) || (x !== 0 && x % 120 === 0)) return 'zoom';
    if ((y !== 0 && y === -3 * e.deltaY) || (x !== 0 && x === -3 * e.deltaX)) return 'pan';
    // a sideways component only comes from a trackpad (or a tilt wheel, which should pan anyway)
    return e.deltaX !== 0 ? 'pan' : 'zoom';
  }
  return e.deltaX !== 0 ? 'pan' : 'zoom';
}

/** Distance multiplier for a zoom step; deltaY > 0 zooms out. Pinch deltas are small, so they get more gain. */
export function zoomFactor(deltaY: number, pinch: boolean): number {
  const k = pinch ? 0.012 : 0.0016;
  return Math.exp(Math.max(-0.5, Math.min(0.5, deltaY * k)));
}

/** Pointer-down that should pan the scene even when it starts on a plate. */
export function isPanGesture(button: number, shiftKey: boolean, spaceHeld: boolean): boolean {
  return button === 2 || button === 1 || (button === 0 && (shiftKey || spaceHeld));
}

/** Arrow keys pan, + / - zoom. Returns null for keys the camera ignores. */
export function keyNav(key: string): { pan?: [number, number]; zoom?: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { pan: [-1, 0] };
    case 'ArrowRight':
      return { pan: [1, 0] };
    case 'ArrowUp':
      return { pan: [0, -1] };
    case 'ArrowDown':
      return { pan: [0, 1] };
    case '+':
    case '=':
      return { zoom: 0.85 };
    case '-':
    case '_':
      return { zoom: 1 / 0.85 };
    default:
      return null;
  }
}

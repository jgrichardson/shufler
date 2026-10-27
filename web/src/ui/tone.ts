/**
 * A palette colour (status, phase, ball) used as text. Raw lamp colours are tuned for the 3D world and fail
 * contrast on light panels, so text mixes them toward the theme's --text: --tone is how much colour survives
 * (85% on dark chrome, 45% on light). Dots, bars and fills keep the raw colour.
 */
export const tone = (color: string) => `color-mix(in srgb, ${color} var(--tone), var(--text))`;

import type { ChromeTokens } from './types';

/*
 * Light-mode chrome shared by every skin: white glass panels, dark ink. A skin can adjust this (usually
 * just the accent) with `chromeLight`. Tokens that mean "dark ink on a coloured chip" (--surface-2,
 * --surface-3) stay dark, and --paper/--surface swap, because they are the selected background and the
 * text on it. Status inks are darkened to pass WCAG AA (4.5:1) on white; contrast.test.ts checks them.
 */
export const LIGHT_CHROME: ChromeTokens = {
  '--bg': '#eef2f7',
  '--glass': 'rgba(255, 255, 255, 0.94)',
  '--glass-strong': 'rgba(255, 255, 255, 0.97)',
  '--glass-border': 'rgba(20, 32, 52, 0.14)',
  '--overlay': '#0b1524',
  '--text': '#152030',
  '--muted': '#4b5869',
  '--faint': '#5d6978',
  '--accent': '#1668a8',
  '--accent-ink': '#ffffff',
  '--accent-hi': '#2a7fc4',
  '--accent-lo': '#1662a0',
  '--accent-border': '#1b67a6',
  '--accent-light': '#155f99',
  '--panel': '#ffffff',
  '--panel-hi': '#eef2f7',
  '--shade': '#0b1a33',
  '--surface': '#ffffff',
  '--paper': '#152030',
  '--ink-hi': '#0b1524',
  '--ink-muted': '#c3ccd8',
  '--soft-1': '#36424f',
  '--soft-2': '#435060',
  '--loading': '#4b5869',
  '--bad-ink': '#b42318',
  '--warn-ink': '#8a4f00',
  '--ok-ink': '#17703c',
  '--info-ink': '#155f99',
  '--violet-ink': '#6d2f8e',
  '--teal-ink': '#0b6e55',
  '--tone': '45%',
  '--chip-alpha': '15%',
  '--field': '#ffffff',
  '--well': '#f2f4f8',
  '--track': 'rgba(20, 32, 52, 0.07)',
  '--raised': '#ffffff',
  '--attn-bg': '#ffffff',
  '--attn-bg-hover': '#fff5f4',
  '--attn-border': 'rgba(180, 35, 24, 0.22)',
};

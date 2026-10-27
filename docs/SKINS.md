# Skins

A skin decides how Shufler looks. It does not decide what anything means. Positions, picking, pod
travel, status lamps, sky beams, selection rings, the focus grey-out and the Pipeline fade all stay in
the core, so every skin behaves the same and a skin bug cannot hide a red session.

Five skins ship with the app: **Starship** (the default), **Factory**, **Sky Islands**, **Theme Park** and **Casino**. Users switch between them in
**Settings → Appearance** or with `?skin=<id>` in the URL. The choice is kept in the browser.

| | Dark | Light |
|---|---|---|
| **Starship** | <img src="images/hero.png" alt="Starship skin, dark theme"> | <img src="images/starship-light.png" alt="Starship skin, light theme"> |
| **Factory** | <img src="images/factory-dark.png" alt="Factory skin, dark theme"> | <img src="images/factory-light.png" alt="Factory skin, light theme"> |
| **Sky Islands** | <img src="images/skyislands-dark.png" alt="Sky Islands skin, dark theme"> | <img src="images/skyislands-light.png" alt="Sky Islands skin, light theme"> |
| **Theme Park** | <img src="images/themepark-dark.png" alt="Theme Park skin, dark theme"> | <img src="images/themepark-light.png" alt="Theme Park skin, light theme"> |
| **Casino** | <img src="images/casino-dark.png" alt="Casino skin, dark theme"> | <img src="images/casino-light.png" alt="Casino skin, light theme"> |

<img src="images/gifs/skins.gif" width="820" alt="Switching skins live from Starship to Factory, Sky Islands, Theme Park, Casino and back">

**Theme Park** (`?skin=themepark`) turns the board into a park: each row is a themed land with an entrance
arch, its work rides a steel coaster in the row's colour, each phase column is a ride station with its
platform edge lit in the phase accent, the landmarks are rides (carousel, wave swinger, coaster loop, drop
tower, swinging ship, teacups, rocket), and shipped work lands as wrapped gift boxes in the gift shop. Light
mode is golden hour; dark mode is the park at night under string lights, with the Ferris wheel lit. A car
whose ball is with you stalls with its hazard lamps flashing, under the usual red beam and ring. Assets are
CC0 and listed in `web/src/skins/themepark/ASSETS.md`.

**Casino** (`?skin=casino`) turns the board into a card room: each row is a felt table edged in the row's
colour, each session is a slot machine, and work items are playing cards (pull requests are spades, issues
hearts, data fixes diamonds, plans and docs clubs) that lie face down in the overview and face up when you
zoom in. When a card moves it is dealt: it lifts, slides and taps down where it lands. The landmarks are
casino pieces (roulette wheel, dice, chip towers, money wheel, eye in the sky, riffle-shuffle bridge, jackpot
machine), and shipped work is cashed out as chip stacks at the cashier's cage. Light mode is a daylight
salon; dark mode is the card room at night under the "SHUFLER CASINO / THE HOUSE ALWAYS SHIPS" sign. A card
whose ball is with you turns into a red joker, face up even in the overview, under the usual red beam and
ring. Assets are CC0 and listed in `web/src/skins/casino/ASSETS.md`.

![The skin picker in Settings → Appearance](images/settings-skins.png)

There are two ways to make your own:

| | JSON recolour | Code skin |
|---|---|---|
| Changes | colours, fog, exposure, grey-out style, panel colours | everything: geometry, materials, lights, sky |
| Needs | a text editor | TypeScript, React Three Fiber |
| Install | Settings → Appearance → Import skin JSON… | a folder under `web/src/skins/`, then rebuild |
| Shared by | sending the file | a pull request, or keeping it in `skins/local/` |

## JSON recolours

The fastest start: pick the skin you want to change, open **Settings → Appearance** and click **Export
current as template**. Edit the file and import it again. `docs/examples/ember.skin.json` is a
complete example.

```json
{
  "id": "ember",
  "name": "Ember",
  "description": "Starship with amber light strips over a red planet.",
  "extends": "starship",
  "scene": { "background": "#120806", "fog": { "color": "#140906", "near": 700, "far": 1800 } },
  "chrome": { "--accent": "#ffb36b" },
  "palette": { "light": "#ffbe7a", "planetAtmosphere": "#ff6a3d" }
}
```

| Field | Meaning |
|---|---|
| `id` | lowercase letters, digits and dashes; must not clash with an installed skin |
| `name`, `description`, `author`, `version` | shown in the picker |
| `extends` | the installed code skin whose shapes you reuse (`starship`, `factory`, …) |
| `scene.background` | clear colour behind the sky |
| `scene.fog` | `{ color, near, far }` or `null` |
| `scene.exposure` | renderer exposure, 0–4 |
| `scene.dim` | the grey-out style, see below |
| `scene.ring` | colour of the selection ring |
| `scene.beams` | `{ additive, intensity }` for the red need-me beams: additive glow suits a dark sky, `false` a bright one; intensity 0–3 |
| `sceneLight` | light-mode scene, laid over `scene` (same keys); see Light mode below |
| `chrome` | CSS tokens for panels and labels, see below |
| `chromeLight` | light-mode chrome tokens, laid over the shared light chrome |
| `palette` | the extended skin's own colour keys; see its `palette.ts` |
| `paletteLight` | palette keys that change in light mode, laid over `palette` |

Everything you leave out comes from the extended skin. Imported files are checked on the way in: only
strings are accepted as colours, and anything that could load a resource (`url(`, `@import`,
`expression(`) is refused. Imported skins live in this browser only.

### Light mode

Light mode is a different scene, not just different panels. Each shipped skin has a designed light
variant: Factory turns into a clear, hazy morning (soft blue sky, slate rails) and Starship into the
station's day side (pale sky-blue haze, the planet lit below, frosted decks). A skin describes it with
three optional fields, each laid over its dark counterpart:

- `sceneLight`: background, fog, exposure, bloom and vignette, the grey-out style, beams and ring.
- `paletteLight`: the palette keys that change, usually sky, fog, lights and deck colours.
- `chromeLight`: panel tokens over the shared light chrome.

A JSON recolour inherits its base skin's light variant. Keys the base sets in `paletteLight` or
`sceneLight` win over your `palette` and `scene` in light mode, so a recolour that changes the sky
should set both. Ember shows this.

A skin with no `sceneLight` gets an automatic lift in light mode: 15% more exposure, softer bloom and
vignette, a paler grey-out and non-additive beams. Its sky stays as designed, so a dark-sky skin should
ship a light variant.

Code skins can read the theme with `useResolvedTheme()` (`'dark' | 'light'`) for changes a colour cannot
express, such as hiding stars or switching a light rig. Starship's `Backdrop.tsx` does this.

### Palette keys

Each code skin reads its colours through `useSkinPalette`, so a recolour can reach its meshes. The keys
are listed, with comments, in the skin's `palette.ts`:

- Starship: `web/src/skins/starship/palette.ts` (`hull`, `graphite`, `light`, `planetAtmosphere`, …)
- Factory: `web/src/skins/factory/palette.ts`
- Theme Park: `web/src/skins/themepark/palette.ts` (`steel`, `support`, `bulb`, `paving`, `lawn`, …)

Domain, phase and status colours are not in any palette. They carry meaning and stay the same in every
skin.

### Chrome tokens

The 2D chrome (panels, bars, plates, row headers, terminal) reads CSS custom properties. Defaults are in
`web/src/styles.css` under `:root`.

| Token | Used for |
|---|---|
| `--bg` | page background behind the canvas |
| `--glass`, `--glass-strong`, `--glass-border` | translucent panels and their edge |
| `--text`, `--muted`, `--faint` | text, secondary text, hints |
| `--accent`, `--accent-hi`, `--accent-lo`, `--accent-border`, `--accent-light`, `--accent-ink` | highlights, primary buttons (gradient hi → lo), links; `ink` is text on the accent |
| `--panel`, `--panel-hi` | the solid colour behind glass, and a raised variant |
| `--shade` | shadows and the modal backdrop |
| `--surface`, `--surface-2`, `--surface-3` | dark ink on light chips and selected headers |
| `--paper`, `--ink-hi`, `--ink-muted` | light backgrounds (selected row header, plates), near-white text, muted text on paper |
| `--soft-1`, `--soft-2` | quiet text inside panels and previews |
| `--loading` | the boot screen text |
| `--term-bg` | terminal background (the terminal also follows `--text` and `--accent`) |
| `--orb` | the brand orb, any CSS background |

Status colours (`--me`, `--ok`, `--warn` and the reds and greens in badges) are deliberately not themable.

### The grey-out style

When the user selects a row, domain, column or item, everything else greys out and the camera stays
where it is. `scene.dim` tunes how that looks:

| Key | Default | Meaning |
|---|---|---|
| `tint` | `#3d4552` | the colour out-of-focus surfaces drift toward |
| `amount` | 0.85 | 0–1, how far they drift |
| `darken` | 0.55 | brightness multiplier on the grey |
| `glow` | 0.18 | how much light strips and lamps keep |

On a bright skin, raise `darken` toward 1 so dimmed parts do not turn into dark holes; the shipped light
variants use a pale `tint` with `darken` just above 1, so out-of-focus parts recede into the haze.

## Code skins

A code skin is a folder with an `index.tsx` whose default export is a skin:

```
web/src/skins/<id>/index.tsx      ships with the app
web/src/skins/local/<id>/index.tsx   yours only (git-ignored)
```

Both are found at build time; there is nothing to register. Run `npm run dev` in `web/` and open
`http://localhost:5173/?skin=<id>&mock=1` to work against mock data.

The quickest code skin changes one or two parts of an existing one:

```tsx
// web/src/skins/local/glass/index.tsx
import { extendSkin } from '../../api';
import starship from '../../starship';
import { Session } from './Session';

export default extendSkin(starship, {
  id: 'glass',
  name: 'Glass towers',
  description: 'Starship with smoked-glass session towers.',
  components: { Session },
});
```

A full skin supplies every slot with `defineSkin({...})`; `web/src/skins/starship/` is the reference.

### Rules

- Import from `web/src/skins/api.ts` only (plus `three`, `react`, `@react-three/fiber`,
  `@react-three/drei` and your own folder). The API is what stays stable; core internals may move.
- Draw at the slot's local origin, inside the footprint documented in `web/src/skins/types.ts`. The core
  positions, scales and wires events around you; labels and picking assume the footprints.
- No pointer handlers, no selection or dim logic, no lamps or beams except where a slot asks for them
  (the Session slot draws its own status lamp from `lampColor`). The core greys out and fades your meshes
  for you by swapping in derived materials, so sharing one material across many meshes is fine.
- Mark effect-only materials (halos, glows) with `toneMapped: false` or additive blending. The grey-out
  turns those down instead of greying them.
- Read your colours through `useSkinPalette(DEFAULTS)` so JSON recolours and light mode reach your
  meshes. It returns one stable object per palette and theme, so you can cache materials on it.
- Respect `reducedMotion()` for idle animation.
- The Backdrop slot must provide the scene's lights.

### Slots

All prop types are in `web/src/skins/types.ts`.

| Slot | Draws | Notes |
|---|---|---|
| `Backdrop` | sky, lights, environment, scenery | rebuilt on skin and theme switch |
| `Platform` | a floating base, top at y = 0 | rows and the warehouse stand on one |
| `Island` | a row's platform plus decoration | keep clear of `buildingLocal` |
| `Session` | one Claude workspace | use `height`; draw the lamp from `lampColor` |
| `Landmark` | the district landmark behind a column | about 10 × 8 |
| `Lane`, `Ramp`, `DistrictBand` | the board decks | Lane runs `x0`→`x1` along +x |
| `PodBody` | an item on the board | about 2 × 1.4 × 1.2; `dot` asks for a flat token |
| `Crate` | a shipped item | 1.25 cube |
| `WarehouseShell`, `Rack`, `Dock` | the shipped warehouse | crates and labels are the core's |
| `Library` (optional) | the context library building, back-left of the board | footprint radius about 4.6, up to about 8.5 tall, front facing +z; the core scales it by 2.5. Light one volume per item from `items` and a beacon when `owed > 0`. Skins without it get a generic library |

### Sharing a skin

Put it in `web/src/skins/<id>/` and open a pull request, or send people the folder to drop into
`skins/local/`. Keep ids unique; a duplicate id is skipped with a console warning.

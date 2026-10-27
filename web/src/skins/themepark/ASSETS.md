# Theme Park assets

All files live in `web/public/skins/themepark/` and are CC0 (public domain). Total: about 1.5 MB on disk. The
HDRI (1.0 MB) is fetched in light mode only; dark mode lights its reflections with procedural light panels
(drei `Lightformer`), so it downloads nothing extra.

| File | Source | URL | License | Processing |
|---|---|---|---|---|
| `industrial_sunset_02_puresky.hdr` (1.05 MB) | Poly Haven, "Industrial Sunset 02 (Pure Sky)" | https://polyhaven.com/a/industrial_sunset_02_puresky | CC0 | 1k HDR as downloaded; golden-hour image-based light and steel reflections |
| `herringbone_pavement_diff.jpg` (97 KB), `herringbone_pavement_nor.jpg` (80 KB) | Poly Haven, "Herringbone Pavement" | https://polyhaven.com/a/herringbone_pavement | CC0 | 1k → 512 px, JPEG q72; plazas, promenades, gift-shop plaza; the normal map alone gives the board floor its relief |
| `brown_planks_05_diff.jpg` (50 KB), `brown_planks_05_nor.jpg` (47 KB) | Poly Haven, "Brown Planks 05" | https://polyhaven.com/a/brown_planks_05 | CC0 | 1k → 512 px, JPEG q72; station platforms, display shelves, dock |
| `grass_ground_diff.jpg` (76 KB), `grass_ground_nor.jpg` (104 KB) | Poly Haven, "Grass Ground" | https://polyhaven.com/a/grass_ground | CC0 | 1k → 512 px, JPEG q72; the park lawn |

Everything else is procedural: the coaster track (tubular rails, ties and a box spine), ride cars, pavilions
with striped tent roofs, entrance arches, the seven landmark rides, the gift shop, gift boxes, trees, the Ferris
wheel, the skyline coaster and the sky dome (golden hour, or a night sky with stars and a moon). The "SHUFLER
PARK" sign is drawn to a canvas at runtime.

The Kenney "Coaster Kit" (CC0, https://kenney.nl/assets/coaster-kit) was evaluated and not used: its flat,
toy-like style reads as cartoon next to the polished target, and procedural track fits the lane layout exactly.

# Casino assets

All files live in `web/public/skins/casino/` and are CC0 (public domain), from Poly Haven. Total: about 1.85 MB
on disk. The HDRI (1.6 MB) is fetched in light mode only; dark mode lights its reflections with procedural
light panels (drei `Lightformer`), so it downloads nothing extra.

| File | Source | URL | License | Processing |
|---|---|---|---|---|
| `ballroom_1k.hdr` (1.67 MB) | Poly Haven, "Ballroom" | https://polyhaven.com/a/ballroom | CC0 | 1k HDR as downloaded; daylight image-based light and reflections for the light-mode salon |
| `felt_nor.jpg` (45 KB) | Poly Haven, "Polar Fleece" (normal map) | https://polyhaven.com/a/polar_fleece | CC0 | 1k → 512 px, JPEG q72; the nap of the table felt (the colour is the palette's) |
| `leather_nor.jpg` (48 KB) | Poly Haven, "Fabric Leather 02" (normal map) | https://polyhaven.com/a/fabric_leather_02 | CC0 | 1k → 512 px, JPEG q72; the grain of the padded rails, velvet ropes and runners (colour is the row's) |
| `dark_wood_diff.jpg` (77 KB), `dark_wood_nor.jpg` (14 KB) | Poly Haven, "Dark Wood" | https://polyhaven.com/a/dark_wood | CC0 | 1k → 512 px, JPEG q72; table aprons, daises, plinths, cabinets and the cage counter |

Everything else is procedural or drawn to a canvas at runtime, with no downloads: card faces (rank, suit, a
hairline frame in the row's colour and what the item is), card backs (the row's colour, a lattice and the
house S), the red joker, chip tops and edges, slot-machine reel strips, the table placards, the carpet (an
ornamental lattice in the palette's colours), the "SHUFLER CASINO / THE HOUSE ALWAYS SHIPS" sign, the
CASHIER and PAY WINDOW signs and the JACKPOT marquee. Geometry for tables, cards, chips, slot machines, the
roulette wheel, dice, money wheel, eye in the sky, riffle bridge, jackpot machine, dealing shoe and cage is
built in code.

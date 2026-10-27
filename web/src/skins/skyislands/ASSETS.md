# Sky Islands assets

All files live in `web/public/skins/skyislands/` and are CC0 (public domain). Total: about 2.9 MB on disk; a
session loads one HDRI (dark or light), so about 1.9 MB is fetched per theme.

| File | Source | URL | License | Processing |
|---|---|---|---|---|
| `qwantani_sunset_puresky.hdr` (1.0 MB) | Poly Haven, "Qwantani Sunset (Pure Sky)" | https://polyhaven.com/a/qwantani_sunset_puresky | CC0 | 1k HDR as downloaded; dark-theme image-based light |
| `kloppenheim_06_puresky.hdr` (1.1 MB) | Poly Haven, "Kloppenheim 06 (Pure Sky)" | https://polyhaven.com/a/kloppenheim_06_puresky | CC0 | 1k HDR as downloaded; light-theme image-based light |
| `cliff_side_diff.jpg`, `cliff_side_nor.jpg` | Poly Haven, "Cliff Side" | https://polyhaven.com/a/cliff_side | CC0 | 1k → 512 px; AO multiplied into the diffuse; island undersides, boulders |
| `leafy_grass_diff.jpg`, `leafy_grass_nor.jpg` | Poly Haven, "Leafy Grass" | https://polyhaven.com/a/leafy_grass | CC0 | 1k → 512 px; AO baked; island tops, foliage normal |
| `rock_wall_08_diff.jpg`, `rock_wall_08_nor.jpg` | Poly Haven, "Rock Wall 08" | https://polyhaven.com/a/rock_wall_08 | CC0 | 1k → 512 px; AO baked, brightened ×1.85; tower and house stone |
| `roof_slates_02_diff.jpg`, `roof_slates_02_nor.jpg` | Poly Haven, "Roof Slates 02" | https://polyhaven.com/a/roof_slates_02 | CC0 | 1k → 512 px; AO baked; roofs |
| `brown_planks_03_diff.jpg`, `brown_planks_03_nor.jpg` | Poly Haven, "Brown Planks 03" | https://polyhaven.com/a/brown_planks_03 | CC0 | 1k → 512 px; AO baked, brightened ×1.3; bridges, crates, warehouse, pod normals |

Geometry is procedural (islands, towers, trees, bridges, pods, crates). The KayKit Medieval Hexagon pack
(Kay Lousberg, CC0, https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0) was evaluated and
not used: its flat palette-texture style reads as cartoon next to the painted target.

# Command Post assets

Everything in this skin is procedural: geometry is built in code, and the map, camouflage netting,
corrugated iron, stencil lettering, counters and crate faces are drawn into canvases at runtime. There are
no downloaded models, textures or fonts. Stencil lettering uses the app's bundled Inter with the stencil
bridges cut in by `stencilText` in `kit.ts`.

Tone: logistics and ops only. No weapons, combat, casualties, real insignia or flags. `tests/commandpost.test.ts`
lints the skin's string literals for combat words.

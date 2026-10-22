# Recollect patterns

Three original geometric motifs extend Recollect's cobalt, yellow, and lilac palette:

- `weave`: connected quarter turns, arranged into a dense network.
- `flow`: parallel curves with one heavier band.
- `orbit`: offset orbital loops and small solid discs.

The 512 × 512 SVG files are editable sources. The 768 × 768 PNG files are the shared,
opaque raster assets used by the mobile app; no native SVG package is required.
Keep artwork separate from text and controls, and preserve the original app icon.

Geometry is defined in `scripts/generate-brand-patterns.mjs`. Regenerate the SVGs
using Node alone:

```sh
node scripts/generate-brand-patterns.mjs
```

To export the PNGs too, make the optional `sharp` tool available to Node and add
`--png`. Sharp is an export tool, not an application dependency:

```sh
NODE_PATH=/path/to/node_modules node scripts/generate-brand-patterns.mjs --png
```

The design direction was inspired by [Book of Shapes](https://bookofshapes.com/).
These files contain original Recollect geometry, without imported artwork or site code.

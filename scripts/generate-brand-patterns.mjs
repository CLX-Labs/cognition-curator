// Original Recollect geometry. Add --png with the optional `sharp` export tool
// available to Node to also regenerate retina PNGs. The app has no SVG dependency.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = process.argv.includes('--png') ? require('sharp') : null;
const output = fileURLToPath(new URL('../apps/landing/assets/patterns/', import.meta.url));
const palette = { cobalt: '#343AE7', yellow: '#E7ED9B', lilac: '#DDD9E8', paper: '#FAF9F5' };
const frame = (background, drawing) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="${background}"/>${drawing}</svg>\n`;

// Each tile rotates a pair of nested quarter turns. Their intersections make
// a dense woven rhythm while the outer paths continue into neighboring tiles.
const tileSize = 128;
const tileDrawing = [16, 48, 80, 112]
  .flatMap((radius) => [
    `<path d="M ${radius} 0 A ${radius} ${radius} 0 0 1 0 ${radius}"/>`,
    `<path d="M ${tileSize - radius} ${tileSize} A ${radius} ${radius} 0 0 1 ${tileSize} ${tileSize - radius}"/>`,
  ])
  .join('');
const tileRotations = [0, 90, 90, 0, 90, 0, 0, 90, 90, 0, 90, 0, 0, 90, 0, 90];
const weave = frame(
  palette.yellow,
  `<defs><clipPath id="tile"><rect width="128" height="128"/></clipPath></defs><g fill="none" stroke="${palette.cobalt}" stroke-width="7">${tileRotations
    .map((rotation, index) => {
      const x = (index % 4) * tileSize;
      const y = Math.floor(index / 4) * tileSize;
      return `<g transform="translate(${x} ${y})"><g clip-path="url(#tile)"><g transform="rotate(${rotation} 64 64)">${tileDrawing}</g></g></g>`;
    })
    .join('')}</g>`,
);

// Parallel curves move together through two broad bends, with the middle
// band using a heavier stroke to give the small thumbnail a strong anchor.
const flow = frame(
  palette.lilac,
  `<g fill="none" stroke="${palette.cobalt}" stroke-linecap="round">${Array.from(
    { length: 18 },
    (_, index) => {
      const y = -160 + index * 40;
      return `<path d="M -80 ${y} C 95 ${y - 145}, 150 ${y + 190}, 285 ${y + 100} S 465 ${y - 150}, 610 ${y - 40}" stroke-width="${index === 9 ? 16 : 7}"/>`;
    },
  ).join('')}</g>`,
);

// Off-center orbital loops form an asymmetric interlocking composition.
// The solid dots punctuate it without becoming symbols or navigation icons.
const orbit = frame(
  palette.cobalt,
  `<g fill="none" stroke="${palette.yellow}" stroke-width="25"><circle cx="102" cy="118" r="139"/><circle cx="102" cy="118" r="83"/><circle cx="382" cy="375" r="171"/><circle cx="382" cy="375" r="113"/></g><g fill="none" stroke="${palette.paper}" stroke-width="20"><path d="M 275 -22 A 162 162 0 0 1 492 198"/><path d="M -32 300 A 129 129 0 0 1 190 449"/></g><circle cx="291" cy="196" r="21" fill="${palette.paper}"/><circle cx="72" cy="399" r="17" fill="${palette.yellow}"/><circle cx="438" cy="74" r="13" fill="${palette.paper}"/>`,
);

await mkdir(output, { recursive: true });
for (const [name, source] of Object.entries({ weave, flow, orbit })) {
  await writeFile(`${output}/${name}.svg`, source);
  if (sharp)
    await sharp(Buffer.from(source))
      .resize(768, 768)
      .png({ compressionLevel: 9, palette: true })
      .toFile(`${output}/${name}.png`);
}

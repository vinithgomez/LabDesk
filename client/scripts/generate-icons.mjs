// Generates the PWA's PNG icons (installability needs 192 and 512 PNGs).
// Run with `npm run icons`; the output is committed under public/icons.
// The logomark (DESIGN.md §4): a 3x3 grid of slots with one booked, in cobalt.
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const BENCH = [0xf3, 0xf4, 0xf1];
const SLOT = [0xb9, 0xbe, 0xb3];
const COBALT = [0x1f, 0x47, 0xc4];
/** Which slot is booked (row, column). */
const BOOKED = [1, 1];

/** The grid drawn within `safe` (0..1) of the canvas, on the bench colour. */
function icon(size, safe) {
  const png = new PNG({ width: size, height: size });
  const inset = (size * (1 - safe)) / 2;
  const grid = size * safe;
  const gap = grid * 0.12;
  const cell = (grid - 2 * gap) / 3;
  const radius = cell * 0.16;
  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  };
  /** Inside a rounded square whose top-left is (ox, oy)? */
  const inRounded = (x, y, ox, oy) => {
    const dx = Math.max(ox + radius - x, 0, x - (ox + cell - radius));
    const dy = Math.max(oy + radius - y, 0, y - (oy + cell - radius));
    return x >= ox && x < ox + cell && y >= oy && y < oy + cell && dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let colour = BENCH;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const ox = inset + col * (cell + gap);
          const oy = inset + row * (cell + gap);
          if (inRounded(x + 0.5, y + 0.5, ox, oy)) colour = row === BOOKED[0] && col === BOOKED[1] ? COBALT : SLOT;
        }
      }
      set(x, y, colour);
    }
  }
  return PNG.sync.write(png);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", icon(192, 0.66));
writeFileSync("public/icons/icon-512.png", icon(512, 0.66));
// Maskable: content inside the 80% safe zone, so any mask shape keeps it whole.
writeFileSync("public/icons/icon-512-maskable.png", icon(512, 0.5));
console.log("icons written to public/icons");

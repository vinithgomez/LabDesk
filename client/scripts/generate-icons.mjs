// Generates the PWA's PNG icons (installability needs 192 and 512 PNGs).
// Run with `npm run icons`; the output is committed under public/icons.
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const BG = [0x4f, 0x46, 0xe5];
const FG = [0xff, 0xff, 0xff];

/** Indigo tile with three QR finder patterns, drawn within `safe` (0..1) of the canvas. */
function icon(size, safe) {
  const png = new PNG({ width: size, height: size });
  const inset = (size * (1 - safe)) / 2;
  const cell = (size * safe) / 21; // a 21-module grid, like a version-1 QR
  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  };
  const inFinder = (mx, my, ox, oy) => {
    const x = mx - ox, y = my - oy;
    if (x < 0 || y < 0 || x > 6 || y > 6) return false;
    const ring = Math.min(x, y, 6 - x, 6 - y);
    return ring === 0 || ring >= 2;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor((x - inset) / cell);
      const my = Math.floor((y - inset) / cell);
      const on =
        mx >= 0 && my >= 0 && mx < 21 && my < 21 &&
        (inFinder(mx, my, 0, 0) || inFinder(mx, my, 14, 0) || inFinder(mx, my, 0, 14) ||
          (mx >= 15 && mx <= 19 && my >= 15 && my <= 19));
      set(x, y, on ? FG : BG);
    }
  }
  return PNG.sync.write(png);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", icon(192, 0.7));
writeFileSync("public/icons/icon-512.png", icon(512, 0.7));
// Maskable: content inside the 80% safe zone, so any mask shape keeps it whole.
writeFileSync("public/icons/icon-512-maskable.png", icon(512, 0.55));
console.log("icons written to public/icons");

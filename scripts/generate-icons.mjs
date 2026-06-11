// One-off (rerunnable): rasterize public/favicon.svg into the PWA / Apple
// home-screen PNGs. Not part of the build chain — run `node scripts/generate-icons.mjs`
// after changing the favicon.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const BG = "#fafaf7";
const svg = await readFile("public/favicon.svg");

// glyphRatio < 1 leaves padding; maskable icons need the ~80% safe zone.
async function icon(size, glyphRatio, out) {
  const glyphSize = Math.round(size * glyphRatio);
  const glyph = await sharp(svg, { density: 300 })
    .resize(glyphSize, glyphSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const buf = await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: glyph, gravity: "centre" }])
    .png({ palette: true, effort: 9 })
    .toBuffer();
  await writeFile(`public/${out}`, buf);
  console.log(`public/${out} ${(buf.length / 1024).toFixed(1)} KB`);
}

await icon(180, 0.74, "apple-touch-icon.png");
await icon(192, 0.74, "icon-192.png");
await icon(512, 0.74, "icon-512.png");
await icon(512, 0.58, "icon-512-maskable.png");

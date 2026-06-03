// Post-build: palette-quantize the generated OG PNGs (flat cards → big win).
// Best-effort: any failure is swallowed so it can never break the deploy.
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.warn("[optimize-og] sharp unavailable — skipping");
  process.exit(0);
}

const dirs = ["dist/og", "dist/og/notes"];
let savedTotal = 0;

for (const dir of dirs) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    continue; // dir may not exist
  }
  for (const f of files) {
    if (!f.endsWith(".png")) continue;
    const p = join(dir, f);
    try {
      const input = await readFile(p);
      const before = input.length;
      const out = await sharp(input)
        .png({ palette: true, quality: 90, effort: 9 })
        .toBuffer();
      if (out.length < before) {
        await writeFile(p, out);
        savedTotal += before - out.length;
      }
    } catch (e) {
      console.warn(`[optimize-og] skip ${f}: ${e.message}`);
    }
  }
}

console.log(`[optimize-og] saved ${(savedTotal / 1024).toFixed(0)} KB`);

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = "C:\\Users\\vishv\\OneDrive\\Desktop\\Projects\\DeepSwarm";
const targetRoot = path.resolve("public", "games", "deep-swarm");
const source = await readFile(path.join(sourceRoot, "index.html"), "utf8");

const styleStart = source.indexOf("<style>");
const styleEnd = source.indexOf("</style>", styleStart);
const scriptStart = source.indexOf("<script>", styleEnd);
const scriptEnd = source.lastIndexOf("</script>");

if ([styleStart, styleEnd, scriptStart, scriptEnd].some((index) => index < 0)) {
  throw new Error("Deep Swarm source does not contain the expected single-file structure.");
}

const css = source.slice(styleStart + "<style>".length, styleEnd).trim() + "\n";
const js = source.slice(scriptStart + "<script>".length, scriptEnd).trim() + "\n";
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Deep Swarm, a deep-sea survival roguelite playable in the browser.">
  <title>Deep Swarm · Vish Vaddi</title>
  <link rel="stylesheet" href="/games/deep-swarm/deep-swarm.css">
</head>
<body>
  <a class="back-link" href="/games">Back to games</a>
  <canvas id="c" aria-label="Deep Swarm game canvas"></canvas>
  <script src="/games/deep-swarm/deep-swarm.js" defer></script>
</body>
</html>
`;

await mkdir(path.join(targetRoot, "concept_art"), { recursive: true });
await writeFile(path.join(targetRoot, "index.html"), html);
await writeFile(
  path.join(targetRoot, "deep-swarm.css"),
  css + `
.back-link {
  position: fixed;
  z-index: 20;
  top: 0.75rem;
  left: 0.75rem;
  padding: 0.42rem 0.62rem;
  border: 1px solid rgba(126, 197, 220, 0.38);
  border-radius: 5px;
  background: rgba(0, 8, 14, 0.72);
  color: #a7d8e8;
  font: 12px/1.2 "Courier New", monospace;
  text-decoration: none;
  opacity: 0.68;
}
.back-link:hover,
.back-link:focus-visible {
  opacity: 1;
  border-color: #75d2e6;
  outline: none;
}
`
);
await writeFile(path.join(targetRoot, "deep-swarm.js"), js);
await copyFile(
  path.join(sourceRoot, "concept_art", "02_cockpit_porthole_dread.png"),
  path.join(targetRoot, "concept_art", "02_cockpit_porthole_dread.png")
);

console.log(`Imported Deep Swarm to ${targetRoot}`);

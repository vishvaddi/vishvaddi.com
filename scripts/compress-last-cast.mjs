import { createReadStream, createWriteStream } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { constants, createGzip } from "node:zlib";

const source = "dist/games/last-cast/index.wasm";
const target = `${source}.gz`;
const loaderPath = "dist/games/last-cast/index.js";

await pipeline(
  createReadStream(source),
  createGzip({ level: constants.Z_BEST_COMPRESSION }),
  createWriteStream(target),
);
await rm(source);

const { size } = await stat(target);
const loader = await readFile(loaderPath, "utf8");
const original = "\t\t\tloadPromise = preloader.loadPromise(`${loadPath}.wasm`, size, true);";
const replacement = `\t\t\tloadPromise = preloader.loadPromise(\`\${loadPath}.wasm.gz\`, ${size}, true).then(function (response) {
\t\t\t\tif (typeof DecompressionStream === 'undefined') {
\t\t\t\t\tthrow new Error('This browser cannot decompress the Last Cast runtime.');
\t\t\t\t}
\t\t\t\treturn new Response(response.body.pipeThrough(new DecompressionStream('gzip')));
\t\t\t});`;
if (!loader.includes(original)) {
  throw new Error("Godot loader structure changed; compressed WASM patch was not applied");
}
await writeFile(loaderPath, loader.replace(original, replacement));

console.log(`[last-cast] compressed WASM to ${(size / 1024 / 1024).toFixed(1)} MB`);

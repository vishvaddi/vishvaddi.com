import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const base = "http://127.0.0.1:4321";
const server = process.platform === "win32"
  ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run dev -- --host 127.0.0.1"], { stdio: "pipe" })
  : spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], { stdio: "pipe" });
const waitForServer = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${base}/studio`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Dev server did not start");
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("/sw.js") && !text.includes("bad HTTP response code (404)")) errors.push(text);
  });
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
  await page.locator(".wa-tab").evaluateAll((tabs) => tabs.forEach((tab) => /** @type {HTMLElement} */ (tab).click()));
  await page.locator(".wa-tab").nth(1).click();
  await page.locator(".wa-grid .wa-cell").first().click();
  await page.locator(".wa-piano-cell").first().click();
  await page.locator(".wa-tab").nth(2).click();
  await page.locator(".wa-clip").first().click();
  await page.locator(".wa-transport button").first().click();
  await page.waitForTimeout(2000);
  await page.locator(".wa-transport button").nth(1).click();
  await page.getByRole("button", { name: "Undo" }).click();
  const audio = await page.evaluate(async () => {
    const buffer = await window.__vishamp.renderBuffer("pattern");
    const left = buffer.getChannelData(0); let sum = 0;
    for (let index = 0; index < left.length; index++) sum += left[index] * left[index];
    return { duration: buffer.duration, rms: Math.sqrt(sum / left.length) };
  });
  if (audio.duration <= 0 || audio.rms <= 0.00001) throw new Error(`Invalid render: ${JSON.stringify(audio)}`);
  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  console.log(`studio e2e passed: ${audio.duration.toFixed(2)}s, RMS ${audio.rms.toFixed(5)}`);
} finally {
  await browser?.close();
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  else server.kill("SIGTERM");
}

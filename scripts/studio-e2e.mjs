import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const port = 10000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const server = process.platform === "win32"
  ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm run dev -- --host 127.0.0.1 --port ${port} --force`], { stdio: "pipe" })
  : spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--force"], { stdio: "pipe" });
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
    if (message.type() === "error" && !text.includes("/sw.js") && !text.includes("bad HTTP response code (404)") && !text.includes("Outdated Optimize Dep")) errors.push(text);
  });
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
  await page.locator(".wa-tab").evaluateAll((tabs) => tabs.forEach((tab) => /** @type {HTMLElement} */ (tab).click()));
  await page.locator(".wa-tab").nth(1).click();
  if (await page.locator('.wa-knob[role="slider"]').count() < 1) throw new Error("Accessible knobs were not rendered");
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
  const pan = await page.evaluate(async () => {
    window.__vishamp.mixerState.channels[0].pan = -1;
    const buffer = await window.__vishamp.renderBuffer("pattern");
    const rms = (data) => Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
    const result = { left: rms(buffer.getChannelData(0)), right: rms(buffer.getChannelData(1)) };
    window.__vishamp.mixerState.channels[0].pan = 0;
    return result;
  });
  if (pan.left <= pan.right * 2) throw new Error(`Pan was not applied to export: ${JSON.stringify(pan)}`);
  const mutedRms = await page.evaluate(async () => {
    window.__vishamp.mixerState.channels[0].mute = true;
    const buffer = await window.__vishamp.renderBuffer("pattern"), data = buffer.getChannelData(0);
    window.__vishamp.mixerState.channels[0].mute = false;
    return Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
  });
  if (mutedRms >= audio.rms * 0.1) throw new Error(`Mute was not applied to export: ${mutedRms}`);
  const longClip = await page.evaluate(async () => {
    window.__vishamp.clipLen[0].drums = 64;
    window.__vishamp.allPats[0][0][40] = true;
    return (await window.__vishamp.renderBuffer("pattern")).duration;
  });
  if (longClip < 10) throw new Error(`Four-bar export was too short: ${longClip}`);
  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  console.log(`studio e2e passed: ${audio.duration.toFixed(2)}s, RMS ${audio.rms.toFixed(5)}`);
} finally {
  await browser?.close();
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  else server.kill("SIGTERM");
}

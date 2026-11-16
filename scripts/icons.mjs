// Renders assets/icon-src/*.svg (Fluent UI System Icons, MIT) to the PNG sizes
// Office ribbons use: assets/icons/<name>-16.png, -32.png, -80.png.
// Commands are blue, settings grey. Run when icons change:  node scripts/icons.mjs
import { createRequire } from "node:module";
import { mkdir, readFile, readdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const src = new URL("../assets/icon-src/", import.meta.url);
const out = new URL("../assets/icons/", import.meta.url);
const SETTINGS = new Set(["settings", "help", "more"]);
const COLORS = { command: "#0f5ec2", setting: "#5b6470" };

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const file of (await readdir(src)).filter((f) => f.endsWith(".svg"))) {
  const name = file.replace(/\.svg$/, "");
  const svg = (await readFile(new URL(file, src), "utf8")).replace(/fill="[^"]*"/g, "").replace("<svg", `<svg fill="${SETTINGS.has(name) ? COLORS.setting : COLORS.command}"`);
  for (const size of [16, 32, 80]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg", `<svg width="${size}" height="${size}"`)}</body></html>`);
    await page.locator("svg").screenshot({ path: new URL(`${name}-${size}.png`, out).pathname, omitBackground: true });
  }
  console.log(name);
}
await browser.close();

// Add-in icon (store listing, context menu).
{
  const browser2 = await chromium.launch();
  const p = await browser2.newPage();
  const svg = await readFile(new URL("../assets/logo/derkenar-mark.svg", import.meta.url), "utf8");
  for (const size of [16, 32, 64, 80, 128]) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg", `<svg width="${size}" height="${size}"`)}</body></html>`);
    await p.locator("svg").screenshot({ path: new URL(`../assets/icon-${size}.png`, import.meta.url).pathname, omitBackground: true });
  }
  // The logo in colour for the few ribbon places that stand for the add-in.
  for (const size of [16, 32, 80]) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg", `<svg width="${size}" height="${size}"`)}</body></html>`);
    await p.locator("svg").screenshot({ path: new URL(`../assets/icons/brand-${size}.png`, import.meta.url).pathname, omitBackground: true });
  }
  await browser2.close();
}

#!/usr/bin/env node
// Generates public/og-image.png: a 1200x630 social-share card composed from
// a real screenshot of the live app (orbited into a pretty framing) plus a
// text overlay, rendered by loading a small HTML template back into
// Playwright and screenshotting THAT — keeps all the compositing (gradient,
// type, glow) in real CSS instead of a canvas/sharp pipeline.

import { chromium } from "playwright";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SITE_URL = "https://satellite-sky.vercel.app/";
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
// Capture the background screenshot at a larger size than the final card so
// we can crop tight to the globe (avoids capturing at exactly 1200x630,
// which would leave UI panels visible at the edges).
const CAPTURE_VIEWPORT = { width: 1600, height: 900 };
const GPU_ARGS = [
  "--use-gl=angle",
  "--use-angle=metal",
  "--enable-gpu-rasterization",
  "--ignore-gpu-blocklist",
];

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

async function dragSegment(page, x, y, dx, dy, durationMs) {
  const steps = Math.max(6, Math.round(durationMs / 65));
  const perStepWait = durationMs / steps;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = easeInOutCubic(i / steps);
    await page.mouse.move(x + dx * t, y + dy * t);
    await page.waitForTimeout(perStepWait);
  }
  await page.mouse.up();
}

async function main() {
  const browser = await chromium.launch({ args: GPU_ARGS });
  const context = await browser.newContext({ viewport: CAPTURE_VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();

  console.log("Loading app...");
  await page.goto(SITE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // Hide all UI chrome (header, side panels, status/timeline bars) so the
  // capture is a clean, uncluttered view of just the 3D scene.
  await page.addStyleTag({
    content: `
      .title-bar, .ui-left, .ui-right, .status-bar, .ui-bottom,
      .mobile-menu-toggle, .hover-tooltip { display: none !important; }
    `,
  });

  // Orbit to a flattering three-quarter angle with the terminator (day/night
  // line) in frame.
  await dragSegment(page, 800, 450, -260, -60, 1400);
  await page.waitForTimeout(1500);

  console.log("Capturing background screenshot...");
  const shotBuffer = await page.screenshot({ type: "png" });
  const shotBase64 = shotBuffer.toString("base64");

  await context.close();

  // Render the compositing template.
  const templatePath = path.join(__dirname, "og-template.html");
  let html = await readFile(templatePath, "utf-8");
  html = html.replace("__BACKGROUND_BASE64__", shotBase64);

  const composePage = await browser.newPage({ viewport: { width: OG_WIDTH, height: OG_HEIGHT } });
  await composePage.setViewportSize({ width: OG_WIDTH, height: OG_HEIGHT });
  await composePage.setContent(html, { waitUntil: "networkidle" });
  await composePage.waitForTimeout(300);

  console.log("Rendering OG image...");
  const outPath = path.join(ROOT, "public", "og-image.png");
  await composePage.screenshot({ path: outPath });

  await browser.close();
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

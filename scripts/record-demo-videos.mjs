#!/usr/bin/env node
// Records short marketing demo clips of the live app for Twitter/X launch
// posts. Output goes to demo-videos/ (gitignored — never committed).
//
// Each clip's run(page) function calls markContentStart() once the initial
// page-load busywork is done and the "real" demo action is about to begin.
// The raw Playwright recording (which necessarily includes however long
// navigation/networkidle/settle actually took — highly variable, and
// dominated by CDP round-trip overhead during scripted mouse movement, not
// just network time) is then trimmed to start exactly there, with the
// final duration measured from real elapsed wall-clock time rather than a
// guessed constant — see recordClip(). Guessing a fixed trim point badly
// undershot in practice (CDP per-call overhead during dense mouse-move
// sequences inflated real time well past the naive `steps * intervalMs`
// estimate), which is what this measurement approach avoids.

import { chromium, devices } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const RAW_DIR = path.join(ROOT, "demo-videos", "raw");
const FINAL_DIR = path.join(ROOT, "demo-videos", "final");

const SITE_URL = "https://satellite-sky.vercel.app/";
const GPU_ARGS = [
  "--use-gl=angle",
  "--use-angle=metal",
  "--enable-gpu-rasterization",
  "--ignore-gpu-blocklist",
];

const DESKTOP_VIEWPORT = { width: 1920, height: 1080 };
// Every clip's drag choreography (including the empirically-calibrated Sun
// reveal and Moon framing) was tuned in pixel-space against a 1280x720
// viewport. OrbitControls' rotation amount is proportional to
// deltaPixels/elementHeight, so scaling every drag coordinate by the same
// height ratio reproduces IDENTICAL camera rotation at the new resolution
// — see dragSegment() — without re-tuning (or re-discovering the Sun's
// on-screen position) by hand.
const REFERENCE_HEIGHT = 720;
const DESKTOP_DRAG_SCALE = DESKTOP_VIEWPORT.height / REFERENCE_HEIGHT;

// NOT devices["iPhone 13"]'s 390x664 — Playwright's video capture runs at
// the CSS viewport's pixel size regardless of deviceScaleFactor (tried
// requesting a larger recordVideo.size to pick up the iPhone's real 3x
// density; it just pastes the still-390x664 frame into the corner of a
// bigger canvas and leaves the rest blank grey, since the underlying
// screencast never actually rendered more pixels). The only real way to
// get more actual pixels is a wider CSS viewport — this one stays under
// App.css's 760px mobile breakpoint (so the drawer/bottom-sheet UI still
// applies) while using its space far more fully than a literal phone size.
const MOBILE_VIEWPORT = { width: 700, height: 1244 };
const MOBILE_CONTEXT_OPTIONS = {
  viewport: MOBILE_VIEWPORT,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: devices["iPhone 13"].userAgent,
};

const MAX_CLIP_SECONDS = 19.5; // stay safely under Twitter/X's 20s-ish comfort zone

// ---- smooth-drag helpers -----------------------------------------------

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// A single eased drag gesture: pointerdown at (x,y), smoothly eased move to
// (x+dx, y+dy) over durationMs, pointerup. OrbitControls accumulates
// rotation from relative pointer deltas, so chaining several of these
// (see orbit()) continues rotating the camera rather than resetting it.
// All clip scripts below express (x,y,dx,dy) in 1280x720-reference pixels;
// DESKTOP_DRAG_SCALE converts to the actual (1920x1080) viewport here, in
// one place, so none of the calibrated numbers in the clip list need to
// change.
//
// ~15 steps/sec, each followed by an explicit wait — dense enough to read
// as a smooth pan, coarse enough that per-call CDP round-trip overhead
// (measured ~14ms/call; irreducible, not something a shorter wait avoids)
// doesn't dominate and silently compress the gesture into a fast whip. The
// real elapsed time will still overshoot durationMs somewhat because of
// that overhead — recordClip() measures actual wall-clock time rather than
// trusting this number, so the overshoot just costs a little extra
// recording time, not correctness.
async function dragSegment(page, x, y, dx, dy, durationMs) {
  x *= DESKTOP_DRAG_SCALE;
  y *= DESKTOP_DRAG_SCALE;
  dx *= DESKTOP_DRAG_SCALE;
  dy *= DESKTOP_DRAG_SCALE;
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

async function orbit(page, cx, cy, segments) {
  for (const seg of segments) {
    await dragSegment(page, cx, cy, seg.dx, seg.dy, seg.duration);
    await page.waitForTimeout(seg.pause ?? 150);
  }
}

async function typeSlowly(page, selector, text, delay = 85) {
  const el = page.locator(selector);
  await el.click();
  await el.type(text, { delay });
}

async function loadApp(page) {
  await page.goto(SITE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
}

// ---- recording plumbing -------------------------------------------------

async function recordClip(browser, { name, viewport, isMobile = false, run }) {
  console.log(`\n=== Recording: ${name} ===`);
  const contextOptions = isMobile
    ? { ...MOBILE_CONTEXT_OPTIONS, recordVideo: { dir: RAW_DIR, size: MOBILE_VIEWPORT } }
    : { viewport, recordVideo: { dir: RAW_DIR, size: viewport } };

  const t0 = Date.now();
  let contentStartSec = 0;
  const markContentStart = () => {
    contentStartSec = (Date.now() - t0) / 1000;
  };

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`  [pageerror] ${e.message}`));

  try {
    await run(page, markContentStart);
  } finally {
    await context.close();
  }
  const totalSec = (Date.now() - t0) / 1000;

  const video = await page.video().path();
  const dest = path.join(RAW_DIR, `${name}.webm`);
  await rename(video, dest);

  const duration = Math.min(MAX_CLIP_SECONDS, Math.max(1, totalSec - contentStartSec - 0.3));
  console.log(
    `  raw total=${totalSec.toFixed(1)}s contentStart=${contentStartSec.toFixed(1)}s -> trim [${contentStartSec.toFixed(1)}s, +${duration.toFixed(1)}s]`,
  );
  return { rawPath: dest, trimStart: contentStartSec, duration };
}

async function trimAndConvert(rawPath, name, { trimStart, duration }) {
  const outPath = path.join(FINAL_DIR, `${name}.mp4`);
  const args = [
    "-y",
    "-ss",
    String(trimStart),
    "-i",
    rawPath,
    "-t",
    String(duration),
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    "-an",
    outPath,
  ];
  await execFileAsync("ffmpeg", args);
  console.log(`  saved -> ${outPath}`);
  return outPath;
}

// ---- clip scripts ---------------------------------------------------------

const clips = [
  {
    name: "01-overview",
    viewport: DESKTOP_VIEWPORT,
    async run(page, markContentStart) {
      await loadApp(page);
      markContentStart();
      await orbit(page, 760, 400, [
        { dx: -180, dy: 30, duration: 2600 },
        { dx: -160, dy: -20, duration: 2400 },
        { dx: 140, dy: 40, duration: 2600 },
        { dx: 120, dy: -30, duration: 2400 },
        { dx: -90, dy: 0, duration: 2000 },
      ]);
      await page.waitForTimeout(600);
    },
  },

  {
    name: "02-search-and-select",
    viewport: DESKTOP_VIEWPORT,
    async run(page, markContentStart) {
      await loadApp(page);
      markContentStart();
      await typeSlowly(page, ".search-input", "ZARYA");
      await page.waitForTimeout(700);
      await page.locator(".search-results li").first().click();
      // CameraRig's fly-to tween runs ~1.2s.
      await page.waitForTimeout(2200);
      await orbit(page, 760, 400, [
        { dx: -120, dy: 20, duration: 2600 },
        { dx: 120, dy: -20, duration: 2600 },
      ]);
      await page.waitForTimeout(2500);
    },
  },

  {
    name: "03-time-playback",
    viewport: DESKTOP_VIEWPORT,
    async run(page, markContentStart) {
      await loadApp(page);
      markContentStart();
      await page.locator(".playback-btn").click();
      await page.waitForTimeout(2200);
      await page.locator(".speed-presets button", { hasText: "5m/s" }).click();
      await page.waitForTimeout(2600);
      await page.locator(".speed-presets button", { hasText: "30m/s" }).click();
      await orbit(page, 760, 400, [
        { dx: -110, dy: 10, duration: 2400 },
        { dx: 110, dy: -10, duration: 2400 },
      ]);
      await page.waitForTimeout(3500);
    },
  },

  {
    name: "04-category-highlight",
    viewport: DESKTOP_VIEWPORT,
    async run(page, markContentStart) {
      await loadApp(page);
      markContentStart();
      await page.locator(".category-chip", { hasText: "Starlink" }).click();
      await page.waitForTimeout(600);
      await orbit(page, 760, 400, [
        { dx: -150, dy: 20, duration: 2800 },
        { dx: 150, dy: -20, duration: 2800 },
      ]);
      await page.waitForTimeout(400);
      await page.locator(".category-chip", { hasText: "ISS / Stations" }).click();
      await page.waitForTimeout(2000);
    },
  },

  {
    name: "05-location-and-passes",
    viewport: DESKTOP_VIEWPORT,
    async run(page, markContentStart) {
      await loadApp(page);
      markContentStart();
      // Rio de Janeiro — visible in the default camera framing without any
      // orbit, and (checked against the live pass predictor shortly before
      // recording) has several real upcoming visible ISS passes right now,
      // including a 75°-elevation one, rather than a "no passes" empty state.
      await page.locator('input[placeholder="Latitude"]').fill("-22.9068");
      await page.locator('input[placeholder="Longitude"]').fill("-43.1729");
      await page.locator('button[type="submit"]', { hasText: "Set" }).click();
      await page.waitForTimeout(1800);
      await typeSlowly(page, ".search-input", "ZARYA");
      await page.waitForTimeout(600);
      await page.locator(".search-results li").first().click();
      await page.waitForTimeout(2000);
      await page.locator(".pass-list").scrollIntoViewIfNeeded();
      await page.waitForTimeout(3500);
    },
  },

  {
    name: "06-moon",
    viewport: DESKTOP_VIEWPORT,
    async run(page, markContentStart) {
      await loadApp(page);
      markContentStart();
      await typeSlowly(page, ".search-input", "Moon");
      await page.waitForTimeout(600);
      await page.locator(".search-results li").first().click();
      await page.waitForTimeout(2200);
      await orbit(page, 760, 400, [
        { dx: -140, dy: 15, duration: 2800 },
        { dx: 140, dy: -15, duration: 2800 },
      ]);
      await page.waitForTimeout(2500);
    },
  },

  {
    name: "07-sun",
    viewport: DESKTOP_VIEWPORT,
    async run(page, markContentStart) {
      await loadApp(page);
      markContentStart();
      // A slow, continuous orbit whose net rotation brings the real Sun
      // (positioned at its true current ecliptic direction — see
      // src/lib/sun.ts) into frame. This exact net delta (-1760, -240 px
      // at this viewport/anchor) was calibrated empirically shortly before
      // recording — the Sun's real position barely drifts hour to hour, so
      // it holds, but re-check with a quick screenshot probe if this ever
      // stops landing the Sun in frame.
      await orbit(page, 760, 400, [
        { dx: -300, dy: -40, duration: 1400 },
        { dx: -300, dy: -40, duration: 1400 },
        { dx: -300, dy: -40, duration: 1400 },
        { dx: -300, dy: -40, duration: 1400 },
        { dx: -300, dy: -40, duration: 1400 },
        { dx: -260, dy: -40, duration: 1200 },
      ]);
      // Hold on the reveal — this is the payoff shot, worth lingering on.
      await page.waitForTimeout(6000);
    },
  },

  {
    name: "08-mobile",
    isMobile: true,
    async run(page, markContentStart) {
      await loadApp(page);
      markContentStart();
      await page.locator(".mobile-menu-toggle").click();
      await page.waitForTimeout(900);
      await typeSlowly(page, ".search-input", "ZARYA");
      await page.waitForTimeout(700);
      await page.locator(".search-results li").first().click();
      await page.waitForTimeout(2200);
      await page.locator(".pass-list").scrollIntoViewIfNeeded();
      await page.waitForTimeout(2600);
    },
  },
];

async function main() {
  const requested = process.argv.slice(2);
  const toRun = requested.length ? clips.filter((c) => requested.includes(c.name)) : clips;
  if (toRun.length === 0) {
    console.error("No matching clips for:", requested);
    process.exit(1);
  }

  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(FINAL_DIR, { recursive: true });

  const browser = await chromium.launch({ args: GPU_ARGS });
  try {
    for (const clip of toRun) {
      const { rawPath, trimStart, duration } = await recordClip(browser, clip);
      await trimAndConvert(rawPath, clip.name, { trimStart, duration });
    }
  } finally {
    await browser.close();
  }

  console.log("\nAll done. Final MP4s are in demo-videos/final/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

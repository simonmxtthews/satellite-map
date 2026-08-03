#!/usr/bin/env node
// Records short marketing demo clips of the live app for Twitter/X launch
// posts. Output goes to demo-videos/ (gitignored — never committed).
//
// This does NOT use Playwright's built-in context.recordVideo. That API
// captures frames via Chromium's CDP screencast (Page.startScreencast) —
// built for lightweight devtools thumbnail streaming, not recording, and it
// visibly JPEG-compresses/softens every frame before Playwright's own
// ffmpeg step ever runs. Diff-testing a screencast video frame against a
// direct page.screenshot() of the exact same instant (same 1920x1080
// resolution) showed clearly visible extra blur and color fringing in the
// screencast version — no amount of high-quality re-encoding downstream
// fixes that, since the detail is already gone before it reaches ffmpeg.
//
// Instead: capture a sequence of full-fidelity JPEG screenshots directly
// (quality 95 — fast enough for ~28-30fps, see dragSegment's sibling
// capture loop below) while the clip's choreography runs, each stamped
// with its real capture time, then assemble them into an MP4 via ffmpeg's
// concat demuxer using those real per-frame durations. That last part
// matters: capture timing isn't perfectly uniform (CDP round-trip jitter),
// and encoding "each frame lasted its ACTUAL measured duration" is what
// keeps playback speed correct despite that jitter, rather than assuming a
// fixed rate and letting timing drift accumulate over the clip.

import { chromium, devices } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const FRAMES_DIR = path.join(ROOT, "demo-videos", "frames");
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

// A wider-than-literal-phone viewport (still under App.css's 760px mobile
// breakpoint, so the drawer/bottom-sheet UI still applies) — chosen after
// an earlier attempt to request a larger recordVideo.size on the real
// iPhone-13 dimensions just padded the frame with blank grey instead of
// adding real pixels, since recordVideo never rendered more than the CSS
// viewport in the first place. Moot now that recordVideo is gone entirely,
// but the wider viewport is still worth keeping for a less cramped shot.
const MOBILE_VIEWPORT = { width: 700, height: 1244 };
const MOBILE_CONTEXT_OPTIONS = {
  viewport: MOBILE_VIEWPORT,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: devices["iPhone 13"].userAgent,
};

const MAX_CLIP_SECONDS = 19.5; // stay safely under Twitter/X's 20s-ish comfort zone
const CAPTURE_JPEG_QUALITY = 95;

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
// doesn't dominate and silently compress the gesture into a fast whip. The
// independent frame-capture loop (see startCapture) samples whatever's on
// screen throughout this in real time, so it doesn't need to know or care
// about this function's internal step count.
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

// ---- frame-capture plumbing ---------------------------------------------

// Runs a tight screenshot loop until stopped, recording each frame's real
// elapsed time (not an assumed fixed interval) so assembleVideo() can
// reproduce correct real-time pacing regardless of capture jitter.
function makeCapturer(page, frameDir) {
  let capturing = false;
  let frameIdx = 0;
  const timestampsMs = [];
  let loopPromise = null;
  let t0 = 0;

  function start() {
    t0 = Date.now();
    capturing = true;
    loopPromise = (async () => {
      while (capturing) {
        const buf = await page.screenshot({ type: "jpeg", quality: CAPTURE_JPEG_QUALITY });
        const t = Date.now() - t0;
        const file = path.join(frameDir, `f_${String(frameIdx).padStart(6, "0")}.jpg`);
        await writeFile(file, buf);
        timestampsMs.push(t);
        frameIdx++;
        if (t / 1000 > MAX_CLIP_SECONDS + 2) capturing = false; // safety valve
      }
    })();
  }

  async function stop() {
    capturing = false;
    await loopPromise;
    return timestampsMs;
  }

  return { start, stop };
}

// Builds an ffmpeg concat-demuxer input list with each frame's REAL
// measured duration (not a fixed 1/fps), then encodes to H.264 MP4,
// resampling to a clean 30fps CFR for final delivery. Frames beyond
// MAX_CLIP_SECONDS are dropped rather than included and then cut, since we
// control capture directly and don't need to "trim" anything after the
// fact the way the old recordVideo-based pipeline did.
async function assembleVideo(frameDir, timestampsMs, name) {
  const cutoffMs = MAX_CLIP_SECONDS * 1000;
  const kept = timestampsMs.filter((t) => t <= cutoffMs);
  if (kept.length < 2) throw new Error(`${name}: not enough frames captured (${kept.length})`);

  const listPath = path.join(frameDir, "concat.txt");
  const lines = [];
  for (let i = 0; i < kept.length; i++) {
    const file = `f_${String(i).padStart(6, "0")}.jpg`;
    lines.push(`file '${file}'`);
    const durationSec =
      i < kept.length - 1 ? (kept[i + 1] - kept[i]) / 1000 : (kept[i] - kept[i - 1]) / 1000;
    lines.push(`duration ${durationSec.toFixed(4)}`);
  }
  // ffmpeg's concat demuxer ignores the last "duration" line unless the
  // final file is also repeated without one — standard documented quirk.
  lines.push(`file 'f_${String(kept.length - 1).padStart(6, "0")}.jpg'`);
  await writeFile(listPath, lines.join("\n"));

  const outPath = path.join(FINAL_DIR, `${name}.mp4`);
  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "slow",
    "-crf",
    "16",
    "-movflags",
    "+faststart",
    "-an",
    outPath,
  ];
  await execFileAsync("ffmpeg", args);
  const totalSec = kept[kept.length - 1] / 1000;
  console.log(`  ${kept.length} frames, ${totalSec.toFixed(1)}s -> ${outPath}`);
  return outPath;
}

// ---- recording plumbing -------------------------------------------------

async function recordClip(browser, { name, viewport, isMobile = false, run }) {
  console.log(`\n=== Recording: ${name} ===`);
  const contextOptions = isMobile ? MOBILE_CONTEXT_OPTIONS : { viewport };

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`  [pageerror] ${e.message}`));

  const frameDir = path.join(FRAMES_DIR, name);
  await rm(frameDir, { recursive: true, force: true });
  await mkdir(frameDir, { recursive: true });
  const capturer = makeCapturer(page, frameDir);

  try {
    await run(page, capturer.start);
  } finally {
    const timestampsMs = await capturer.stop();
    await context.close();
    await assembleVideo(frameDir, timestampsMs, name);
    await rm(frameDir, { recursive: true, force: true });
  }
}

// ---- clip scripts ---------------------------------------------------------

const clips = [
  {
    name: "01-overview",
    viewport: DESKTOP_VIEWPORT,
    async run(page, startCapture) {
      await loadApp(page);
      startCapture();
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
    async run(page, startCapture) {
      await loadApp(page);
      startCapture();
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
    async run(page, startCapture) {
      await loadApp(page);
      startCapture();
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
    async run(page, startCapture) {
      await loadApp(page);
      startCapture();
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
    async run(page, startCapture) {
      await loadApp(page);
      startCapture();
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
    async run(page, startCapture) {
      await loadApp(page);
      startCapture();
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
    async run(page, startCapture) {
      await loadApp(page);
      startCapture();
      // A slow, continuous orbit whose net rotation brings the real Sun
      // (positioned at its true current ecliptic direction — see
      // src/lib/sun.ts) into frame. This exact net delta (-1760, -240 px
      // at the 1280x720 reference) was calibrated empirically shortly
      // before recording — the Sun's real position barely drifts hour to
      // hour, so it holds, but re-check with a quick screenshot probe if
      // this ever stops landing the Sun in frame.
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
    async run(page, startCapture) {
      await loadApp(page);
      startCapture();
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

  await mkdir(FRAMES_DIR, { recursive: true });
  await mkdir(FINAL_DIR, { recursive: true });

  const browser = await chromium.launch({ args: GPU_ARGS });
  try {
    for (const clip of toRun) {
      await recordClip(browser, clip);
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

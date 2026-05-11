// Drives the live app via testHook to produce four submission-ready screenshots.
// Run with: node scripts/capture-shots.mjs   (dev server must be on :5173)

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const TARGET = process.env.TARGET || 'http://127.0.0.1:5173/';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const VIEWPORT = { width: 1600, height: 1000 };

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2, // 2x for crisp screenshots on the application form
});
const page = await ctx.newPage();
await page.goto(TARGET);
await page.waitForFunction(() => !!window.__app__ && !!window.__app__.testHook);
// Let fonts settle so the sidebar looks clean
await page.waitForFunction(() => document.fonts.check('700 16px "Pixelify Sans"'));
await page.waitForTimeout(400);

// ──────────────────────────────────────────────────────────────────────────
// Shot 1 — Full canvas with a 3D drawing in progress + sidebar
// A clean wireframe cube laid down via testHook so the canvas reads as
// "intentional 3D geometry, snapping engaged."
// ──────────────────────────────────────────────────────────────────────────
await page.evaluate(() => {
  const t = window.__app__.testHook;
  const ink = '#1A1814';
  const orange = '#FF5A1F';
  const blue = '#3D5AFF';

  // Base square (front face)
  t.addStroke(ink, [
    { x: -0.75, y: -0.25, z: 0 },
    { x:  0.75, y: -0.25, z: 0 },
    { x:  0.75, y:  1.0,  z: 0 },
    { x: -0.75, y:  1.0,  z: 0 },
    { x: -0.75, y: -0.25, z: 0 },
  ]);
  // Back square offset in +Z so 3D mode shows depth after orbit
  t.addStroke(ink, [
    { x: -0.5, y: 0,    z: -1.0 },
    { x:  1.0, y: 0,    z: -1.0 },
    { x:  1.0, y: 1.25, z: -1.0 },
    { x: -0.5, y: 1.25, z: -1.0 },
    { x: -0.5, y: 0,    z: -1.0 },
  ]);
  // Connecting edges
  t.addStroke(ink, [{ x: -0.75, y: -0.25, z: 0 }, { x: -0.5, y: 0,    z: -1.0 }]);
  t.addStroke(ink, [{ x:  0.75, y: -0.25, z: 0 }, { x:  1.0, y: 0,    z: -1.0 }]);
  t.addStroke(ink, [{ x:  0.75, y:  1.0,  z: 0 }, { x:  1.0, y: 1.25, z: -1.0 }]);
  t.addStroke(ink, [{ x: -0.75, y:  1.0,  z: 0 }, { x: -0.5, y: 1.25, z: -1.0 }]);
  // A loose orange accent line for character
  t.addStroke(orange, [
    { x: -0.25, y: 0.4, z: -0.5 },
    { x:  0.45, y: 0.7, z: -0.5 },
  ]);
  // A blue mid-air vertical
  t.addStroke(blue, [
    { x: 0.0, y: 0.0, z: -0.5 },
    { x: 0.0, y: 1.1, z: -0.5 },
  ]);

  // Tilt the view slightly so it reads as 3D
  const s = window.__app__.scene;
  s.cameraPersp.position.set(1.4, 1.6, 3.5);
  s.cameraPersp.lookAt(s.controls.target);
  s.controls.update();
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/01-canvas-3d-wireframe.png`, fullPage: false });
console.log('✓ 01-canvas-3d-wireframe.png');

// ──────────────────────────────────────────────────────────────────────────
// Shot 2 — Smart cursor in SNAP state (sparkle + named snap tag)
// Pull the cursor + label into screen centre so the crop is clean.
// ──────────────────────────────────────────────────────────────────────────
await page.evaluate(() => {
  const app = window.__app__;
  // Move the camera back so the world point near the cube vertex projects centrally
  app.scene.cameraPersp.position.set(0, 0.8, 3);
  app.scene.cameraPersp.lookAt(0, 0.6, 0);
  app.scene.controls.update();
  // Park the cursor at the front-top-right corner of the cube + fire snap
  const p = { x: 0.75, y: 1.0, z: 0 };
  app.fusion.setPositionDirect(p.x, p.y, p.z);
  app.cursor.setState('snap', { hit: { kind: 'vertex', point: p, label: 'vertex.07', type: 'vertex' } });
});
await page.waitForTimeout(450);
// Crop to a 720×520 region around the cursor — DOM label is to the right of the tip
await page.screenshot({
  path: `${OUT}/02-cursor-snap-sparkle.png`,
  clip: { x: 540, y: 200, width: 720, height: 520 },
});
console.log('✓ 02-cursor-snap-sparkle.png');

// ──────────────────────────────────────────────────────────────────────────
// Shot 3 — Camera preview panel with overlaid hand landmarks
// We can't grant a real webcam in headless, so we draw the panel manually
// using the public CameraPreview API + a synthetic landmark set.
// ──────────────────────────────────────────────────────────────────────────
await page.evaluate(() => {
  const cam = window.__app__.testHook.camPreview;
  const panel = document.querySelector('[data-role="cam-preview"]');
  if (panel) panel.hidden = false;
  cam.setMode('hands');
  // 21 MediaPipe Hands landmarks — a plausible open palm in normalized image coords
  const lm = [
    { x: 0.40, y: 0.78, z: 0 },   // 0 wrist
    { x: 0.32, y: 0.70, z: 0 },   // 1 thumb_cmc
    { x: 0.28, y: 0.60, z: 0 },   // 2 thumb_mcp
    { x: 0.26, y: 0.52, z: 0 },   // 3 thumb_ip
    { x: 0.24, y: 0.44, z: 0 },   // 4 thumb_tip
    { x: 0.40, y: 0.50, z: 0 },   // 5 index_mcp (wand-anchor → orange)
    { x: 0.42, y: 0.36, z: 0 },   // 6 index_pip
    { x: 0.43, y: 0.26, z: 0 },   // 7 index_dip
    { x: 0.44, y: 0.18, z: 0 },   // 8 index_tip
    { x: 0.48, y: 0.50, z: 0 },   // 9 middle_mcp
    { x: 0.52, y: 0.36, z: 0 },   // 10
    { x: 0.55, y: 0.26, z: 0 },   // 11
    { x: 0.58, y: 0.18, z: 0 },   // 12 middle_tip
    { x: 0.55, y: 0.52, z: 0 },   // 13 ring_mcp
    { x: 0.60, y: 0.42, z: 0 },   // 14
    { x: 0.64, y: 0.36, z: 0 },   // 15
    { x: 0.68, y: 0.30, z: 0 },   // 16 ring_tip
    { x: 0.62, y: 0.58, z: 0 },   // 17 pinky_mcp
    { x: 0.66, y: 0.52, z: 0 },   // 18
    { x: 0.70, y: 0.48, z: 0 },   // 19
    { x: 0.74, y: 0.44, z: 0 },   // 20 pinky_tip
  ];
  // The rAF loop is gated on attached=true (real stream) — bypass it by
  // calling drawFrame directly with the flat 21-point list.
  cam.drawFrame(lm, { mode: 'hands' });
});
await page.waitForTimeout(400);
// Camera preview is pinned to the bottom-left of the canvas region.
// Compute its real on-screen rect so the crop is bulletproof.
const camRect = await page.evaluate(() => {
  const r = document.querySelector('[data-role="cam-preview"]').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const pad = 18;
await page.screenshot({
  path: `${OUT}/03-camera-preview-landmarks.png`,
  clip: {
    x: Math.max(0, camRect.x - pad),
    y: Math.max(0, camRect.y - pad),
    width: camRect.w + pad * 2,
    height: camRect.h + pad * 2,
  },
});
console.log('✓ 03-camera-preview-landmarks.png');

// ──────────────────────────────────────────────────────────────────────────
// Shot 4 — Finished sketch, orbited so 3D depth reads
// A closed polygon (house silhouette) plus an orbit angle that emphasizes depth.
// ──────────────────────────────────────────────────────────────────────────
await page.evaluate(() => {
  const t = window.__app__.testHook;
  // Wipe the cube; add a clean isometric scene
  window.__app__.strokes.clear();
  const ink = '#1A1814';
  const orange = '#FF5A1F';
  const butter = '#FFD66B';
  const pink = '#FF8FA8';
  // A closed house silhouette
  t.addStroke(ink, [
    { x: -0.75, y: -0.25, z: 0 },
    { x:  0.75, y: -0.25, z: 0 },
    { x:  0.75, y:  0.75, z: 0 },
    { x:  0.0,  y:  1.25, z: 0 },
    { x: -0.75, y:  0.75, z: 0 },
    { x: -0.75, y: -0.25, z: 0 },
  ]);
  // Door
  t.addStroke(ink, [
    { x: -0.25, y: -0.25, z: 0 },
    { x: -0.25, y:  0.25, z: 0 },
    { x:  0.25, y:  0.25, z: 0 },
    { x:  0.25, y: -0.25, z: 0 },
  ]);
  // 3D extrusion of the front edge
  t.addStroke(ink, [
    { x: -0.75, y: -0.25, z: 0 },
    { x: -0.5,  y: -0.05, z: -1.0 },
  ]);
  t.addStroke(ink, [
    { x:  0.75, y: -0.25, z: 0 },
    { x:  1.0,  y: -0.05, z: -1.0 },
  ]);
  t.addStroke(ink, [
    { x:  0.0,  y:  1.25, z: 0 },
    { x:  0.25, y:  1.45, z: -1.0 },
  ]);
  // Back silhouette echo
  t.addStroke(ink, [
    { x: -0.5,  y: -0.05, z: -1.0 },
    { x:  1.0,  y: -0.05, z: -1.0 },
    { x:  1.0,  y:  0.95, z: -1.0 },
    { x:  0.25, y:  1.45, z: -1.0 },
    { x: -0.5,  y:  0.95, z: -1.0 },
    { x: -0.5,  y: -0.05, z: -1.0 },
  ]);
  // Accent strokes for colour
  t.addStroke(orange, [{ x: -0.6, y: 0.9, z: 0 }, { x: -0.05, y: 1.18, z: 0 }]);
  t.addStroke(butter, [{ x: 0.05, y: 1.18, z: 0 }, { x: 0.6, y: 0.9, z: 0 }]);
  t.addStroke(pink, [{ x: 0.25, y: -0.05, z: 0.02 }, { x: 0.25, y: 0.15, z: 0.02 }]);

  // Strong 3D orbit angle
  const s = window.__app__.scene;
  s.cameraPersp.position.set(2.6, 1.8, 3.0);
  s.cameraPersp.lookAt(0, 0.5, -0.5);
  s.controls.target.set(0, 0.5, -0.5);
  s.controls.update();

  // Reset cursor state so no leftover snap sparkle
  window.__app__.cursor.setState('idle');
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/04-finished-sketch-orbited.png`, fullPage: false });
console.log('✓ 04-finished-sketch-orbited.png');

await browser.close();
console.log('\nAll screenshots written to ./screenshots/');

# Sketchpad'63

Joy-Con + camera fused 6DOF wand for 3D drawing in the browser. Direction D ("Drawer cabinet + smart cursor") of the Sketchpad'63 wireframes, built as a real, working web app.

The pitch: pure gyro drifts, pure webcam pose is jittery and slow. Fuse Joy-Con IMU (~60 Hz orientation) with MediaPipe Hand/Pose (~30 Hz absolute position) so it feels like Tilt Brush in the browser.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run build
npm run preview
npm run test         # Playwright smoke spec
```

## Deploy (Vercel)

The repo is Vercel-ready: `vercel.json` sets `framework: vite`, `buildCommand: npm run build`, `outputDirectory: dist`. Long-cache headers are wired up for the self-hosted woff2 fonts and a `Permissions-Policy` header allows camera + WebHID on the deployed origin.

First-time setup (one-time, from this directory):

```bash
npx vercel login        # opens an OAuth URL — log in once
npx vercel link         # pick a scope + project name (or link to an existing one)
```

Each deploy:

```bash
npx vercel --prod       # production deploy → vercel-issued URL
# or just
npx vercel              # preview deploy with a unique URL
```

You can also push the repo to GitHub and connect it once via the Vercel dashboard — every push to `main` then auto-deploys, every PR gets a preview URL.

> Note: the Vercel CLI's `login` step is interactive (device-code OAuth) so it can't be scripted. Run it from your own terminal.

## Browser

Use **Chrome 89+** or **Edge 89+**. WebHID requires a Chromium-based browser served from `localhost` or HTTPS.

Firefox / Safari will load the app and the mouse-drag fallback works, but Joy-Con pairing will not.

## Mouse-drag fallback

You can use Sketchpad'63 with no hardware at all. Click and drag inside the canvas to lay a stroke. Hover to move the cursor. This path is what the Playwright suite verifies.

## Joy-Con pairing

1. On a Mac, pair the Joy-Con over Bluetooth first (System Settings -> Bluetooth, hold the small button between SL and SR until the side lights flash).
2. In the right drawer, click **Connect Joy-Con**. Chrome's WebHID picker shows the controller — pick it and confirm.
3. Click **recenter** (or press the right stick) to capture the current pose as world origin.
4. Tilting the Joy-Con rotates the cursor in 3D. If a webcam is also active, the camera anchors absolute position while the IMU handles instant orientation feedback.

## Camera

In the right drawer, click **Start camera**. Choose between **Hands** (uses index_finger_mcp) and **Pose** (uses right_wrist) from the same drawer. MediaPipe model files load from Google's CDN at first use.

## Button map (right Joy-Con)

| Button       | Action                |
|--------------|-----------------------|
| ZR           | Draw (hold)           |
| Right stick click | Recenter         |
| A            | Undo last stroke      |
| B            | Cycle ink             |
| R            | Cycle tool            |
| Plus         | Toggle drawers        |
| Home         | Reset camera          |

## Architecture

```
Joy-Con WebHID  --60Hz-->  Madgwick AHRS  -->  orientation quaternion -+
                                                                       +-> Wand pose --> render + sampler
MediaPipe (Hands|Pose) --30Hz-->  OneEuro filter --> position xyz -----+
```

- `src/fusion/Madgwick.js` — gyro+accel quaternion AHRS
- `src/fusion/OneEuro.js` — adaptive-cutoff low-pass for position
- `src/fusion/Fusion.js` — owns the wand pose + recenter
- `src/input/JoyCon.js` — WebHID via Tomayac's joy-con-webhid
- `src/input/Pose.js` — MediaPipe HandLandmarker / PoseLandmarker
- `src/scene/*.js` — Three.js scene, stroke renderer, snap detector
- `src/ui/*.js` — drawers, smart-cursor states, coord HUD, mascot

## Caveats

- **Headless WebHID:** `navigator.hid` does not exist in headless Chromium, so Playwright cannot exercise the real Joy-Con path. Click handlers are verified; pairing is a manual step.
- **Camera permission:** the Playwright suite does not grant camera access. The mouse-drag fallback covers stroke creation.
- **Snap:** vertex / grid snap are real; edge / parallel detection is stubbed in the current build.
- **Smoothing:** Madgwick `beta` (0.08) and OneEuro `minCutoff` (1.0) / `beta` (0.02) are tuned for desk-Joy-Con. Adjust in `src/fusion/Fusion.js` if motion feels mushy or jittery.

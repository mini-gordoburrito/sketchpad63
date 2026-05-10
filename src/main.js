// Sketchpad'63 boot — wires Scene + Fusion + JoyCon + Pose + Sidebar UI into one app.
// Hardware is opt-in (user gesture). Mouse-drag fallback always works.

import * as THREE from 'three';
import { Scene } from './scene/Scene.js';
import { StrokeRenderer } from './scene/StrokeRenderer.js';
import { Snap } from './scene/Snap.js';
import { Preview } from './scene/Preview.js';
import { Fusion } from './fusion/Fusion.js';
import { JoyCon } from './input/JoyCon.js';
import { Pose } from './input/Pose.js';
import { Keyboard } from './input/Keyboard.js';
import { Cursor, CURSOR_STATES } from './ui/Cursor.js';
import { Sidebar } from './ui/Sidebar.js';
import { Coord } from './ui/Coord.js';
import { CameraPreview, createMockMediaStream } from './ui/CameraPreview.js';

// ── DOM refs ──
const canvasEl = document.getElementById('three-canvas');
const stageEl = document.getElementById('stage');
const labelEl = document.getElementById('cursor-label');
const coordEl = document.getElementById('coord-hud');
const snapChipEl = document.getElementById('snap-chip');
const camPanelEl = document.querySelector('[data-role="cam-preview"]');
const camCanvasEl = document.querySelector('[data-role="cam-preview-canvas"]');
const camVideoEl = document.querySelector('[data-role="cam-preview-video"]');
const camLabelEl = document.querySelector('[data-role="cam-preview-label"]');
const camFpsEl = document.querySelector('[data-role="cam-preview-fps"]');
const cameraBtn = document.getElementById('btn-camera');

// ── Core systems ──
const scene = new Scene(canvasEl);
const fusion = new Fusion();
const strokes = new StrokeRenderer(scene.strokeRoot);
const snap = new Snap(strokes);
const preview = new Preview(scene.cursorRoot);
const cursor = new Cursor(scene, stageEl, labelEl);
const coord = new Coord(coordEl);
const sidebar = new Sidebar(stageEl);

const joycon = new JoyCon(fusion);
const pose = new Pose(fusion);
const keyboard = new Keyboard();
const camPreview = new CameraPreview({
  panel: camPanelEl,
  canvas: camCanvasEl,
  video: camVideoEl,
  label: camLabelEl,
  fps: camFpsEl,
});

// Test-mode override for getUserMedia. When set, pose.start() will use the
// supplied MediaStream instead of asking the browser for the real camera.
let __mockCameraStream = null;

// ── App state ──
const ERASE_RADIUS_WORLD = 0.3;     // world units
const POLYGON_CLOSE_RADIUS = 0.5;   // world units
const DOUBLE_CLICK_MS = 350;

const state = {
  activeInk: '#1A1814',
  activeTool: 'pencil',
  drawing: false,                  // pencil drag-draw
  mode: '3d',
  strokeStart: null,

  // Line tool sub-state
  line: { anchor: null },          // null = idle, {x,y,z} = anchored

  // Polygon tool sub-state
  polygon: { vertices: [], active: false },

  // Eraser tool drag state
  eraser: { pressed: false },

  // Shift held? Used by pencil to constrain the stroke to a straight line
  // from its start point to the current cursor.
  shiftHeld: false,
  // Last-tick timestamp for keyboard movement integration
  lastFrameTs: 0,

  // Last-resolved cursor world point (post-snap if applicable). The frame loop
  // uses this for previewing line/polygon edges.
  cursorWorld: new THREE.Vector3(),

  // Last click timestamp for double-click detection (polygon close)
  lastClickAt: 0,
};

cursor.setEraseRadius(ERASE_RADIUS_WORLD);

// ── UI events ──
sidebar.addEventListener('mode', (e) => {
  state.mode = e.detail.mode;
  scene.setMode(e.detail.mode);
  strokes.setFlatten2D(e.detail.mode === '2d');
});
sidebar.addEventListener('tool', (e) => {
  setTool(e.detail.tool);
});
sidebar.addEventListener('ink', (e) => {
  state.activeInk = e.detail.ink;
  cursor.setActiveInk(e.detail.ink);
});
sidebar.addEventListener('snap', (e) => {
  snap.setEnabled(e.detail.kind, e.detail.on);
});
sidebar.addEventListener('tracker', async (e) => {
  try { await pose.setMode(e.detail.mode); } catch (err) { console.warn(err); }
  camPreview.setMode(e.detail.mode);
});
sidebar.addEventListener('camera-start', async () => {
  if (pose.isRunning()) {
    pose.stop();
    camPreview.detach();
    setCameraButtonState(false);
    return;
  }
  try {
    const opts = __mockCameraStream
      ? { mockStream: __mockCameraStream, skipInference: true }
      : {};
    await pose.start(opts);
    camPreview.setMode(pose.mode);
    if (pose.getStream()) camPreview.attach(pose.getStream());
    setCameraButtonState(true);
  } catch (err) {
    console.error('[camera] start failed', err);
    setCameraButtonState(false);
  }
});
sidebar.addEventListener('joycon-connect', async () => {
  try { await joycon.connect(); } catch (err) { console.error('[joycon] connect failed', err); }
});
sidebar.addEventListener('sensitivity', (e) => {
  pose.setSensitivity(e.detail.sensitivity);
});
sidebar.addEventListener('scope', (e) => {
  scene.setMappingScope(pose.getMappingBounds(), e.detail.visible);
});
sidebar.addEventListener('grid-size', (e) => {
  const g = e.detail.gridSize;
  snap.setGridSize(g);
  scene.dotGrid.setGridSize(g);
});

sidebar.addEventListener('recenter', () => {
  fusion.recenter();
});

// ── Camera state helpers ──
function setCameraButtonState(running) {
  if (!cameraBtn) return;
  cameraBtn.textContent = running ? 'Stop camera' : 'Start camera';
  cameraBtn.setAttribute('aria-pressed', String(running));
  cameraBtn.dataset.running = running ? 'true' : 'false';
}
setCameraButtonState(false);

// Forward pose frames into the preview so it overlays landmarks.
pose.addEventListener('pose-frame', (e) => {
  camPreview.setFrame(e.detail);
});

// ── Joy-Con button events ──
joycon.addEventListener('button', (e) => {
  const { name, pressed } = e.detail;
  if (name === 'zr') {
    if (pressed) startStroke();
    else endStroke();
  }
  if (name === 'a' && pressed) strokes.undo();
  if (name === 'b' && pressed) cycleInk(1);
  if (name === 'r' && pressed) cycleTool(1);
  if (name === 'rightStick' && pressed) fusion.recenter();
});

// ── Keyboard input (left-hand QWERTY) ──
// Track Shift independently of the Keyboard module (which uses Shift as a
// movement-speed boost) — pencil drawing reads `state.shiftHeld` to lock the
// stroke to a straight line.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') state.shiftHeld = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') state.shiftHeld = false;
});
window.addEventListener('blur', () => { state.shiftHeld = false; });

// Keyboard mode is just "no Joy-Con connected" — when the wand isn't paired,
// keyboard is the primary input and shortcut hints are visible. As soon as a
// Joy-Con connects, the hints fade out.
function syncKeyboardMode() {
  document.body.dataset.keyboardMode = joycon.connected ? 'false' : 'true';
}
syncKeyboardMode();
joycon.addEventListener('connected', syncKeyboardMode);
joycon.addEventListener('disconnected', syncKeyboardMode);

// Scope wireframe is on by default — show it with the initial mapping bounds.
scene.setMappingScope(pose.getMappingBounds(), true);

keyboard.addEventListener('trigger', (e) => {
  const pressed = e.detail.pressed;
  const tool = state.activeTool;
  if (tool === 'pencil') {
    if (pressed) startStroke(); else endStroke();
  } else if (tool === 'eraser') {
    state.eraser.pressed = pressed;
    if (pressed) runEraser();
  } else if (pressed && tool === 'line') {
    handleLineClick();
  } else if (pressed && tool === 'polygon') {
    handlePolygonClick();
  }
});
keyboard.addEventListener('tool', (e) => {
  const t = e.detail.tool;
  const btn = document.querySelector(`[data-tool="${t}"]`);
  if (btn) btn.click();
});
keyboard.addEventListener('undo', () => strokes.undo());
keyboard.addEventListener('recenter', () => fusion.recenter());
keyboard.addEventListener('ink-cycle', () => cycleInk(1));
keyboard.addEventListener('mode-toggle', () => {
  const seg = document.querySelector('[data-mode-set]:not(.seg--active)');
  if (seg) seg.click();
});
keyboard.addEventListener('scope-toggle', () => {
  scene.setMappingScope(pose.getMappingBounds(), !scene.isScopeVisible());
  sidebar.setScopeVisible?.(scene.isScopeVisible());
});

// Re-shape the scope wireframe whenever sensitivity changes
pose.addEventListener('sensitivity', (e) => {
  if (scene.isScopeVisible()) scene.setMappingScope(e.detail.bounds);
});

// ── Pointer routing ──
let mouseDown = false;

canvasEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  // Always feed the fusion pose from the pointer so the cursor tracks it.
  const p = scene.pointerToWorld(e.clientX, e.clientY);
  fusion.setPositionDirect(p.x, p.y, p.z);
  fusion.setQuaternionDirect(new THREE.Quaternion());

  const tool = state.activeTool;

  if (tool === 'pencil') {
    mouseDown = true;
    canvasEl.setPointerCapture(e.pointerId);
    startStroke();
    return;
  }

  if (tool === 'line') {
    handleLineClick();
    return;
  }

  if (tool === 'polygon') {
    handlePolygonClick();
    return;
  }

  if (tool === 'eraser') {
    state.eraser.pressed = true;
    canvasEl.setPointerCapture(e.pointerId);
    runEraser();
    return;
  }

  // hand: no-op (CSS cursor is the only feedback for now)
});

canvasEl.addEventListener('pointermove', (e) => {
  // Don't drive the cursor while the user is mid-drag with a non-left button —
  // that drag is a navigation gesture (right = orbit, middle = pan).
  if (e.buttons & 6) return; // 2 = right, 4 = middle
  if (state.activeTool === 'hand' && (e.buttons & 1)) return;

  const p = scene.pointerToWorld(e.clientX, e.clientY);
  if (mouseDown) {
    fusion.setPositionDirect(p.x, p.y, p.z);
  } else if (!pose._running && !joycon.connected) {
    fusion.setPositionDirect(p.x, p.y, p.z);
  }

  if (state.activeTool === 'eraser' && state.eraser.pressed) {
    runEraser();
  }
});

canvasEl.addEventListener('pointerup', (e) => {
  if (mouseDown) {
    mouseDown = false;
    try { canvasEl.releasePointerCapture(e.pointerId); } catch {}
    endStroke();
  }
  if (state.eraser.pressed) {
    state.eraser.pressed = false;
    try { canvasEl.releasePointerCapture(e.pointerId); } catch {}
  }
});
canvasEl.addEventListener('pointercancel', () => {
  if (mouseDown) {
    mouseDown = false;
    endStroke();
  }
  state.eraser.pressed = false;
});

// Double-click closes the polygon
canvasEl.addEventListener('dblclick', () => {
  if (state.activeTool === 'polygon' && state.polygon.active && state.polygon.vertices.length >= 3) {
    closePolygon();
  }
});

// Keyboard
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.activeTool === 'line' && state.line.anchor) {
      state.line.anchor = null;
      cursor.setLineAnchor(null);
      preview.clear();
      e.preventDefault();
    } else if (state.activeTool === 'polygon' && state.polygon.active) {
      state.polygon.active = false;
      state.polygon.vertices = [];
      cursor.setPolygonVertices([]);
      preview.clear();
      e.preventDefault();
    }
  } else if (e.key === 'Enter') {
    if (state.activeTool === 'polygon' && state.polygon.active && state.polygon.vertices.length >= 3) {
      closePolygon();
      e.preventDefault();
    }
  }
});

// ── Tool helpers ──
function setTool(tool) {
  // Clean up any in-flight tool state from the previous tool.
  if (state.line.anchor) {
    state.line.anchor = null;
    cursor.setLineAnchor(null);
  }
  if (state.polygon.active) {
    state.polygon.active = false;
    state.polygon.vertices = [];
    cursor.setPolygonVertices([]);
  }
  preview.clear();
  state.activeTool = tool;
  cursor.setActiveTool(tool);
  // Hand tool = navigation. Left button orbits when it's active; otherwise
  // left button is reserved for the active drawing tool.
  scene.setNavigationOnLeft(tool === 'hand');
}

function resolveCursorWorld(point, opts = {}) {
  // Resolve the snap pipeline at `point`. Returns { world, hit }.
  const hit = snap.resolve(point, opts);
  if (hit) {
    return { world: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), hit };
  }
  return { world: point.clone(), hit: null };
}

// ── Pencil drag-draw helpers ──
function startStroke() {
  if (state.drawing) return;
  state.drawing = true;
  state.strokeStart = fusion.position.clone();
  strokes.beginStroke(state.activeInk);
  cursor.setStrokeStart(fusion.position);
  cursor.setState(CURSOR_STATES.drawing);
  strokes.pushSample(fusion.position.clone());
}
function endStroke() {
  if (!state.drawing) return;
  state.drawing = false;
  state.strokeStart = null;
  snap.setCurrentDirection(null);
  strokes.endStroke();
  cursor.setState(CURSOR_STATES.idle);
}

// ── Line tool ──
function handleLineClick() {
  const raw = fusion.position.clone();
  if (!state.line.anchor) {
    // First click — place anchor (snap-resolved)
    const { world } = resolveCursorWorld(raw);
    state.line.anchor = { x: world.x, y: world.y, z: world.z };
    cursor.setLineAnchor(state.line.anchor);
    preview.setLine(state.line.anchor, raw, state.activeInk);
  } else {
    // Second click — commit the line
    const a = state.line.anchor;
    const dir = { x: raw.x - a.x, y: raw.y - a.y, z: raw.z - a.z };
    const { world: endWorld } = resolveCursorWorld(raw, { direction: dir, strokeStart: a });
    addStrokeFromPoints(state.activeInk, [a, { x: endWorld.x, y: endWorld.y, z: endWorld.z }]);
    state.line.anchor = null;
    cursor.setLineAnchor(null);
    preview.clear();
  }
}

// ── Polygon tool ──
function handlePolygonClick() {
  const now = performance.now();
  const sinceLast = now - state.lastClickAt;
  state.lastClickAt = now;

  const raw = fusion.position.clone();

  // Auto-close: only fire when the user has clearly committed to closing.
  // Two guards together prevent the "small square" bug where the 4th corner
  // happens to sit within POLYGON_CLOSE_RADIUS of the 1st corner:
  //   1) require at least 4 placed vertices (you can still close a triangle
  //      with Enter or double-click — see the keyboard / dblclick handlers)
  //   2) the click must be CLOSER to v0 than to the last placed vertex,
  //      i.e. the user is genuinely returning to the starting point, not
  //      just placing the next adjacent corner.
  if (state.polygon.active && state.polygon.vertices.length >= 4) {
    const v0 = state.polygon.vertices[0];
    const vLast = state.polygon.vertices[state.polygon.vertices.length - 1];
    const d0 = Math.hypot(raw.x - v0.x, raw.y - v0.y, raw.z - v0.z);
    const dLast = Math.hypot(raw.x - vLast.x, raw.y - vLast.y, raw.z - vLast.z);
    if (d0 <= POLYGON_CLOSE_RADIUS && d0 < dLast) {
      closePolygon();
      return;
    }
  }

  // Otherwise, place a new vertex (snap-resolved)
  const lastVertex = state.polygon.vertices[state.polygon.vertices.length - 1] || null;
  const opts = lastVertex
    ? { direction: { x: raw.x - lastVertex.x, y: raw.y - lastVertex.y, z: raw.z - lastVertex.z }, strokeStart: lastVertex }
    : {};
  const { world } = resolveCursorWorld(raw, opts);
  state.polygon.vertices.push({ x: world.x, y: world.y, z: world.z });
  state.polygon.active = true;
  cursor.setPolygonVertices(state.polygon.vertices);
}

function closePolygon() {
  if (!state.polygon.active || state.polygon.vertices.length < 3) return;
  const verts = state.polygon.vertices.slice();
  verts.push({ x: verts[0].x, y: verts[0].y, z: verts[0].z });
  addStrokeFromPoints(state.activeInk, verts);
  state.polygon.active = false;
  state.polygon.vertices = [];
  cursor.setPolygonVertices([]);
  preview.clear();
}

// ── Eraser tool ──
function runEraser() {
  const cursorWorld = fusion.position;
  // For each stroke, if any segment is within ERASE_RADIUS_WORLD, remove the entire stroke.
  for (let i = strokes.strokes.length - 1; i >= 0; i--) {
    const stroke = strokes.strokes[i];
    if (strokeWithinRadius(stroke, cursorWorld, ERASE_RADIUS_WORLD)) {
      strokes.removeStroke(i);
    }
  }
}

function strokeWithinRadius(stroke, q, r) {
  const arr = stroke.geometry.attributes.position.array;
  const n = stroke.length;
  if (n === 0) return false;
  if (n === 1) {
    const dx = q.x - arr[0], dy = q.y - arr[1], dz = q.z - arr[2];
    return Math.hypot(dx, dy, dz) <= r;
  }
  for (let i = 1; i < n; i++) {
    const ax = arr[(i - 1) * 3], ay = arr[(i - 1) * 3 + 1], az = arr[(i - 1) * 3 + 2];
    const bx = arr[i * 3],       by = arr[i * 3 + 1],       bz = arr[i * 3 + 2];
    if (pointSegmentDistance(q, ax, ay, az, bx, by, bz) <= r) return true;
  }
  return false;
}

function pointSegmentDistance(q, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = q.x - ax, apy = q.y - ay, apz = q.z - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
  return Math.hypot(q.x - cx, q.y - cy, q.z - cz);
}

function addStrokeFromPoints(colorHex, pts) {
  return strokes.addStrokeFromPoints(colorHex, pts);
}

function cycleInk(dir) {
  const swatches = Array.from(stageEl.querySelectorAll('[data-ink]'));
  const i = swatches.findIndex((b) => b.dataset.ink === state.activeInk);
  const next = swatches[(i + dir + swatches.length) % swatches.length];
  next?.click();
}
function cycleTool(dir) {
  const tools = Array.from(stageEl.querySelectorAll('[data-tool]'));
  const i = tools.findIndex((b) => b.classList.contains('tool--active'));
  const next = tools[(i + dir + tools.length) % tools.length];
  next?.click();
}

// ── Per-frame update ──
scene.onFrame((ts) => {
  const dt = state.lastFrameTs ? Math.min((ts - state.lastFrameTs) / 1000, 0.05) : 0;
  state.lastFrameTs = ts;

  // WASD pans the camera-mapping SCOPE (not the scene view). Slides the
  // tracking window so the user can position where in the scene the hand
  // drives the cursor. The scope wireframe (if visible) follows automatically
  // via the 'sensitivity' event.
  if (keyboard.isPanning()) {
    const p = keyboard.tickPan(dt);
    pose.panOffset(p.x, p.y);
  }

  // R / F adjust hand-tracking sensitivity (camera mapping width/height).
  const sTicks = keyboard.tickSensitivity(ts);
  if (sTicks !== 0) {
    pose.setSensitivity(pose.sensitivity + sTicks * 0.1);
    sidebar.setSensitivityValue?.(pose.sensitivity);
  }

  const pose0 = fusion.getPose();

  // Update parallel-snap direction while pencil-drawing
  if (state.drawing && state.strokeStart) {
    const dir = pose0.position.clone().sub(state.strokeStart);
    snap.setCurrentDirection({ x: dir.x, y: dir.y, z: dir.z });
  }

  if (state.drawing) {
    if (state.shiftHeld && state.activeTool === 'pencil') {
      // Shift-line constraint: collapse whatever path got drawn since the
      // start back down to a single straight segment from start → current.
      strokes.truncateActiveTo(1);
      strokes.pushSample(pose0.position.clone());
    } else {
      strokes.pushSample(pose0.position.clone());
    }
  }

  // Resolve snap with tool-aware direction (for parallel snap on previews)
  let snapOpts = {};
  if (state.activeTool === 'line' && state.line.anchor) {
    snapOpts = {
      direction: {
        x: pose0.position.x - state.line.anchor.x,
        y: pose0.position.y - state.line.anchor.y,
        z: pose0.position.z - state.line.anchor.z,
      },
      strokeStart: state.line.anchor,
    };
  } else if (state.activeTool === 'polygon' && state.polygon.active && state.polygon.vertices.length > 0) {
    const last = state.polygon.vertices[state.polygon.vertices.length - 1];
    snapOpts = {
      direction: {
        x: pose0.position.x - last.x,
        y: pose0.position.y - last.y,
        z: pose0.position.z - last.z,
      },
      strokeStart: last,
    };
  } else if (state.drawing && state.strokeStart) {
    snapOpts = {
      direction: {
        x: pose0.position.x - state.strokeStart.x,
        y: pose0.position.y - state.strokeStart.y,
        z: pose0.position.z - state.strokeStart.z,
      },
      strokeStart: state.strokeStart,
    };
  }

  const hit = snap.resolve(pose0.position, snapOpts);

  // Resolved cursor world position (post-snap if applicable)
  if (hit) {
    state.cursorWorld.set(hit.point.x, hit.point.y, hit.point.z);
  } else {
    state.cursorWorld.copy(pose0.position);
  }

  // Refresh the dot-grid window around the cursor every frame.
  scene.dotGrid.setCursor(state.cursorWorld);
  scene.dotGrid.update();

  // Update cursor state
  if (hit) {
    if (cursor.state !== 'drawing') {
      cursor.setState(CURSOR_STATES.snap, { hit });
    }
    showSnapChip(hit, state.cursorWorld);
  } else {
    if (cursor.state === 'snap') cursor.setState(CURSOR_STATES.idle);
    hideSnapChip();
  }

  // Update tool previews
  if (state.activeTool === 'line' && state.line.anchor) {
    preview.setLine(state.line.anchor, state.cursorWorld, state.activeInk);
  } else if (state.activeTool === 'polygon' && state.polygon.active && state.polygon.vertices.length > 0) {
    const v0 = state.polygon.vertices[0];
    const dx = state.cursorWorld.x - v0.x;
    const dy = state.cursorWorld.y - v0.y;
    const dz = state.cursorWorld.z - v0.z;
    const closing = state.polygon.vertices.length >= 3 && Math.hypot(dx, dy, dz) <= POLYGON_CLOSE_RADIUS;
    preview.setPolygon(state.polygon.vertices, state.cursorWorld, state.activeInk, closing);
  }

  // Cursor SVG position uses the resolved (snapped) point too via Cursor.update
  // — feed it the resolved world via a synthesized pose:
  cursor.update({ position: state.cursorWorld, quaternion: pose0.quaternion }, ts);
  coord.update(pose0.position);
});

function showSnapChip(hit, worldPos) {
  if (!snapChipEl) return;
  const screen = scene.projectToScreen(worldPos);
  snapChipEl.hidden = false;
  snapChipEl.style.transform = `translate(${screen.x + 14}px, ${screen.y - 28}px)`;
  const labelEl2 = snapChipEl.querySelector('[data-role="snap-chip-label"]');
  if (labelEl2) labelEl2.textContent = hit.label || hit.kind;
}
function hideSnapChip() {
  if (!snapChipEl) return;
  snapChipEl.hidden = true;
}

scene.start();

// Initialize mode
scene.setMode('3d');
// Initialize cursor tool styling on the canvas
canvasEl.dataset.cursorMode = state.activeTool;

// ── Test hooks ──
window.__app__ = {
  scene,
  fusion,
  strokes,
  snap,
  cursor,
  preview,
  joycon,
  pose,
  keyboard,
  sidebar,
  state,
  get strokeCount() { return strokes.count; },
  get vertexCount() { return strokes.totalVertexCount(); },
  testHook: {
    scene,
    fusion,
    snap,
    cursor,
    preview,
    camPreview,
    /** Add a stroke in world coords from a list of {x,y,z} points. */
    addStroke: (colorHex, pts) => strokes.addStrokeFromPoints(colorHex, pts),
    setSnapEnabled: (kind, on) => snap.setEnabled(kind, on),
    getStrokeCount: () => strokes.count,
    /** Install/uninstall a fake camera stream that bypasses getUserMedia. */
    setMockCameraStream: (on) => {
      __mockCameraStream = on ? createMockMediaStream() : null;
    },
    /** Same world transform Pose.js uses, exposed for z-axis sign tests. */
    computeWorldFromLandmark: (lm) => Pose.computeWorldFromLandmark(lm),
    setTool: (tool) => {
      const btn = stageEl.querySelector(`[data-tool="${tool}"]`);
      if (btn) btn.click();
      else setTool(tool);
    },
    /** Synthesize a click at canvas-relative pixel coords. Routes through the
     * same handler the real pointer events do. */
    simulateClickAt: (x, y) => {
      const rect = canvasEl.getBoundingClientRect();
      const clientX = rect.left + x;
      const clientY = rect.top + y;
      const p = scene.pointerToWorld(clientX, clientY);
      fusion.setPositionDirect(p.x, p.y, p.z);
      fusion.setQuaternionDirect(new THREE.Quaternion());
      const tool = state.activeTool;
      if (tool === 'line') handleLineClick();
      else if (tool === 'polygon') handlePolygonClick();
      else if (tool === 'eraser') runEraser();
      else if (tool === 'pencil') {
        startStroke();
        endStroke();
      }
    },
  },
};

window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
});

console.log('[Sketchpad63] booted');

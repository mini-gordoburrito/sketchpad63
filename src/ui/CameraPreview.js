// CameraPreview — picture-in-picture panel showing the live webcam feed with
// MediaPipe landmarks overlaid. Bottom-left of the canvas region, hidden until
// the camera is running.
//
// Renders in two layers internally:
//   1) <video> (hidden DOM-wise) — provides the source frames.
//   2) <canvas> — we draw the video frame, then the landmarks on top.
//
// Important: we do NOT mirror the preview. The user said they're tracking
// "actual space, not the mirror of it" — so the canvas shows what the camera
// actually sees, un-flipped on either axis.

const COLOR_PAPER = '#FFFCF4';
const COLOR_INK = '#1A1814';
const COLOR_BLUE = '#3D5AFF';
const COLOR_ORANGE = '#FF5A1F';

// MediaPipe Hands connections (palm + 5 fingers).
// Reference: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
export const HAND_CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm fan
  [5, 9], [9, 13], [13, 17], [5, 17],
];

// MediaPipe Pose connections (33 landmarks).
// Reference: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
export const POSE_CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // Right arm
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // Left leg
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // Right leg
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

const HAND_ANCHOR_INDEX = 5;  // index_finger_mcp
const POSE_ANCHOR_INDEX = 16; // right_wrist

export class CameraPreview {
  /**
   * @param {{
   *   panel: HTMLElement,
   *   canvas: HTMLCanvasElement,
   *   video: HTMLVideoElement,
   *   label: HTMLElement,
   *   fps: HTMLElement,
   * }} els
   */
  constructor(els) {
    this.panel = els.panel;
    this.canvas = els.canvas;
    this.video = els.video;
    this.labelEl = els.label;
    this.fpsEl = els.fps;
    this.ctx = this.canvas.getContext('2d');
    this.mode = 'hands';
    this.attached = false;
    this._raf = null;
    /** Most recent landmark frame (set via setFrame). */
    this._frame = null;
    // FPS estimator
    this._fpsLast = performance.now();
    this._fpsAccum = 0;
    this._fpsCount = 0;
    this._fpsValue = 0;

    this._renderLabel();
  }

  setMode(mode) {
    this.mode = mode === 'pose' ? 'pose' : 'hands';
    this._renderLabel();
  }

  _renderLabel() {
    if (this.labelEl) this.labelEl.textContent = this.mode === 'pose' ? 'POSE' : 'HANDS';
  }

  /**
   * Attach a MediaStream to the hidden <video> element and reveal the panel.
   * @param {MediaStream} stream
   */
  attach(stream) {
    if (!stream) return;
    this.video.srcObject = stream;
    // playsInline + muted are set in HTML; play() may need to be called explicitly
    // for some browsers (and for our mock streams used in tests it's a no-op).
    const playPromise = this.video.play?.();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
    this.panel.hidden = false;
    this.attached = true;
    this._raf = requestAnimationFrame(() => this._tick());
  }

  /** Stop the panel and release the video source. */
  detach() {
    this.attached = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    try { this.video.pause?.(); } catch {}
    this.video.srcObject = null;
    this.panel.hidden = true;
    this._frame = null;
    // Clear the canvas so any cached pixels don't leak when we reopen.
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Update the landmark frame to draw on top of the next video frame. */
  setFrame(frame) {
    this._frame = frame;
  }

  /**
   * Draw the latest video frame and the supplied landmarks onto the preview
   * canvas. Public so tests can drive it deterministically.
   * @param {Array<{x:number,y:number,z?:number}>} [landmarks]
   * @param {{mode?: 'hands'|'pose'}} [opts]
   */
  drawFrame(landmarks, opts = {}) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1) Background = paper, then video frame (un-mirrored).
    ctx.save();
    ctx.fillStyle = COLOR_PAPER;
    ctx.fillRect(0, 0, w, h);
    if (this.video && this.video.readyState >= 2 && this.video.videoWidth > 0) {
      try {
        ctx.drawImage(this.video, 0, 0, w, h);
      } catch {
        // drawImage can throw if the video isn't ready (or in test stubs).
      }
    }
    ctx.restore();

    if (!landmarks || landmarks.length === 0) return;

    const mode = opts.mode || this.mode;
    const anchorIdx = mode === 'pose' ? POSE_ANCHOR_INDEX : HAND_ANCHOR_INDEX;
    const connections = mode === 'pose' ? POSE_CONNECTIONS : HAND_CONNECTIONS;

    // 2) Connections
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLOR_BLUE;
    ctx.beginPath();
    for (const [a, b] of connections) {
      const la = landmarks[a];
      const lb = landmarks[b];
      if (!la || !lb) continue;
      ctx.moveTo(la.x * w, la.y * h);
      ctx.lineTo(lb.x * w, lb.y * h);
    }
    ctx.stroke();

    // 3) Dots
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (!lm) continue;
      ctx.beginPath();
      ctx.fillStyle = i === anchorIdx ? COLOR_ORANGE : COLOR_BLUE;
      ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _tick() {
    if (!this.attached) return;
    this._raf = requestAnimationFrame(() => this._tick());

    const frame = this._frame;
    const landmarks = frame?.landmarks;
    const mode = frame?.mode || this.mode;
    this.drawFrame(landmarks, { mode });

    // FPS sample
    const now = performance.now();
    const dt = now - this._fpsLast;
    this._fpsLast = now;
    this._fpsAccum += dt;
    this._fpsCount += 1;
    if (this._fpsAccum >= 500) {
      this._fpsValue = Math.round(1000 / (this._fpsAccum / this._fpsCount));
      this._fpsAccum = 0;
      this._fpsCount = 0;
      if (this.fpsEl) this.fpsEl.textContent = `${this._fpsValue} fps`;
    }
  }
}

/**
 * Build a fake MediaStream-like object for headless tests. The MediaPipe
 * inference is bypassed via `start({ skipInference: true })`, so all we need is
 * an object the <video> element accepts as srcObject without throwing.
 */
export function createMockMediaStream() {
  // Try to use a canvas-captured stream when available — that's a real
  // MediaStream so the preview's drawImage path also works.
  try {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const cx = c.getContext('2d');
    cx.fillStyle = COLOR_PAPER;
    cx.fillRect(0, 0, c.width, c.height);
    if (typeof c.captureStream === 'function') return c.captureStream(0);
  } catch {}
  // Fallback: a dummy MediaStream-shaped object.
  return {
    getTracks: () => [{ stop() {} }],
    getVideoTracks: () => [{ stop() {} }],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

// Pose — MediaPipe Tasks Vision: HandLandmarker or PoseLandmarker.
// User clicks "Start camera" (gesture-required), then the right drawer toggles
// between Hands (uses index_finger_mcp) and Pose (uses right_wrist).
//
// Model files come from Google's CDN — we don't bundle them.

const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const VISION_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// Base mapping from MediaPipe normalized image coords to scene-world coords.
// All three are doubled vs. the original v0.1 mapping — the user said "hand
// drawing should go faster." Sensitivity then scales these further.
const BASE_GAIN_X = 3.2;
const BASE_GAIN_Y = 2.4;
const BASE_GAIN_Z = 2.4;
const Y_OFFSET    = 0.6;   // shift up so a relaxed pose lands mid-canvas

export class Pose extends EventTarget {
  /** @param {import('../fusion/Fusion.js').Fusion} fusion */
  constructor(fusion) {
    super();
    this.fusion = fusion;
    this.mode = 'hands'; // 'hands' | 'pose'
    this.video = null;
    this.stream = null;
    this.handLandmarker = null;
    this.poseLandmarker = null;
    this.fileset = null;
    this._raf = null;
    this._lastVideoTimeMs = -1;
    this._running = false;
    /** Sensitivity multiplier applied to the base mapping. 1.0 = default. */
    this.sensitivity = 1.0;
    /** Pan offset of the camera-mapping window in world space (X / Y). */
    this.offsetX = 0;
    this.offsetY = 0;
    /** @type {{mode:'hands'|'pose', landmarks: Array<{x:number,y:number,z:number,visibility?:number}>, handedness?: 'Left'|'Right'} | null} */
    this._latest = null;
  }

  /** Adjust how much the hand needs to move to drive the cursor. Clamped 0.25–4. */
  setSensitivity(s) {
    this.sensitivity = Math.max(0.25, Math.min(4, Number(s) || 1));
    this._emitChanged();
  }

  /** Pan the mapping window in world XY (additive offset). */
  setOffset(x, y) {
    this.offsetX = Number(x) || 0;
    this.offsetY = Number(y) || 0;
    this._emitChanged();
  }

  /** Convenience: nudge the mapping window by (dx, dy). */
  panOffset(dx, dy) {
    this.setOffset(this.offsetX + (Number(dx) || 0), this.offsetY + (Number(dy) || 0));
  }

  _emitChanged() {
    this.dispatchEvent(new CustomEvent('sensitivity', { detail: { sensitivity: this.sensitivity, bounds: this.getMappingBounds() } }));
  }

  /** Axis-aligned bounds of the world region the camera maps onto. */
  getMappingBounds() {
    const sx = BASE_GAIN_X * this.sensitivity;
    const sy = BASE_GAIN_Y * this.sensitivity;
    const sz = BASE_GAIN_Z * this.sensitivity;
    const cx = this.offsetX;
    const cy = Y_OFFSET + this.offsetY;
    return {
      minX: cx - sx / 2, maxX: cx + sx / 2,
      minY: cy - sy / 2, maxY: cy + sy / 2,
      minZ: -sz / 2,     maxZ: sz / 2,
    };
  }

  /** Returns the most recent landmark frame, or null. */
  getLatestLandmarks() {
    return this._latest;
  }

  /** Returns the active <video> element (or null when not running). */
  getVideoElement() {
    return this.video;
  }

  /** Returns the active MediaStream (or null when not running). */
  getStream() {
    return this.stream;
  }

  isRunning() {
    return this._running;
  }

  /**
   * Pure transform from a MediaPipe-normalized landmark to scene-world coords.
   * Exposed for test verification and re-use by the camera preview.
   * @param {{x:number,y:number,z:number}} lm
   * @param {{sensitivity?: number}} [opts]
   */
  static computeWorldFromLandmark(lm, opts = {}) {
    const s = opts.sensitivity ?? 1;
    // mirror x for selfie cam (right hand → right of scene); offset y so the
    // shoulders aren't centered low; reverse z so "away from camera" = +z forward
    const x = (1 - lm.x - 0.5) * BASE_GAIN_X * s;
    const y = (0.5 - lm.y)     * BASE_GAIN_Y * s + Y_OFFSET;
    const z = -lm.z            * BASE_GAIN_Z * s;
    return { x, y, z };
  }

  /**
   * Camera-relative Z from a Hand landmark array. MediaPipe's per-landmark `z`
   * is wrist-relative depth (useless for cursor Z), so we use the projected
   * hand size on the image as a depth proxy. Bigger hand on screen = closer
   * to camera. Maps to "away from camera = +z forward" to match the rest of
   * the coordinate convention.
   *
   * @param {Array<{x:number,y:number,z?:number}>} hand 21-landmark hand
   * @param {number} sensitivity overall mapping sensitivity
   * @returns {number} world-space Z, clamped to a sensible range
   */
  static computeZFromHandSize(hand, sensitivity = 1) {
    if (!hand || hand.length <= 9) return 0;
    const a = hand[0];  // wrist
    const b = hand[9];  // middle_finger_mcp
    const size = Math.hypot(a.x - b.x, a.y - b.y); // normalised image coords
    // Reference size: a hand at "comfortable arm's length" subtends ~0.12 of
    // the image. Tune Z_SCALE for response speed.
    const REF_SIZE = 0.12;
    const Z_SCALE  = 4.0;
    const z = (REF_SIZE - size) * Z_SCALE * sensitivity;
    return Math.max(-1.5, Math.min(1.5, z));
  }

  async _ensureFileset() {
    if (this.fileset) return this.fileset;
    const { FilesetResolver } = await import('@mediapipe/tasks-vision');
    this.fileset = await FilesetResolver.forVisionTasks(VISION_WASM_BASE);
    return this.fileset;
  }

  async _ensureHandLandmarker() {
    if (this.handLandmarker) return this.handLandmarker;
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await this._ensureFileset();
    this.handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    return this.handLandmarker;
  }

  async _ensurePoseLandmarker() {
    if (this.poseLandmarker) return this.poseLandmarker;
    const { PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await this._ensureFileset();
    this.poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    return this.poseLandmarker;
  }

  /** Must be called from a user gesture. */
  async start({ mockStream = null, skipInference = false } = {}) {
    if (this._running) return;

    if (mockStream) {
      this.stream = mockStream;
    } else {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API unavailable.');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
    }

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.srcObject = this.stream;
    if (!mockStream) {
      await new Promise((res) => this.video.addEventListener('loadeddata', res, { once: true }));
      await this.video.play().catch(() => {});
    }

    if (!skipInference) {
      if (this.mode === 'hands') await this._ensureHandLandmarker();
      else await this._ensurePoseLandmarker();
    }
    this._skipInference = !!skipInference;

    this._running = true;
    this._loop();
    this.dispatchEvent(new CustomEvent('started', { detail: { mode: this.mode } }));
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this._latest = null;
    this.dispatchEvent(new CustomEvent('stopped'));
  }

  async setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this._running) {
      if (mode === 'hands') await this._ensureHandLandmarker();
      else await this._ensurePoseLandmarker();
    }
    this.dispatchEvent(new CustomEvent('modechange', { detail: { mode } }));
  }

  _loop() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(() => this._loop());

    if (this._skipInference) return;

    const v = this.video;
    if (!v || v.readyState < 2) return;
    if (v.currentTime === this._lastVideoTimeMs) return;
    this._lastVideoTimeMs = v.currentTime;

    const tNow = performance.now();
    try {
      if (this.mode === 'hands' && this.handLandmarker) {
        const result = this.handLandmarker.detectForVideo(v, tNow);
        const hand = result.landmarks?.[0];
        const handednessLabel = result.handedness?.[0]?.[0]?.categoryName;
        if (hand && hand.length > 9) {
          this._latest = { mode: 'hands', landmarks: hand, handedness: handednessLabel };
          this.dispatchEvent(new CustomEvent('pose-frame', { detail: this._latest }));
          // Index finger MCP = landmark 5 in MediaPipe Hands.
          const lm = hand[5];
          // Camera-relative Z proxy: bigger hand on screen = closer to camera.
          // Wrist (0) to middle_finger_mcp (9) gives a stable "palm width" line.
          const zWorld = Pose.computeZFromHandSize(hand, this.sensitivity);
          this._emitPosition(lm.x, lm.y, 0, 0.95, zWorld);
        } else {
          this._latest = { mode: 'hands', landmarks: [], handedness: undefined };
          this.dispatchEvent(new CustomEvent('pose-frame', { detail: this._latest }));
        }
      } else if (this.mode === 'pose' && this.poseLandmarker) {
        const result = this.poseLandmarker.detectForVideo(v, tNow);
        const pose = result.landmarks?.[0];
        if (pose && pose.length > 16) {
          this._latest = { mode: 'pose', landmarks: pose };
          this.dispatchEvent(new CustomEvent('pose-frame', { detail: this._latest }));
          // 16 = right wrist in MediaPipe Pose.
          const lm = pose[16];
          const conf = lm.visibility ?? 0.7;
          this._emitPosition(lm.x, lm.y, lm.z, conf);
        } else {
          this._latest = { mode: 'pose', landmarks: [] };
          this.dispatchEvent(new CustomEvent('pose-frame', { detail: this._latest }));
        }
      }
    } catch (err) {
      console.warn('[Pose] inference error', err);
    }
  }

  _emitPosition(nx, ny, nz, confidence, zWorldOverride) {
    const w = Pose.computeWorldFromLandmark({ x: nx, y: ny, z: nz }, { sensitivity: this.sensitivity });
    const x = w.x + this.offsetX;
    const y = w.y + this.offsetY;
    // Hands mode passes an override because MediaPipe's per-landmark z is
    // wrist-relative depth, not camera-relative — useless for cursor Z.
    const z = zWorldOverride !== undefined ? zWorldOverride : w.z;
    const t = performance.now() / 1000;
    this.fusion.ingestPosition({ x, y, z, t, confidence });
    this.dispatchEvent(new CustomEvent('sample', { detail: { x, y, z, confidence } }));
  }
}

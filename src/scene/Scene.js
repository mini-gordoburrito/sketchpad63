// Three.js scene wrapper — paper-grid floor, soft lighting, perspective + orthographic cameras.
// Supports a 2D mode (orthographic, looking down -Z, fixed grid plane visible) and a 3D mode
// (perspective camera). setMode('2d'|'3d') swaps which camera renders.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DotGrid } from './DotGrid.js';

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = '3d';

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.background = null;

    // Perspective camera (3D mode)
    this.cameraPersp = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.cameraPersp.position.set(0, 1.4, 3.2);
    this.cameraPersp.lookAt(0, 0.6, 0);

    // Orthographic camera (2D mode) — looking down -Z onto the world plane
    this.cameraOrtho = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 100);
    this.cameraOrtho.position.set(0, 0, 5);
    this.cameraOrtho.up.set(0, 1, 0);
    this.cameraOrtho.lookAt(0, 0, 0);

    /** Active camera; flipped by setMode. */
    this.camera = this.cameraPersp;

    this.scene.add(new THREE.AmbientLight(0xfff7e0, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xff8866, 0.18);
    fill.position.set(-3, 1, -2);
    this.scene.add(fill);

    // Grid: dots-only, only the window around the cursor renders.
    // Replaces the old GridHelper lines so the dots are the snap affordance.
    this.dotGrid = new DotGrid(this.scene);

    const axis = new THREE.AxesHelper(0.3);
    axis.position.set(0, 0.001, 0);
    this.scene.add(axis);

    this.strokeRoot = new THREE.Group();
    this.scene.add(this.strokeRoot);

    this.cursorRoot = new THREE.Group();
    this.scene.add(this.cursorRoot);

    // Camera-mapping scope wireframe: visualises the world region the webcam
    // tracking maps onto, so the user can see where their hand has to be to
    // drive the cursor. Off by default; toggled with G or the sidebar checkbox.
    this.scopeBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x3D5AFF, transparent: true, opacity: 0.6 }),
    );
    this.scopeBox.visible = false;
    this.scopeBox.name = 'scope-box';
    this.scene.add(this.scopeBox);

    this._raf = null;
    this._frameCallbacks = new Set();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    // ── OrbitControls — mouse navigation in 3D space ──
    // Left button is reserved for the active drawing tool. Middle = pan,
    // right = orbit, wheel = zoom. Touch is one-finger orbit, two-finger
    // pinch+pan. When the "hand" tool is active, main.js promotes LEFT to
    // ROTATE so a single-finger orbit works on touch devices too.
    this.controls = new OrbitControls(this.cameraPersp, canvas);
    this.controls.target.set(0, 0.6, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.zoomSpeed = 0.9;
    this.controls.rotateSpeed = 0.7;
    this.controls.panSpeed = 0.8;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 12;
    // Suppress orbit-on-LEFT by default — drawing wins on left button.
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.update();
  }

  /** Toggle whether LEFT button orbits (used by the "hand" tool). */
  setNavigationOnLeft(on) {
    if (!this.controls) return;
    this.controls.mouseButtons = {
      LEFT: on ? THREE.MOUSE.ROTATE : null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
  }

  /** Switch between '2d' and '3d' rendering modes. */
  setMode(mode) {
    if (mode !== '2d' && mode !== '3d') return;
    this.mode = mode;
    if (mode === '2d') {
      this.camera = this.cameraOrtho;
      // OrbitControls makes no sense in our top-down 2D view; turn it off.
      if (this.controls) this.controls.enabled = false;
    } else {
      this.camera = this.cameraPersp;
      if (this.controls) {
        this.controls.object = this.cameraPersp;
        this.controls.enabled = true;
        this.controls.update();
      }
    }
    this.dotGrid.setMode(mode);
    this._resize();
  }

  onFrame(cb) { this._frameCallbacks.add(cb); return () => this._frameCallbacks.delete(cb); }

  /**
   * Pan the active camera in its local frame. The scene stays put; the camera
   * (and its target / lookAt) move together so the rendered view shifts.
   * Doesn't affect drawing — strokes still land in world coords.
   */
  panView(dx, dy) {
    if (dx === 0 && dy === 0) return;
    if (this.mode === '2d') {
      // Orthographic: just slide the camera in world XY
      this.cameraOrtho.position.x += dx;
      this.cameraOrtho.position.y += dy;
    } else {
      // Perspective: pan in the camera's local right / up so up-key feels "up on screen"
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      this.cameraPersp.matrixWorld.extractBasis(right, up, new THREE.Vector3());
      const move = right.multiplyScalar(dx).add(up.multiplyScalar(dy));
      this.cameraPersp.position.add(move);
    }
  }

  /**
   * Show / hide and re-shape the camera scope wireframe.
   * @param {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}} bounds
   */
  setMappingScope(bounds, visible) {
    if (typeof visible === 'boolean') this.scopeBox.visible = visible;
    if (!bounds) return;
    const sx = Math.max(0.001, bounds.maxX - bounds.minX);
    const sy = Math.max(0.001, bounds.maxY - bounds.minY);
    const sz = Math.max(0.001, bounds.maxZ - bounds.minZ);
    this.scopeBox.scale.set(sx, sy, sz);
    this.scopeBox.position.set(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2,
    );
  }

  isScopeVisible() { return this.scopeBox.visible; }

  start() {
    if (this._raf != null) return;
    const tick = (ts) => {
      this._raf = requestAnimationFrame(tick);
      if (this.controls && this.controls.enabled) this.controls.update();
      for (const cb of this._frameCallbacks) cb(ts);
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this._raf != null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  /** Project a world-space point to CSS px relative to the canvas. */
  projectToScreen(vec3) {
    const v = vec3.clone().project(this.camera);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      z: v.z,
    };
  }

  /**
   * The work plane the pointer is projected onto.
   *   • 2D mode: z = 0 (top-down).
   *   • 3D mode: perpendicular to the camera's view direction, passing through
   *     the orbit target. As the user orbits, the work plane rotates with the
   *     view — so pointer clicks can land at any (x,y,z) and per-axis grid
   *     snap engages on every axis instead of just X/Y.
   * @returns {THREE.Plane}
   */
  getWorkPlane() {
    if (this.mode === '2d') {
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    }
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal); // points from camera into scene
    const target = this.controls?.target ?? new THREE.Vector3(0, 0.6, 0);
    // Plane equation n·x + d = 0 with d = -n·target so the plane contains target
    const d = -normal.dot(target);
    return new THREE.Plane(normal, d);
  }

  /**
   * Convert pointer event → world-space point on the active work plane.
   */
  pointerToWorld(eventClientX, eventClientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((eventClientX - rect.left) / rect.width) * 2 - 1,
      -((eventClientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const out = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(this.getWorkPlane(), out);
    if (!hit) return new THREE.Vector3(0, 0, 0);
    return out;
  }

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(h, 1);
    this.cameraPersp.aspect = aspect;
    this.cameraPersp.updateProjectionMatrix();

    // Orthographic frustum scales with aspect, keep ~4 world units tall
    const halfH = 2;
    const halfW = halfH * aspect;
    this.cameraOrtho.left = -halfW;
    this.cameraOrtho.right = halfW;
    this.cameraOrtho.top = halfH;
    this.cameraOrtho.bottom = -halfH;
    this.cameraOrtho.updateProjectionMatrix();
  }
}

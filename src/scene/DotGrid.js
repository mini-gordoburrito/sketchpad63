// DotGrid — sparse 3D / 2D grid rendered as Points instead of GridHelper lines.
// Only draws a small window around the cursor (rather than every grid point in
// the world) so the dots act as a local snap-affordance, not a wallpaper.
//
// One Points object, one preallocated buffer. Each frame, `update(cursor)`
// rewrites the buffer with the dots in a (WINDOW × WINDOW [× WINDOW]) cube
// around the cursor's nearest grid point.

import * as THREE from 'three';

const WINDOW = 11; // odd → cursor sits on the centre dot

export class DotGrid {
  /** @param {THREE.Object3D} parent */
  constructor(parent) {
    this.parent = parent;
    this.mode = '3d';
    this.gridSize = 0.25;
    this.cursor = new THREE.Vector3(0, 0, 0);
    this.enabled = true;

    const cap = WINDOW * WINDOW * WINDOW; // 1331 max in 3D
    const positions = new Float32Array(cap * 3);
    const colors    = new Float32Array(cap * 3);

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    this.geom.setDrawRange(0, 0);

    this.mat = new THREE.PointsMaterial({
      size: 4,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
    });

    this.points = new THREE.Points(this.geom, this.mat);
    this.points.frustumCulled = false;
    this.points.name = 'dot-grid';
    parent.add(this.points);
  }

  setMode(mode) {
    if (mode !== '2d' && mode !== '3d') return;
    this.mode = mode;
  }

  /** Grid step in world units. Clamped 0.05 – 2.0. */
  setGridSize(s) {
    this.gridSize = Math.max(0.05, Math.min(2, Number(s) || 0.5));
  }

  setCursor(vec3) { this.cursor.copy(vec3); }

  setVisible(on) { this.points.visible = !!on; }

  /**
   * Rewrite the buffer with the dots in a window around the cursor's nearest
   * grid point. Per-dot color fades toward the window edge.
   */
  update() {
    if (!this.enabled) return;
    const g = this.gridSize;
    const cx = Math.round(this.cursor.x / g) * g;
    const cy = Math.round(this.cursor.y / g) * g;
    const cz = Math.round(this.cursor.z / g) * g;

    const arr = this.geom.attributes.position.array;
    const cArr = this.geom.attributes.color.array;
    const half = Math.floor(WINDOW / 2);

    // Base dot color: warm ink-faded; fade to near-paper at the window edge.
    const baseR = 0x6B / 255, baseG = 0x65 / 255, baseB = 0x5A / 255;
    const farR  = 0xD4 / 255, farG  = 0xCD / 255, farB  = 0xB8 / 255;

    let n = 0;

    if (this.mode === '2d') {
      // 2D mode: static flat dot grid centered on the WORLD origin (no
      // cursor-reveal — that's a 3D-only effect). Wider window than 3D so
      // the working area covers the orthographic frustum comfortably.
      const half2D = WINDOW; // 21-wide square (11×2 + 1)
      for (let i = -half2D; i <= half2D; i++) {
        for (let j = -half2D; j <= half2D; j++) {
          const idx = n * 3;
          arr[idx]     = i * g;
          arr[idx + 1] = j * g;
          arr[idx + 2] = 0;
          const t = Math.min(1, Math.hypot(i, j) / half2D);
          cArr[idx]     = baseR + (farR - baseR) * t;
          cArr[idx + 1] = baseG + (farG - baseG) * t;
          cArr[idx + 2] = baseB + (farB - baseB) * t;
          n++;
          if (n * 3 >= arr.length) break;
        }
        if (n * 3 >= arr.length) break;
      }
    } else {
      // 3D mode: a *spherical* shell of dots around the cursor, not the full
      // bounding cube. Tighter visual focus, fewer dots overall.
      const sphereR = half;
      for (let i = -half; i <= half; i++) {
        for (let j = -half; j <= half; j++) {
          for (let k = -half; k <= half; k++) {
            const r = Math.hypot(i, j, k);
            if (r > sphereR) continue; // skip everything outside the sphere
            const idx = n * 3;
            arr[idx]     = cx + i * g;
            arr[idx + 1] = cy + j * g;
            arr[idx + 2] = cz + k * g;
            const t = Math.min(1, r / sphereR);
            cArr[idx]     = baseR + (farR - baseR) * t;
            cArr[idx + 1] = baseG + (farG - baseG) * t;
            cArr[idx + 2] = baseB + (farB - baseB) * t;
            n++;
          }
        }
      }
    }

    this.geom.setDrawRange(0, n);
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
  }
}

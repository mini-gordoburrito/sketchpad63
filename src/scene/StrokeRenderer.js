// Stroke renderer — append-on-sample line geometry, per-vertex color = active ink at sample time.
import * as THREE from 'three';

const MIN_SAMPLE_DIST = 0.004; // m — drop redundant samples
const MAX_VERTS_PER_STROKE = 4096;

export class StrokeRenderer {
  /**
   * @param {THREE.Group} parent — the strokeRoot from Scene
   */
  constructor(parent) {
    this.parent = parent;
    /** @type {Stroke[]} */
    this.strokes = [];
    this.activeStroke = null;
    /** When true, all incoming samples are clamped to z=0 (2D mode). */
    this.flatten2D = false;
  }

  /** Returns total vertex count across all strokes — useful for tests. */
  totalVertexCount() {
    return this.strokes.reduce((acc, s) => acc + s.length, 0);
  }

  /** Number of finished + in-progress strokes. */
  get count() { return this.strokes.length; }

  /** Toggle 2D-flatten on the renderer (called by Scene.setMode). */
  setFlatten2D(on) { this.flatten2D = !!on; }

  beginStroke(colorHex) {
    if (this.activeStroke) this.endStroke();
    const stroke = new Stroke(colorHex);
    this.activeStroke = stroke;
    this.strokes.push(stroke);
    this.parent.add(stroke.line);
    return stroke;
  }

  pushSample(point) {
    if (!this.activeStroke) return;
    if (this.flatten2D) {
      // Clone-with-z=0 to avoid mutating the caller's vector
      const flat = (typeof point.clone === 'function') ? point.clone() : { x: point.x, y: point.y, z: 0 };
      flat.z = 0;
      this.activeStroke.push(flat);
    } else {
      this.activeStroke.push(point);
    }
  }

  /** Direct insertion (used by tests for deterministic strokes). */
  addStrokeFromPoints(colorHex, points) {
    this.beginStroke(colorHex);
    for (const p of points) {
      // Skip the MIN_SAMPLE_DIST de-dupe check by going through push directly:
      // we want test-controlled strokes to land verbatim.
      this.activeStroke._lastPoint = null;
      this.activeStroke.push({ x: p.x, y: p.y, z: p.z ?? 0 });
    }
    this.endStroke();
    return this.strokes[this.strokes.length - 1];
  }

  endStroke() {
    if (!this.activeStroke) return;
    this.activeStroke.finalize();
    this.activeStroke = null;
  }

  /**
   * Truncate the active stroke to its first `n` samples. Used by the
   * shift-to-straight-line constraint: while shift is held, the stroke is
   * rebuilt every frame as [start, currentCursor], collapsing whatever
   * freehand path was drawn between them.
   */
  truncateActiveTo(n) {
    if (!this.activeStroke) return;
    if (n < 0) n = 0;
    if (n > this.activeStroke.length) return;
    this.activeStroke.length = n;
    this.activeStroke._lastPoint = null;
    this.activeStroke.geometry.setDrawRange(0, n);
    this.activeStroke.geometry.attributes.position.needsUpdate = true;
    this.activeStroke.geometry.attributes.color.needsUpdate = true;
    this.activeStroke.geometry.computeBoundingSphere();
  }

  undo() {
    const last = this.strokes.pop();
    if (!last) return;
    this.parent.remove(last.line);
    last.dispose();
    if (this.activeStroke === last) this.activeStroke = null;
  }

  /**
   * Remove a stroke at a specific index (used by the eraser tool).
   * Disposes geometry/material and detaches from the parent group.
   * Returns true if a stroke was removed.
   */
  removeStroke(index) {
    if (index < 0 || index >= this.strokes.length) return false;
    const stroke = this.strokes[index];
    this.parent.remove(stroke.line);
    stroke.dispose();
    this.strokes.splice(index, 1);
    if (this.activeStroke === stroke) this.activeStroke = null;
    return true;
  }

  clear() {
    while (this.strokes.length) this.undo();
  }
}

class Stroke {
  constructor(colorHex) {
    this.color = new THREE.Color(colorHex);
    this.length = 0;

    const positions = new Float32Array(MAX_VERTS_PER_STROKE * 3);
    const colors = new Float32Array(MAX_VERTS_PER_STROKE * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setDrawRange(0, 0);
    this.geometry.computeBoundingSphere();

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 2, // ignored on most platforms; we use thicker tube for press-feel via repeated samples
      transparent: true,
      opacity: 0.95,
    });
    this.line = new THREE.Line(this.geometry, this.material);
    this.line.userData.strokeId = Math.random().toString(36).slice(2);
    this.line.frustumCulled = false;
    this._lastPoint = null;
  }

  push(p) {
    if (this.length >= MAX_VERTS_PER_STROKE) return;
    // Accept either THREE.Vector3 or {x,y,z}
    const px = p.x, py = p.y, pz = p.z;
    if (this._lastPoint) {
      const dx = px - this._lastPoint.x, dy = py - this._lastPoint.y, dz = pz - this._lastPoint.z;
      if (Math.hypot(dx, dy, dz) < MIN_SAMPLE_DIST) return;
    }

    const pos = this.geometry.attributes.position.array;
    const col = this.geometry.attributes.color.array;
    const i = this.length * 3;
    pos[i] = px; pos[i + 1] = py; pos[i + 2] = pz;
    col[i] = this.color.r; col[i + 1] = this.color.g; col[i + 2] = this.color.b;

    this.length += 1;
    this.geometry.setDrawRange(0, this.length);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this._lastPoint = { x: px, y: py, z: pz };
  }

  finalize() {
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

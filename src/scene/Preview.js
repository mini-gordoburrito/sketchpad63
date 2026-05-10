// Preview — ephemeral line + polygon overlays for the line + polygon tools.
// Renders dashed preview edges, in-progress polygon edges/vertices, and the
// rubber-band edge from the last vertex to the cursor.
//
// Lives in a Three.js group, parented to scene.cursorRoot (so it renders above
// committed strokes but uses the same camera).

import * as THREE from 'three';

const PREVIEW_COLOR_DEFAULT = 0xFF5A1F; // orange
const SNAP_COLOR = 0xFF5A1F;            // orange (closing-color)

export class Preview {
  /** @param {THREE.Group} parent — typically scene.cursorRoot */
  constructor(parent) {
    this.parent = parent;
    this.group = new THREE.Group();
    this.group.name = 'preview-root';
    parent.add(this.group);

    // Single dashed preview line (used for line tool + the polygon "next edge")
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.lineMat = new THREE.LineDashedMaterial({
      color: PREVIEW_COLOR_DEFAULT,
      dashSize: 0.05,
      gapSize: 0.03,
      transparent: true,
      opacity: 0.9,
      linewidth: 1.5,
    });
    this.lineMesh = new THREE.LineSegments(lineGeom, this.lineMat);
    this.lineMesh.frustumCulled = false;
    this.lineMesh.visible = false;
    this.group.add(this.lineMesh);

    // Solid polygon edges (the chain of committed-but-not-yet-finalized vertices)
    const polyEdgeGeom = new THREE.BufferGeometry();
    // Capacity for up to 256 segments (512 vertices, 1536 floats).
    this._polyEdgeCapacity = 256;
    polyEdgeGeom.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array(this._polyEdgeCapacity * 6), 3,
    ));
    polyEdgeGeom.setDrawRange(0, 0);
    // Polygon-as-you-go: render the placed segments as if they were real
    // committed strokes — full opacity, no dash, slightly thicker. Only the
    // live edge from the last vertex to the cursor stays as a dashed preview.
    this.polyEdgeMat = new THREE.LineBasicMaterial({
      color: PREVIEW_COLOR_DEFAULT,
      transparent: false,
      opacity: 1.0,
      linewidth: 2.0,
    });
    this.polyEdgeMesh = new THREE.LineSegments(polyEdgeGeom, this.polyEdgeMat);
    this.polyEdgeMesh.frustumCulled = false;
    this.polyEdgeMesh.visible = false;
    this.group.add(this.polyEdgeMesh);

    // Polygon vertex dots — instanced points
    const dotsGeom = new THREE.BufferGeometry();
    this._polyDotsCapacity = 256;
    dotsGeom.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array(this._polyDotsCapacity * 3), 3,
    ));
    dotsGeom.setDrawRange(0, 0);
    this.polyDotsMat = new THREE.PointsMaterial({
      color: PREVIEW_COLOR_DEFAULT,
      size: 8,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
    });
    this.polyDotsMesh = new THREE.Points(dotsGeom, this.polyDotsMat);
    this.polyDotsMesh.frustumCulled = false;
    this.polyDotsMesh.visible = false;
    this.group.add(this.polyDotsMesh);
  }

  /** Show a dashed line preview from a → b in world coords. */
  setLine(a, b, colorHex = '#FF5A1F') {
    const arr = this.lineMesh.geometry.attributes.position.array;
    arr[0] = a.x; arr[1] = a.y; arr[2] = a.z ?? 0;
    arr[3] = b.x; arr[4] = b.y; arr[5] = b.z ?? 0;
    this.lineMesh.geometry.attributes.position.needsUpdate = true;
    this.lineMesh.geometry.computeBoundingSphere();
    this.lineMat.color.set(colorHex);
    this.lineMesh.computeLineDistances();
    this.lineMesh.visible = true;
  }

  /**
   * Render the in-progress polygon: vertices as dots, the chain of solid edges
   * (vertex 0 → 1 → 2 → ...), and a dashed preview edge from the last vertex
   * to `cursorPoint`. `closing=true` styles the preview edge in snap-orange to
   * indicate the cursor is within close-radius of vertex 0.
   *
   * @param {Array<{x,y,z}>} vertices
   * @param {{x,y,z}} cursorPoint
   * @param {string} colorHex
   * @param {boolean} closing
   */
  setPolygon(vertices, cursorPoint, colorHex = '#FF5A1F', closing = false) {
    if (!vertices || vertices.length === 0) {
      this.polyEdgeMesh.visible = false;
      this.polyDotsMesh.visible = false;
      this.lineMesh.visible = false;
      return;
    }

    // Edges: pairs of (i, i+1) for i in [0..n-2]
    const edgeArr = this.polyEdgeMesh.geometry.attributes.position.array;
    const segCount = Math.max(0, vertices.length - 1);
    for (let i = 0; i < segCount; i++) {
      const a = vertices[i], b = vertices[i + 1];
      const o = i * 6;
      edgeArr[o] = a.x;     edgeArr[o + 1] = a.y;     edgeArr[o + 2] = a.z ?? 0;
      edgeArr[o + 3] = b.x; edgeArr[o + 4] = b.y;     edgeArr[o + 5] = b.z ?? 0;
    }
    this.polyEdgeMesh.geometry.setDrawRange(0, segCount * 2);
    this.polyEdgeMesh.geometry.attributes.position.needsUpdate = true;
    this.polyEdgeMesh.geometry.computeBoundingSphere();
    this.polyEdgeMat.color.set(colorHex);
    this.polyEdgeMesh.visible = segCount > 0;

    // Dots
    const dotsArr = this.polyDotsMesh.geometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i++) {
      dotsArr[i * 3] = vertices[i].x;
      dotsArr[i * 3 + 1] = vertices[i].y;
      dotsArr[i * 3 + 2] = vertices[i].z ?? 0;
    }
    this.polyDotsMesh.geometry.setDrawRange(0, vertices.length);
    this.polyDotsMesh.geometry.attributes.position.needsUpdate = true;
    this.polyDotsMesh.geometry.computeBoundingSphere();
    this.polyDotsMat.color.set(colorHex);
    this.polyDotsMesh.visible = vertices.length > 0;

    // Preview edge from last vertex to cursor
    if (cursorPoint) {
      const last = vertices[vertices.length - 1];
      this.setLine(last, cursorPoint, closing ? '#FF5A1F' : colorHex);
    } else {
      this.lineMesh.visible = false;
    }
  }

  /** Hide all preview meshes. */
  clear() {
    this.lineMesh.visible = false;
    this.polyEdgeMesh.visible = false;
    this.polyDotsMesh.visible = false;
  }
}

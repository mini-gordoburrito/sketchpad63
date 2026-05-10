// Snap detector — real (not stubs).
// Priority: vertex > edge > parallel > grid. First hit within threshold wins.
//
//   - findVertexSnap   : nearest vertex of any stroke
//   - findEdgeSnap     : closest point on any segment
//   - findParallelSnap : lock in-progress direction to nearest existing segment direction
//   - findGridSnap     : round to gridSize world units (default 0.5)
//
// World units in this app are coarse — strokes live in roughly the [-3, +3] range.
// The thresholds below are tuned for that scale. If you change scene scale, retune.

import * as THREE from 'three';

const VERTEX_THRESHOLD   = 0.12;
const EDGE_THRESHOLD     = 0.10;
const PARALLEL_THRESHOLD = (3 * Math.PI) / 180; // 3°
const GRID_SIZE          = 0.5;
const GRID_THRESHOLD     = GRID_SIZE * 0.35;    // less grabby: snap inside ~1/3 of a cell

/**
 * @typedef {Object} SnapHit
 * @property {'vertex' | 'edge' | 'parallel' | 'grid'} kind
 * @property {{x:number,y:number,z:number}} point
 * @property {string} label
 * @property {number} distance
 * @property {string} [type]      same as kind, for tests that look at .type
 * @property {number} [segmentId] index of the segment that produced an edge/parallel hit
 */

/** Closest point on segment ab to point p, plus the parametric `t`. */
function closestPointOnSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 === 0) return { point: { x: a.x, y: a.y, z: a.z }, t: 0 };
  let t = (apx * abx + apy * aby + apz * abz) / ab2;
  t = Math.max(0, Math.min(1, t));
  return {
    point: { x: a.x + abx * t, y: a.y + aby * t, z: a.z + abz * t },
    t,
  };
}

/** Walk every stroke and yield each segment as { id, a, b, strokeIndex, segIndex }. */
function* iterateSegments(strokes) {
  let segId = 0;
  for (let s = 0; s < strokes.length; s++) {
    const stroke = strokes[s];
    const arr = stroke.geometry.attributes.position.array;
    for (let i = 1; i < stroke.length; i++) {
      const ax = arr[(i - 1) * 3], ay = arr[(i - 1) * 3 + 1], az = arr[(i - 1) * 3 + 2];
      const bx = arr[i * 3],       by = arr[i * 3 + 1],       bz = arr[i * 3 + 2];
      yield {
        id: segId++,
        strokeIndex: s,
        segIndex: i - 1,
        a: { x: ax, y: ay, z: az },
        b: { x: bx, y: by, z: bz },
      };
    }
  }
}

export class Snap {
  /** @param {import('./StrokeRenderer.js').StrokeRenderer} strokeRenderer */
  constructor(strokeRenderer) {
    this.strokeRenderer = strokeRenderer;
    this.enabled = { vertex: true, edge: true, parallel: false, grid: true };
    /** Set by StrokeRenderer or main loop while drawing — used for parallel snap. */
    this.currentDirection = null; // {x,y,z} unit-ish vector
    this.gridSize = 0.25;
  }

  setEnabled(kind, on) { this.enabled[kind] = on; }
  setCurrentDirection(dir) { this.currentDirection = dir; }
  /** Used by the sidebar slider so dot-grid + grid-snap stay in sync. */
  setGridSize(s) {
    this.gridSize = Math.max(0.05, Math.min(2, Number(s) || 0.5));
  }

  /** Plain-object → Vector3 (accepts either). */
  _toVec(p) {
    return p && typeof p.x === 'number'
      ? new THREE.Vector3(p.x, p.y, p.z || 0)
      : new THREE.Vector3();
  }

  /**
   * Vertex snap — nearest endpoint within threshold.
   * @returns {SnapHit | null}
   */
  findVertexSnap(point, threshold = VERTEX_THRESHOLD) {
    const q = this._toVec(point);
    let best = null;
    let n = 0;
    for (const stroke of this.strokeRenderer.strokes) {
      const arr = stroke.geometry.attributes.position.array;
      for (let i = 0; i < stroke.length; i++) {
        const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
        const dx = q.x - x, dy = q.y - y, dz = q.z - z;
        const d = Math.hypot(dx, dy, dz);
        if (d <= threshold && (!best || d < best.distance)) {
          best = {
            kind: 'vertex',
            type: 'vertex',
            point: { x, y, z },
            label: `vertex.${String(n).padStart(2, '0')}`,
            distance: d,
            vertexId: n,
          };
        }
        n += 1;
      }
    }
    return best;
  }

  /**
   * Edge snap — nearest point on any segment.
   * @returns {SnapHit | null}
   */
  findEdgeSnap(point, strokes = this.strokeRenderer.strokes, threshold = EDGE_THRESHOLD) {
    const q = this._toVec(point);
    let best = null;
    for (const seg of iterateSegments(strokes)) {
      const { point: cp } = closestPointOnSegment(q, seg.a, seg.b);
      const dx = q.x - cp.x, dy = q.y - cp.y, dz = q.z - cp.z;
      const d = Math.hypot(dx, dy, dz);
      if (d <= threshold && (!best || d < best.distance)) {
        best = {
          kind: 'edge',
          type: 'edge',
          point: cp,
          label: `edge.${String(seg.id).padStart(2, '0')}`,
          distance: d,
          segmentId: seg.id,
        };
      }
    }
    return best;
  }

  /**
   * Parallel snap — current in-progress stroke direction is locked to an existing
   * segment direction within angleThreshold. Returns the locked endpoint:
   * the input point projected onto the line through the stroke start in the
   * direction of the matching segment.
   *
   * @param {{x:number,y:number,z:number}} currentDirection — unit-ish vector of the
   *   current stroke (e.g. cur - start).
   * @param {{x:number,y:number,z:number}} point — current cursor point
   * @param {Array} strokes — existing strokes
   * @param {number} angleThreshold — radians, default 5°
   * @param {{x:number,y:number,z:number}} [strokeStart] — stroke origin to lock from
   * @returns {SnapHit | null}
   */
  findParallelSnap(currentDirection, point, strokes = this.strokeRenderer.strokes, angleThreshold = PARALLEL_THRESHOLD, strokeStart = null) {
    if (!currentDirection) return null;
    const cur = new THREE.Vector3(currentDirection.x, currentDirection.y, currentDirection.z);
    if (cur.lengthSq() < 1e-8) return null;
    cur.normalize();

    const q = this._toVec(point);
    const start = strokeStart
      ? new THREE.Vector3(strokeStart.x, strokeStart.y, strokeStart.z)
      : q.clone().sub(cur); // fallback so we still get a sensible projection

    let best = null;
    for (const seg of iterateSegments(strokes)) {
      const segDir = new THREE.Vector3(seg.b.x - seg.a.x, seg.b.y - seg.a.y, seg.b.z - seg.a.z);
      if (segDir.lengthSq() < 1e-8) continue;
      segDir.normalize();
      // angle between current and segment (treat antiparallel the same)
      const dot = Math.max(-1, Math.min(1, Math.abs(cur.dot(segDir))));
      const angle = Math.acos(dot);
      if (angle <= angleThreshold && (!best || angle < best.angle)) {
        // project (q - start) onto segDir to get the locked endpoint
        const v = q.clone().sub(start);
        const t = v.dot(segDir);
        const locked = start.clone().add(segDir.clone().multiplyScalar(t));
        best = {
          kind: 'parallel',
          type: 'parallel',
          point: { x: locked.x, y: locked.y, z: locked.z },
          label: `parallel.${String(seg.id).padStart(2, '0')}`,
          distance: q.distanceTo(locked),
          segmentId: seg.id,
          angle,
        };
      }
    }
    return best;
  }

  /**
   * Grid snap — round to nearest gridSize. Always returns a hit when grid is enabled
   * and the rounded point is within GRID_THRESHOLD of the input.
   * @returns {SnapHit | null}
   */
  // Per-axis grid snap. Each axis snaps independently if its distance to the
  // nearest grid plane on that axis is within threshold. So moving along Z
  // can lock Z to a grid value even when X / Y aren't on grid intersections,
  // and vice versa. Snap radius is INDEPENDENT of grid size so shrinking
  // the grid doesn't change how aggressive snap feels.
  findGridSnap(point, gridSize = this.gridSize, threshold = 0.18) {
    const q = this._toVec(point);
    const sxRaw = Math.round(q.x / gridSize) * gridSize;
    const syRaw = Math.round(q.y / gridSize) * gridSize;
    const szRaw = Math.round(q.z / gridSize) * gridSize;
    const dx = Math.abs(q.x - sxRaw);
    const dy = Math.abs(q.y - syRaw);
    const dz = Math.abs(q.z - szRaw);

    const snappedX = dx <= threshold;
    const snappedY = dy <= threshold;
    const snappedZ = dz <= threshold;
    if (!snappedX && !snappedY && !snappedZ) return null;

    const x = snappedX ? sxRaw : q.x;
    const y = snappedY ? syRaw : q.y;
    const z = snappedZ ? szRaw : q.z;

    const axes = (snappedX ? 'x' : '') + (snappedY ? 'y' : '') + (snappedZ ? 'z' : '');
    return {
      kind: 'grid',
      type: 'grid',
      point: { x, y, z },
      label: `grid·${gridSize} (${axes})`,
      distance: Math.hypot(q.x - x, q.y - y, q.z - z),
      axes: { x: snappedX, y: snappedY, z: snappedZ },
    };
  }

  /**
   * Resolve all enabled snap kinds, priority vertex > edge > parallel > grid.
   * First hit wins.
   * @returns {SnapHit | null}
   */
  resolve(point, opts = {}) {
    const strokes = this.strokeRenderer.strokes;
    if (this.enabled.vertex) {
      const v = this.findVertexSnap(point);
      if (v) return v;
    }
    if (this.enabled.edge) {
      const e = this.findEdgeSnap(point, strokes);
      if (e) return e;
    }
    if (this.enabled.parallel) {
      const dir = opts.direction || this.currentDirection;
      if (dir) {
        const p = this.findParallelSnap(dir, point, strokes, PARALLEL_THRESHOLD, opts.strokeStart);
        if (p) return p;
      }
    }
    if (this.enabled.grid) {
      const g = this.findGridSnap(point);
      if (g) return g;
    }
    return null;
  }

  /** Back-compat with previous code path used in main.js render loop. */
  query(point, opts) { return this.resolve(point, opts); }
}

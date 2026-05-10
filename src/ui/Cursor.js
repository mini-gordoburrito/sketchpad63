// Cursor — 2D SVG overlay over the canvas + DOM trailing label.
// States: idle / drawing / snap. Cursor shape varies per active tool.
// No 3D mesh — the previous Three.js pencil group has been removed entirely.

import * as THREE from 'three';

const STATE_IDLE = 'idle';
const STATE_DRAWING = 'drawing';
const STATE_SNAP = 'snap';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Shorthand: build an SVG element with attrs. */
function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) {
    if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  }
  return el;
}

export class Cursor {
  /**
   * @param {import('../scene/Scene.js').Scene} scene
   * @param {HTMLElement} stageEl     — stage container (carries data-cursor-state)
   * @param {HTMLElement} labelEl     — DOM tag overlay
   */
  constructor(scene, stageEl, labelEl) {
    this.scene = scene;
    this.stageEl = stageEl;
    this.labelEl = labelEl;
    this.titleEl = labelEl.querySelector('[data-role="cursor-title"]');
    this.subEl = labelEl.querySelector('[data-role="cursor-sub"]');

    this.state = STATE_IDLE;
    this._activeInk = '#1A1814';
    this._activeTool = 'pencil';
    this._strokeStart = null;
    this._snapInfo = null;

    // Per-tool extra context that affects the rendered SVG cursor.
    this._lineAnchor = null;        // {x,y,z} world point of the line-tool first click
    this._polygonVertices = [];     // array of {x,y,z}
    this._eraseRadiusWorld = 0.3;
    this._screenX = 0;
    this._screenY = 0;

    // Overlay div is provided in markup; we own its SVG content.
    this.overlayEl = stageEl.querySelector('[data-role="cursor-overlay"]');
    if (!this.overlayEl) {
      // Defensive fallback — create one if missing.
      this.overlayEl = document.createElement('div');
      this.overlayEl.className = 'cursor-overlay';
      this.overlayEl.dataset.role = 'cursor-overlay';
      this.overlayEl.dataset.cursorTool = 'pencil';
      this.overlayEl.setAttribute('aria-hidden', 'true');
      stageEl.querySelector('.canvas-region')?.appendChild(this.overlayEl);
    }

    this.svgEl = svg('svg', {
      'data-role': 'cursor-svg',
      width: '1',
      height: '1',
      viewBox: '0 0 1 1',
    });
    // We use absolute positioning + transform for the SVG element itself
    // and draw all glyphs centered around (0,0) so transform places the cursor.
    this.svgEl.style.transform = 'translate(0px, 0px)';
    this.overlayEl.appendChild(this.svgEl);

    // Mark the overlay with the active tool (used by tests + CSS).
    this.overlayEl.dataset.cursorTool = this._activeTool;
  }

  setActiveInk(hex) {
    this._activeInk = hex;
    this._updateLabel();
    this._render();
  }

  setActiveTool(tool) {
    this._activeTool = tool;
    this.overlayEl.dataset.cursorTool = tool;
    // Update canvas cursor for hand tool (uses dedicated attr to avoid
    // colliding with the sidebar's [data-tool="..."] selectors).
    const canvas = document.getElementById('three-canvas');
    if (canvas) canvas.dataset.cursorMode = tool;
    this._updateLabel();
    this._render();
  }

  setStrokeStart(point) { this._strokeStart = point ? point.clone() : null; }

  /** Line-tool first click anchor (world point). null when no anchor pending. */
  setLineAnchor(p) {
    this._lineAnchor = p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  /** Polygon-tool in-progress vertices (array of world points). */
  setPolygonVertices(vertices) {
    this._polygonVertices = vertices ? vertices.map(v => ({ x: v.x, y: v.y, z: v.z })) : [];
  }

  /** Eraser radius in world units. */
  setEraseRadius(r) { this._eraseRadiusWorld = r; }

  setState(state, info = {}) {
    if (![STATE_IDLE, STATE_DRAWING, STATE_SNAP].includes(state)) return;
    this.state = state;
    this.stageEl.dataset.cursorState = state;

    if (state === STATE_SNAP) {
      this._snapInfo = info.hit || { kind: 'vertex', label: 'vertex.00' };
      this.stageEl.dataset.snapKind = this._snapInfo.kind || '';
      this.stageEl.dataset.snapLabel = this._snapInfo.label || '';
    } else {
      this._snapInfo = null;
    }
    this._updateLabel();
    this._render();
  }

  /** Per-frame: update label position based on projected world tip. */
  update(pose, ts) {
    if (!pose) return;

    // The cursor screen position. If snap fires (and isn't drawing), prefer the
    // snapped world point so the cursor lands ON the snap target.
    let worldTip = pose.position.clone();
    if (this.state === STATE_SNAP && this._snapInfo && this._snapInfo.point) {
      worldTip.set(this._snapInfo.point.x, this._snapInfo.point.y, this._snapInfo.point.z);
    }

    const screen = this.scene.projectToScreen(worldTip);
    this._screenX = screen.x;
    this._screenY = screen.y;

    this.svgEl.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
    this.labelEl.style.transform = `translate(${screen.x + 18}px, ${screen.y - 14}px)`;

    this._render(ts);
  }

  /** Stub kept for API compat — ghost line is no longer rendered as a 3D dashed line. */
  setGhostTarget(_from, _to) { /* no-op: replaced by SVG-side connectors when relevant. */ }

  _updateLabel() {
    const tool = this._activeTool.toUpperCase();
    if (this.state === STATE_DRAWING) {
      this.titleEl.textContent = `DRAWING`;
      this.subEl.textContent = this._activeInk;
    } else if (this.state === STATE_SNAP) {
      const info = this._snapInfo || {};
      this.titleEl.textContent = `SNAP`;
      this.subEl.textContent = info.label || info.kind || 'snap';
    } else {
      this.titleEl.textContent = `${tool}`;
      this.subEl.textContent = this._activeInk;
    }
  }

  /** Build / re-build the SVG glyph for the current tool + state. */
  _render(_ts) {
    // Clear and rebuild: cheap (handful of nodes).
    while (this.svgEl.firstChild) this.svgEl.removeChild(this.svgEl.firstChild);

    const ink = this._activeInk;
    const tool = this._activeTool;

    if (tool === 'hand') {
      // Hand tool: don't render a glyph; the canvas's CSS cursor takes over.
      this._maybeRenderSnapSparkle();
      return;
    }

    if (tool === 'pencil') {
      // 14px ring, ink color, plus center dot
      this.svgEl.appendChild(svg('circle', {
        cx: 0, cy: 0, r: 7,
        fill: 'none', stroke: ink, 'stroke-width': 1.6,
      }));
      this.svgEl.appendChild(svg('circle', {
        cx: 0, cy: 0, r: 1.2, fill: ink,
      }));
    } else if (tool === 'line') {
      this._renderCrosshair(ink);
      // Anchor + rubber-band preview
      if (this._lineAnchor) {
        const anchorScreen = this.scene.projectToScreen(
          new THREE.Vector3(this._lineAnchor.x, this._lineAnchor.y, this._lineAnchor.z)
        );
        const ax = anchorScreen.x - this._screenX;
        const ay = anchorScreen.y - this._screenY;
        // Rubber-band line from anchor to cursor (cursor is at 0,0 in svg local)
        this.svgEl.appendChild(svg('line', {
          x1: ax, y1: ay, x2: 0, y2: 0,
          stroke: ink, 'stroke-width': 1.5,
          'stroke-dasharray': '4 3',
          opacity: 0.9,
        }));
        // Anchor dot
        this.svgEl.appendChild(svg('circle', {
          cx: ax, cy: ay, r: 3, fill: ink,
        }));
      }
    } else if (tool === 'polygon') {
      this._renderCrosshair(ink);
      // Vertex-count badge
      const n = this._polygonVertices.length;
      if (n > 0) {
        this.svgEl.appendChild(svg('circle', {
          cx: 11, cy: -11, r: 7,
          fill: '#FFFCF4', stroke: ink, 'stroke-width': 1,
        }));
        const txt = svg('text', {
          x: 11, y: -11,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'font-family': 'Geist Mono, ui-monospace, monospace',
          'font-size': 10,
          'font-variant-numeric': 'tabular-nums',
          fill: ink,
        });
        txt.textContent = String(n);
        this.svgEl.appendChild(txt);
      }
    } else if (tool === 'eraser') {
      // Red dashed ring, radius scaled to world-space erase radius projected to pixels.
      const px = this._worldRadiusToPixels(this._eraseRadiusWorld);
      this.svgEl.appendChild(svg('circle', {
        cx: 0, cy: 0, r: Math.max(6, px),
        fill: 'none',
        stroke: '#FF5A1F', 'stroke-width': 1.6,
        'stroke-dasharray': '3 3',
      }));
      // Tiny center dot for precision
      this.svgEl.appendChild(svg('circle', {
        cx: 0, cy: 0, r: 1.2, fill: '#FF5A1F',
      }));
    } else {
      // Fallback: pencil ring
      this.svgEl.appendChild(svg('circle', {
        cx: 0, cy: 0, r: 7, fill: 'none', stroke: ink, 'stroke-width': 1.6,
      }));
    }

    this._maybeRenderSnapSparkle();
  }

  _renderCrosshair(ink) {
    // 4 short ticks at N/S/E/W, 16px total
    const t = 4;
    const g = svg('g', { stroke: ink, 'stroke-width': 1.4, 'stroke-linecap': 'round' });
    g.appendChild(svg('line', { x1: 0, y1: -8, x2: 0, y2: -8 + t }));
    g.appendChild(svg('line', { x1: 0, y1: 8 - t, x2: 0, y2: 8 }));
    g.appendChild(svg('line', { x1: -8, y1: 0, x2: -8 + t, y2: 0 }));
    g.appendChild(svg('line', { x1: 8 - t, y1: 0, x2: 8, y2: 0 }));
    // Center dot
    g.appendChild(svg('circle', {
      cx: 0, cy: 0, r: 0.9, fill: ink, stroke: 'none',
    }));
    this.svgEl.appendChild(g);
  }

  _maybeRenderSnapSparkle() {
    if (this.state !== STATE_SNAP) return;
    // 8 short tick lines at 12-16px from center
    const g = svg('g', {
      stroke: '#FF5A1F',
      'stroke-width': 1.2,
      'stroke-linecap': 'round',
      transform: 'translate(14, -14)',
    });
    const rays = 8;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const x1 = Math.cos(a) * 3;
      const y1 = Math.sin(a) * 3;
      const x2 = Math.cos(a) * 6;
      const y2 = Math.sin(a) * 6;
      g.appendChild(svg('line', {
        x1: x1.toFixed(2), y1: y1.toFixed(2),
        x2: x2.toFixed(2), y2: y2.toFixed(2),
      }));
    }
    this.svgEl.appendChild(g);
  }

  /** Convert a world-space radius to pixels using camera projection. */
  _worldRadiusToPixels(rWorld) {
    // Project two world points (cursor world, cursor world + rWorld in X) and
    // measure the screen distance — gives a reasonable per-camera scale.
    // The `pose.position` isn't available here, so we use the inverse: project
    // origin and origin+rX. This is approximate but good enough for the cursor.
    try {
      const p0 = this.scene.projectToScreen(new THREE.Vector3(0, 0, 0));
      const p1 = this.scene.projectToScreen(new THREE.Vector3(rWorld, 0, 0));
      return Math.hypot(p1.x - p0.x, p1.y - p0.y);
    } catch {
      return 18;
    }
  }
}

export const CURSOR_STATES = { idle: STATE_IDLE, drawing: STATE_DRAWING, snap: STATE_SNAP };

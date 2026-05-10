// Keyboard — left-hand QWERTY input source.
//
// Movement keys (WASD) pan the SCENE VIEW (not the cursor). R/F adjust how
// wide / high the camera mapping covers (i.e. the hand-tracking sensitivity).
// Discrete keys fire one-shot events.
//
//   key.tickPan(dt)        → {x, y}        // view-pan delta this frame, world units
//   key.tickSensitivity()  → -1 | 0 | +1   // discrete sensitivity ticks per frame
//
// Discrete events fire as CustomEvents on the EventTarget itself:
//
//   'trigger'      detail: { pressed: boolean }      // Space
//   'tool'         detail: { tool: 'pencil' | 'line' | 'polygon' | 'eraser' | 'hand' }
//   'undo'         (Z)
//   'recenter'     (X)
//   'ink-cycle'    (C)
//   'mode-toggle'  (V)
//   'scope-toggle' (G — show / hide the camera scope wireframe)
//
// We deliberately ignore key events while the user is typing into an <input>,
// <textarea>, or contenteditable.

const TOOL_BY_DIGIT = {
  '1': 'pencil',
  '2': 'line',
  '3': 'polygon',
  '4': 'eraser',
  '5': 'hand',
};

const PAN_SPEED  = 2.5;  // world units / second (base)
const PAN_BOOST  = 5.0;  // when Shift held

export class Keyboard extends EventTarget {
  constructor() {
    super();
    this.held = new Set();
    this.enabled = true;
    /** Accumulator for R/F so a tap = 1 sensitivity tick. */
    this._sensTickPending = 0;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', () => this.held.clear());
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  _isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target.isContentEditable === true
    );
  }

  _onKeyDown(e) {
    if (!this.enabled) return;
    if (this._isTyping(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();

    // Pan keys — track held state for per-frame integration
    if ('wasd'.includes(key) || key === 'shift') {
      this.held.add(key);
      if ('wasd'.includes(key)) e.preventDefault();
      return;
    }

    // R / F — also track held; we sample these as continuous sensitivity ticks
    if (key === 'r' || key === 'f') {
      this.held.add(key);
      // First press also fires an immediate tick so taps feel responsive
      this._sensTickPending += (key === 'r') ? 1 : -1;
      e.preventDefault();
      return;
    }

    if (e.repeat) return;

    if (key === ' ') {
      this.held.add(' ');
      this.dispatchEvent(new CustomEvent('trigger', { detail: { pressed: true } }));
      e.preventDefault();
      return;
    }

    if (TOOL_BY_DIGIT[key]) {
      this.dispatchEvent(new CustomEvent('tool', { detail: { tool: TOOL_BY_DIGIT[key] } }));
      e.preventDefault();
      return;
    }

    if (key === 'z') { this.dispatchEvent(new CustomEvent('undo')); e.preventDefault(); return; }
    if (key === 'x') { this.dispatchEvent(new CustomEvent('recenter')); e.preventDefault(); return; }
    if (key === 'c') { this.dispatchEvent(new CustomEvent('ink-cycle')); e.preventDefault(); return; }
    if (key === 'v') { this.dispatchEvent(new CustomEvent('mode-toggle')); e.preventDefault(); return; }
    if (key === 'g') { this.dispatchEvent(new CustomEvent('scope-toggle')); e.preventDefault(); return; }
  }

  _onKeyUp(e) {
    const key = e.key.toLowerCase();

    if (key === ' ') {
      this.held.delete(' ');
      this.dispatchEvent(new CustomEvent('trigger', { detail: { pressed: false } }));
      return;
    }

    if ('wasdrf'.includes(key) || key === 'shift') {
      this.held.delete(key);
      return;
    }
  }

  /**
   * View-pan delta for this frame (world units).
   * @param {number} dt seconds since last tick
   * @returns {{x:number,y:number}}
   */
  tickPan(dt) {
    if (!this.enabled) return { x: 0, y: 0 };
    let dx = 0, dy = 0;
    const speed = (this.held.has('shift') ? PAN_BOOST : PAN_SPEED) * dt;
    if (this.held.has('a')) dx -= speed;
    if (this.held.has('d')) dx += speed;
    if (this.held.has('w')) dy += speed;
    if (this.held.has('s')) dy -= speed;
    return { x: dx, y: dy };
  }

  /**
   * Pull and clear pending sensitivity ticks. -1, 0, or +1+ per frame.
   * Held R/F also adds a tick every ~120ms so holding the key keeps adjusting.
   */
  tickSensitivity(now) {
    let ticks = this._sensTickPending;
    this._sensTickPending = 0;

    // Held repeat: every ~120ms while R or F is held, append a tick.
    if (this.held.has('r') || this.held.has('f')) {
      if (!this._sensRepeatAt || now - this._sensRepeatAt >= 120) {
        this._sensRepeatAt = now;
        if (this.held.has('r')) ticks += 1;
        if (this.held.has('f')) ticks -= 1;
      }
    } else {
      this._sensRepeatAt = 0;
    }

    return ticks;
  }

  /** True if any pan key is currently held. */
  isPanning() {
    return (
      this.held.has('w') || this.held.has('a') ||
      this.held.has('s') || this.held.has('d')
    );
  }
}

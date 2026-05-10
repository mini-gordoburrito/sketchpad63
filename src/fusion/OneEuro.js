// One Euro Filter — adaptive low-pass for jittery samples.
// Reference: Casiez, Roussel, Vogel 2012.
// Cutoff increases with speed → less lag during fast motion, more smoothing at rest.

class LowPass {
  constructor() { this.y = null; this.s = null; }
  filter(x, alpha) {
    const s = this.s == null ? x : alpha * x + (1 - alpha) * this.s;
    this.y = x;
    this.s = s;
    return s;
  }
  hasLast() { return this.s != null; }
  lastRaw() { return this.y; }
  lastFiltered() { return this.s; }
}

function alpha(rateHz, cutoff) {
  const tau = 1 / (2 * Math.PI * cutoff);
  const te = 1 / rateHz;
  return 1 / (1 + tau / te);
}

export class OneEuroFilter {
  /**
   * @param {object} opts
   * @param {number} [opts.minCutoff=1.0] base cutoff in Hz
   * @param {number} [opts.beta=0.02]     speed coefficient
   * @param {number} [opts.dCutoff=1.0]   cutoff for the derivative
   */
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastTime = null;
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastTime = null;
  }

  /**
   * @param {number} value
   * @param {number} timestampSeconds
   */
  filter(value, timestampSeconds) {
    let rate = 60;
    if (this.lastTime != null && timestampSeconds > this.lastTime) {
      rate = 1 / (timestampSeconds - this.lastTime);
    }
    this.lastTime = timestampSeconds;

    const dxVal = this.x.hasLast() ? (value - this.x.lastFiltered()) * rate : 0;
    const eDx = this.dx.filter(dxVal, alpha(rate, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(eDx);
    return this.x.filter(value, alpha(rate, cutoff));
  }
}

/** Vec3 wrapper for convenience. */
export class OneEuroVec3 {
  constructor(opts) {
    this.fx = new OneEuroFilter(opts);
    this.fy = new OneEuroFilter(opts);
    this.fz = new OneEuroFilter(opts);
  }
  reset() { this.fx.reset(); this.fy.reset(); this.fz.reset(); }
  filter(x, y, z, t, out = [0, 0, 0]) {
    out[0] = this.fx.filter(x, t);
    out[1] = this.fy.filter(y, t);
    out[2] = this.fz.filter(z, t);
    return out;
  }
}

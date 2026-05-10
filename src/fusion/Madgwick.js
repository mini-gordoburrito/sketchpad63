// Madgwick AHRS — gyro (rad/s) + accelerometer (g, normalized) → orientation quaternion.
// Hand-rolled port of the canonical Madgwick filter (https://x-io.co.uk/open-source-imu-and-ahrs-algorithms/).
// State is a unit quaternion [w, x, y, z].

export class Madgwick {
  /**
   * @param {object} opts
   * @param {number} [opts.sampleHz=60] sensor rate
   * @param {number} [opts.beta=0.08] tradeoff: gyro vs accel correction
   */
  constructor({ sampleHz = 60, beta = 0.08 } = {}) {
    this.sampleHz = sampleHz;
    this.beta = beta;
    this.q0 = 1;
    this.q1 = 0;
    this.q2 = 0;
    this.q3 = 0;
  }

  reset() {
    this.q0 = 1; this.q1 = 0; this.q2 = 0; this.q3 = 0;
  }

  /**
   * @param {number} gx rad/s
   * @param {number} gy rad/s
   * @param {number} gz rad/s
   * @param {number} ax g
   * @param {number} ay g
   * @param {number} az g
   * @param {number} [dt] seconds. If omitted, uses 1/sampleHz.
   */
  update(gx, gy, gz, ax, ay, az, dt) {
    const step = dt && dt > 0 ? dt : 1 / this.sampleHz;
    let { q0, q1, q2, q3 } = this;

    // Rate of change from gyro
    let qDot1 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
    let qDot2 = 0.5 * ( q0 * gx + q2 * gz - q3 * gy);
    let qDot3 = 0.5 * ( q0 * gy - q1 * gz + q3 * gx);
    let qDot4 = 0.5 * ( q0 * gz + q1 * gy - q2 * gx);

    // Compute feedback only if accel is valid
    if (!(ax === 0 && ay === 0 && az === 0)) {
      // Normalize accel
      let recip = 1 / Math.hypot(ax, ay, az);
      ax *= recip; ay *= recip; az *= recip;

      // Auxiliary variables
      const _2q0 = 2 * q0, _2q1 = 2 * q1, _2q2 = 2 * q2, _2q3 = 2 * q3;
      const _4q0 = 4 * q0, _4q1 = 4 * q1, _4q2 = 4 * q2;
      const _8q1 = 8 * q1, _8q2 = 8 * q2;
      const q0q0 = q0 * q0, q1q1 = q1 * q1, q2q2 = q2 * q2, q3q3 = q3 * q3;

      // Gradient descent step
      let s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
      let s1 = _4q1 * q3q3 - _2q3 * ax + 4 * q0q0 * q1 - _2q0 * ay - _4q1 + _8q1 * q1q1 + _8q1 * q2q2 + _4q1 * az;
      let s2 = 4 * q0q0 * q2 + _2q0 * ax + _4q2 * q3q3 - _2q3 * ay - _4q2 + _8q2 * q1q1 + _8q2 * q2q2 + _4q2 * az;
      let s3 = 4 * q1q1 * q3 - _2q1 * ax + 4 * q2q2 * q3 - _2q2 * ay;

      const sNorm = Math.hypot(s0, s1, s2, s3);
      if (sNorm > 0) {
        const inv = 1 / sNorm;
        s0 *= inv; s1 *= inv; s2 *= inv; s3 *= inv;

        qDot1 -= this.beta * s0;
        qDot2 -= this.beta * s1;
        qDot3 -= this.beta * s2;
        qDot4 -= this.beta * s3;
      }
    }

    q0 += qDot1 * step;
    q1 += qDot2 * step;
    q2 += qDot3 * step;
    q3 += qDot4 * step;

    // Normalize
    const qNorm = Math.hypot(q0, q1, q2, q3);
    if (qNorm > 0) {
      const inv = 1 / qNorm;
      q0 *= inv; q1 *= inv; q2 *= inv; q3 *= inv;
    }

    this.q0 = q0; this.q1 = q1; this.q2 = q2; this.q3 = q3;
  }

  /** Returns [x, y, z, w] (Three.js convention). */
  toThreeQuaternion(out = [0, 0, 0, 1]) {
    out[0] = this.q1;
    out[1] = this.q2;
    out[2] = this.q3;
    out[3] = this.q0;
    return out;
  }
}

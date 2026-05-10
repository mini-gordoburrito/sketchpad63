// JoyCon — wraps Tomayac's joy-con-webhid library. Connects on user click.
// Streams IMU samples (gyro rad/s + accel g) → Fusion. Maps buttons → game events.
//
// joy-con-webhid surfaces parsed packets via "hidinput" CustomEvent on each device.
// We funnel the IMU into Fusion.ingestImu() and emit a small set of named events
// for buttons (ZR, A, B, R, plus, home, R-stick click).

import * as JoyConLib from 'joy-con-webhid';

export class JoyCon extends EventTarget {
  /** @param {import('../fusion/Fusion.js').Fusion} fusion */
  constructor(fusion) {
    super();
    this.fusion = fusion;
    this.devices = [];
    this._lastTimestamp = null;
    this._connected = false;
    this._buttonState = {};
  }

  get connected() { return this._connected; }

  /** Must be called from a user gesture — opens the WebHID picker. */
  async connect() {
    if (!('hid' in navigator)) {
      throw new Error('WebHID not available — use Chrome/Edge over localhost or HTTPS.');
    }
    // joy-con-webhid prompts the chooser and returns paired Joy-Cons.
    // Library API: connectJoyCon() requests devices via navigator.hid.requestDevice.
    const fn = JoyConLib.connectJoyCon;
    if (typeof fn !== 'function') {
      throw new Error('joy-con-webhid: connectJoyCon export not found.');
    }
    await fn();

    // After a successful pair the library populates `connectedJoyCons` (Map<id, JoyCon>).
    const map = JoyConLib.connectedJoyCons;
    if (!map) {
      throw new Error('joy-con-webhid: connectedJoyCons map not available.');
    }
    for (const [, device] of map) this._attachDevice(device);
    this._connected = this.devices.length > 0;
    this.dispatchEvent(new CustomEvent('connected', { detail: { count: this.devices.length } }));
  }

  _attachDevice(device) {
    if (this.devices.includes(device)) return;
    this.devices.push(device);
    if (typeof device.enableStandardFullMode === 'function') {
      device.enableStandardFullMode().catch(() => {});
    }
    if (typeof device.enableIMUMode === 'function') {
      device.enableIMUMode().catch(() => {});
    }
    device.addEventListener('hidinput', (event) => this._onHidInput(event));
  }

  _onHidInput(event) {
    const detail = event.detail || {};
    const accel = detail.actualAccelerometer;
    const gyro = detail.actualGyroscope;
    const buttons = detail.buttonStatus || detail.buttons;

    // Joy-Con reports accelerometer in g; gyro in deg/s on the lib's "actual" path.
    if (accel && gyro) {
      const ax = accel.x ?? 0;
      const ay = accel.y ?? 0;
      const az = accel.z ?? 0;
      const gx = (gyro.rps?.x ?? gyro.x ?? 0) * (gyro.rps ? 1 : Math.PI / 180);
      const gy = (gyro.rps?.y ?? gyro.y ?? 0) * (gyro.rps ? 1 : Math.PI / 180);
      const gz = (gyro.rps?.z ?? gyro.z ?? 0) * (gyro.rps ? 1 : Math.PI / 180);

      const now = performance.now() / 1000;
      const dt = this._lastTimestamp == null ? 1 / 60 : Math.min(0.05, now - this._lastTimestamp);
      this._lastTimestamp = now;

      this.fusion.ingestImu({ gx, gy, gz, ax, ay, az, dt });
    }

    if (buttons) this._diffButtons(buttons);
  }

  _diffButtons(next) {
    const watch = ['zr', 'a', 'b', 'r', 'plus', 'home', 'rightStick'];
    for (const key of watch) {
      const was = !!this._buttonState[key];
      const now = !!next[key];
      if (was !== now) {
        this.dispatchEvent(new CustomEvent('button', {
          detail: { name: key, pressed: now },
        }));
      }
      this._buttonState[key] = now;
    }
  }

  async rumble(lowFreq = 320, highFreq = 160, amp = 0.6, ms = 60) {
    for (const dev of this.devices) {
      if (typeof dev.rumble === 'function') {
        try { await dev.rumble(lowFreq, highFreq, amp); } catch {}
      }
    }
    setTimeout(() => {
      for (const dev of this.devices) {
        if (typeof dev.rumble === 'function') {
          dev.rumble(0, 0, 0).catch(() => {});
        }
      }
    }, ms);
  }
}

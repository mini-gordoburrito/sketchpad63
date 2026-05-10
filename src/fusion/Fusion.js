// Fusion — owns the wand pose. IMU drives orientation only; camera drives position only.
// Recenter snapshots the current camera position as origin and current quaternion as forward.
import * as THREE from 'three';
import { Madgwick } from './Madgwick.js';
import { OneEuroVec3 } from './OneEuro.js';

export class Fusion {
  constructor() {
    this.madgwick = new Madgwick({ sampleHz: 60, beta: 0.08 });
    this.posFilter = new OneEuroVec3({ minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 });

    // Raw camera-derived position (pre-recenter)
    this.rawPosition = new THREE.Vector3();
    // Raw IMU quaternion (pre-recenter)
    this.rawQuaternion = new THREE.Quaternion();

    // Recenter offsets
    this.originPos = new THREE.Vector3();
    this.originQuatInv = new THREE.Quaternion();

    // Final wand pose (in app world space)
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();

    // Fall-back when no IMU is connected
    this.fallbackQuaternion = new THREE.Quaternion();
  }

  /**
   * Push an IMU sample.
   * @param {{gx:number,gy:number,gz:number,ax:number,ay:number,az:number,dt?:number}} sample
   */
  ingestImu({ gx, gy, gz, ax, ay, az, dt }) {
    this.madgwick.update(gx, gy, gz, ax, ay, az, dt);
    const q = this.madgwick.toThreeQuaternion();
    this.rawQuaternion.set(q[0], q[1], q[2], q[3]);
    this._recompute();
  }

  /**
   * Push a camera-tracked position sample.
   * @param {{x:number,y:number,z:number,t:number,confidence?:number}} sample
   */
  ingestPosition({ x, y, z, t, confidence = 1 }) {
    if (confidence < 0.4) return;
    const out = this.posFilter.filter(x, y, z, t);
    this.rawPosition.set(out[0], out[1], out[2]);
    this._recompute();
  }

  /**
   * Manual position override — used by the mouse-drag fallback.
   * Bypasses the OneEuro filter so the cursor responds 1:1 to the cursor.
   */
  setPositionDirect(x, y, z) {
    this.rawPosition.set(x, y, z);
    this._recompute();
  }

  /** Used by mouse fallback to set orientation when no IMU. */
  setQuaternionDirect(q) {
    this.fallbackQuaternion.copy(q);
    this.rawQuaternion.copy(q);
    this._recompute();
  }

  /** Capture current pose as the world origin. */
  recenter() {
    this.originPos.copy(this.rawPosition);
    this.originQuatInv.copy(this.rawQuaternion).invert();
    this._recompute();
  }

  _recompute() {
    // Position relative to origin
    this.position.copy(this.rawPosition).sub(this.originPos);
    // Orientation relative to origin
    this.quaternion.copy(this.originQuatInv).multiply(this.rawQuaternion);
  }

  /** Snapshot for renderers. */
  getPose() {
    return {
      position: this.position.clone(),
      quaternion: this.quaternion.clone(),
    };
  }
}

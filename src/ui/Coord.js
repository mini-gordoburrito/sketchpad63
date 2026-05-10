// Coord — top-right HUD: live xyz read-out in cm.
export class Coord {
  /** @param {HTMLElement} el */
  constructor(el) { this.el = el; }
  update(pos) {
    const x = String(Math.round(pos.x * 100)).padStart(3, '0');
    const y = String(Math.round(pos.y * 100)).padStart(3, '0');
    const z = String(Math.round(pos.z * 100)).padStart(3, '0');
    this.el.textContent = `x:${x} y:${y} z:${z}`;
  }
}

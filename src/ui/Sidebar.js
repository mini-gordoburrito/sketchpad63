// Sidebar — single always-visible right-edge controller.
// Emits change events for: tool, ink, snap, mode, tracker, camera-start, joycon-connect, recenter.
// No drawer / peek / hover-collapse behavior.

export class Sidebar extends EventTarget {
  /** @param {HTMLElement} root — the #stage root (sidebar + canvas region live inside) */
  constructor(root) {
    super();
    this.root = root;
    this.sidebar = root.querySelector('[data-role="sidebar"]');
    if (!this.sidebar) throw new Error('Sidebar root not found');

    this._wireMode();
    this._wireTools();
    this._wireInk();
    this._wireSnap();
    this._wireTracker();
    this._wireActions();
  }

  _wireMode() {
    const segs = this.sidebar.querySelectorAll('[data-mode-set]');
    segs.forEach((btn) => {
      btn.addEventListener('click', () => {
        segs.forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        const mode = btn.dataset.modeSet; // '2d' | '3d'
        this.root.dataset.mode = mode;
        this.dispatchEvent(new CustomEvent('mode', { detail: { mode } }));
      });
    });
  }

  _wireTools() {
    const tools = this.sidebar.querySelectorAll('[data-tool]');
    tools.forEach((btn) => {
      btn.addEventListener('click', () => {
        tools.forEach((b) => {
          b.classList.remove('tool--active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('tool--active');
        btn.setAttribute('aria-pressed', 'true');
        this.dispatchEvent(new CustomEvent('tool', { detail: { tool: btn.dataset.tool } }));
      });
    });
  }

  _wireInk() {
    const swatches = this.sidebar.querySelectorAll('[data-ink]');
    swatches.forEach((btn) => {
      btn.addEventListener('click', () => {
        swatches.forEach((b) => {
          b.classList.remove('ink--active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('ink--active');
        btn.setAttribute('aria-pressed', 'true');
        this.dispatchEvent(new CustomEvent('ink', { detail: { ink: btn.dataset.ink } }));
      });
    });
  }

  _wireSnap() {
    const chips = this.sidebar.querySelectorAll('[data-snap]');
    chips.forEach((btn) => {
      btn.addEventListener('click', () => {
        const on = !btn.classList.contains('chip--active');
        btn.classList.toggle('chip--active', on);
        btn.setAttribute('aria-pressed', String(on));
        this.dispatchEvent(new CustomEvent('snap', {
          detail: { kind: btn.dataset.snap, on },
        }));
      });
    });
  }

  _wireTracker() {
    const radios = Array.from(this.sidebar.querySelectorAll('[data-tracker]'));
    const select = (btn) => {
      radios.forEach((b) => {
        b.classList.remove('radio--active');
        b.setAttribute('aria-checked', 'false');
        b.setAttribute('tabindex', '-1');
      });
      btn.classList.add('radio--active');
      btn.setAttribute('aria-checked', 'true');
      btn.setAttribute('tabindex', '0');
      btn.focus();
      this.dispatchEvent(new CustomEvent('tracker', { detail: { mode: btn.dataset.tracker } }));
    };
    radios.forEach((btn, i) => {
      btn.setAttribute('tabindex', btn.getAttribute('aria-checked') === 'true' ? '0' : '-1');
      btn.addEventListener('click', () => select(btn));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          select(radios[(i + 1) % radios.length]);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          select(radios[(i - 1 + radios.length) % radios.length]);
        }
      });
    });
  }

  _wireActions() {
    const cameraBtn = this.sidebar.querySelector('[data-action="camera-start"]');
    cameraBtn?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('camera-start'));
    });
    const joyBtn = this.sidebar.querySelector('[data-action="joycon-connect"]');
    joyBtn?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('joycon-connect'));
    });
    const recBtn = this.sidebar.querySelector('[data-action="recenter"]');
    recBtn?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('recenter'));
    });

    this.sensInput  = this.sidebar.querySelector('[data-action="sensitivity"]');
    this.sensOutput = this.sidebar.querySelector('#sensitivity-value');
    this.sensInput?.addEventListener('input', () => {
      const v = parseFloat(this.sensInput.value);
      this.setSensitivityValue(v);
      this.dispatchEvent(new CustomEvent('sensitivity', { detail: { sensitivity: v } }));
    });

    this.scopeCheck = this.sidebar.querySelector('[data-action="scope"]');
    this.scopeCheck?.addEventListener('change', () => {
      this.dispatchEvent(new CustomEvent('scope', { detail: { visible: this.scopeCheck.checked } }));
    });

    this.gridInput  = this.sidebar.querySelector('[data-action="grid-size"]');
    this.gridOutput = this.sidebar.querySelector('#grid-size-value');
    this.gridInput?.addEventListener('input', () => {
      const v = parseFloat(this.gridInput.value);
      this.setGridSizeValue(v);
      this.dispatchEvent(new CustomEvent('grid-size', { detail: { gridSize: v } }));
    });
  }

  /** Reflect a programmatic grid-size change in the slider + readout. */
  setGridSizeValue(v) {
    if (!this.gridInput) return;
    const clamped = Math.max(0.05, Math.min(2, Number(v) || 0.5));
    this.gridInput.value = String(clamped);
    if (this.gridOutput) this.gridOutput.textContent = clamped.toFixed(2);
  }

  /** Reflect a programmatic sensitivity change in the slider + readout. */
  setSensitivityValue(v) {
    if (!this.sensInput) return;
    const clamped = Math.max(0.25, Math.min(4, Number(v) || 1));
    this.sensInput.value = String(clamped);
    if (this.sensOutput) this.sensOutput.textContent = `${clamped.toFixed(2)}×`;
  }

  /** Reflect a programmatic scope-visibility toggle in the checkbox. */
  setScopeVisible(on) {
    if (!this.scopeCheck) return;
    this.scopeCheck.checked = !!on;
  }
}

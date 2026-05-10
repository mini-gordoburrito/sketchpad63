import { test, expect } from '@playwright/test';

test.describe('Sketchpad\'63 smoke', () => {
  let consoleErrors;

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('weberror', (err) => consoleErrors.push(String(err.error())));

    await page.goto('/');
    await page.waitForFunction(() => !!window.__app__);
  });

  test('1. app loads with no console errors', async ({ page }) => {
    const text = await page.locator('[data-role="watermark"]').textContent();
    expect(text).toContain("Sketchpad'63");
    expect(consoleErrors).toEqual([]);
  });

  test('2. tool dock has 5 tools and 6 ink swatches', async ({ page }) => {
    await expect(page.locator('[data-tool]')).toHaveCount(5);
    await expect(page.locator('[data-ink]')).toHaveCount(6);
  });

  test('3. mouse drag creates at least one stroke', async ({ page }) => {
    const stroke0 = await page.evaluate(() => window.__app__.strokeCount);
    expect(stroke0).toBe(0);

    const canvas = page.locator('#three-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');

    const startX = box.x + box.width * 0.4;
    const startY = box.y + box.height * 0.45;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(startX + i * 12, startY + Math.sin(i) * 6, { steps: 4 });
    }
    await page.mouse.up();

    const after = await page.evaluate(() => ({
      count: window.__app__.strokeCount,
      verts: window.__app__.vertexCount,
    }));
    expect(after.count).toBeGreaterThan(0);
    expect(after.verts).toBeGreaterThan(1);
  });

  test('4. changing ink color updates the active swatch', async ({ page }) => {
    const orange = page.locator('[data-ink="#FF5A1F"]');
    await orange.click({ force: true });
    await expect(orange).toHaveClass(/ink--active/);
    const ink = await page.evaluate(() => window.__app__.state.activeInk);
    expect(ink).toBe('#FF5A1F');
  });

  test('5. tracker toggle flips between Hands and Pose', async ({ page }) => {
    const hands = page.locator('#btn-tracker-hands');
    const pose = page.locator('#btn-tracker-pose');
    await expect(hands).toHaveAttribute('aria-checked', 'true');
    await pose.click({ force: true });
    await expect(pose).toHaveAttribute('aria-checked', 'true');
    await expect(hands).toHaveAttribute('aria-checked', 'false');
    await hands.click({ force: true });
    await expect(hands).toHaveAttribute('aria-checked', 'true');
  });

  test('6. cursor state can be set programmatically and reflected on the stage', async ({ page }) => {
    // We need to read the data-cursor-state immediately after setState, before the
    // next rAF tick where the snap-resolver could overwrite it. Do both calls in
    // the same evaluate() to keep them on a single microtask.
    const idleAttr = await page.evaluate(() => {
      window.__app__.cursor.setState('idle');
      return document.getElementById('stage').getAttribute('data-cursor-state');
    });
    expect(idleAttr).toBe('idle');

    const drawingAttr = await page.evaluate(() => {
      window.__app__.cursor.setState('drawing');
      return document.getElementById('stage').getAttribute('data-cursor-state');
    });
    expect(drawingAttr).toBe('drawing');

    const snapAttr = await page.evaluate(() => {
      window.__app__.cursor.setState('snap', { hit: { kind: 'edge', label: 'edge.04' } });
      return {
        state: document.getElementById('stage').getAttribute('data-cursor-state'),
        kind: document.getElementById('stage').getAttribute('data-snap-kind'),
        label: document.getElementById('stage').getAttribute('data-snap-label'),
      };
    });
    expect(snapAttr.state).toBe('snap');
    expect(snapAttr.kind).toBe('edge');
    expect(snapAttr.label).toBe('edge.04');
  });

  test('7. Joy-Con + camera buttons are wired and do not throw on click', async ({ page }) => {
    await page.locator('#btn-joycon').click({ force: true });
    await page.locator('#btn-camera').click({ force: true });
    await page.waitForTimeout(200);
    const fatal = consoleErrors.filter(
      (e) => !e.includes('[joycon]') && !e.includes('[camera]') && !e.includes('NotFoundError') && !e.includes('not allowed') && !e.includes('Permission'),
    );
    expect(fatal).toEqual([]);
  });

  test('8. recenter button fires without error', async ({ page }) => {
    await page.locator('#btn-recenter').click({ force: true });
    await page.waitForTimeout(50);
    const fatal = consoleErrors.filter((e) => !e.includes('[joycon]') && !e.includes('[camera]'));
    expect(fatal).toEqual([]);
  });

  // ── New tests ──

  test('9. sidebar is always visible and stable on hover-out', async ({ page }) => {
    const sidebar = page.locator('[data-role="sidebar"]');
    const box1 = await sidebar.boundingBox();
    expect(box1).not.toBeNull();
    expect(box1.width).toBeGreaterThan(200);
    // Hover off it
    await page.mouse.move(10, 10);
    await page.waitForTimeout(150);
    const box2 = await sidebar.boundingBox();
    expect(box2).not.toBeNull();
    expect(Math.round(box2.x)).toBe(Math.round(box1.x));
    expect(Math.round(box2.width)).toBe(Math.round(box1.width));
  });

  test('10. drawer markup is gone', async ({ page }) => {
    const drawerCount = await page.evaluate(() => document.querySelectorAll('[data-drawer]').length);
    expect(drawerCount).toBe(0);
    const drawerCls = await page.evaluate(() => document.querySelectorAll('.drawer').length);
    expect(drawerCls).toBe(0);
  });

  test('11. 2D toggle sets stage data-mode and aria-pressed', async ({ page }) => {
    const stage = page.locator('#stage');
    const seg2d = page.locator('[data-mode-set="2d"]');
    const seg3d = page.locator('[data-mode-set="3d"]');
    await expect(stage).toHaveAttribute('data-mode', '3d');
    await expect(seg3d).toHaveAttribute('aria-pressed', 'true');

    await seg2d.click({ force: true });
    await expect(stage).toHaveAttribute('data-mode', '2d');
    await expect(seg2d).toHaveAttribute('aria-pressed', 'true');
    await expect(seg3d).toHaveAttribute('aria-pressed', 'false');
  });

  test('12. grid snap rounds to multiples of 0.5', async ({ page }) => {
    const result = await page.evaluate(() => {
      const s = window.__app__.snap;
      // Disable other snaps so grid is tested in isolation
      s.setEnabled('vertex', false);
      s.setEnabled('edge', false);
      s.setEnabled('parallel', false);
      s.setEnabled('grid', true);
      // Pick a point well inside the (relaxed) grid window — within ~1/3 of a cell.
      const hit = s.resolve({ x: 1.45, y: 0.55, z: 0 });
      return hit ? { kind: hit.kind, point: hit.point } : null;
    });
    expect(result).not.toBeNull();
    expect(result.kind).toBe('grid');
    // x:1.45 → 1.5, y:0.55 → 0.5
    expect(Math.abs(result.point.x % 0.5)).toBeLessThan(1e-6);
    expect(Math.abs(result.point.y % 0.5)).toBeLessThan(1e-6);
    expect(result.point.x).toBeCloseTo(1.5, 6);
    expect(result.point.y).toBeCloseTo(0.5, 6);
  });

  test('13. edge snap finds the nearest point on a horizontal segment', async ({ page }) => {
    const result = await page.evaluate(() => {
      const app = window.__app__;
      app.testHook.addStroke('#1A1814', [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ]);
      // vertex would also fire at endpoints; make sure mid-segment hit is edge
      const hit = app.snap.resolve({ x: 2.5, y: 0.05, z: 0 });
      return hit ? { type: hit.type, point: hit.point, segmentId: hit.segmentId } : null;
    });
    expect(result).not.toBeNull();
    expect(result.type).toBe('edge');
    expect(result.point.x).toBeCloseTo(2.5, 6);
    expect(result.point.y).toBeCloseTo(0, 6);
    expect(result.point.z).toBeCloseTo(0, 6);
  });

  test('14. parallel snap locks a near-parallel direction to an existing segment', async ({ page }) => {
    const result = await page.evaluate(() => {
      const app = window.__app__;
      // Existing horizontal segment establishes a reference axis along +X.
      app.testHook.addStroke('#1A1814', [
        { x: -2, y: 1.2, z: 0 },
        { x: 2, y: 1.2, z: 0 },
      ]);
      // Isolate parallel
      app.snap.setEnabled('vertex', false);
      app.snap.setEnabled('edge', false);
      app.snap.setEnabled('parallel', true);
      app.snap.setEnabled('grid', false);

      // Stroke being drawn — direction is 88° away from the existing segment's
      // perpendicular (i.e. 2° off horizontal). 2° is well within the 5° threshold,
      // so parallel snap should fire and lock the cursor's projection onto +X.
      const offsetFromHoriz = (2 * Math.PI) / 180; // 2° off horizontal
      const dir = { x: Math.cos(offsetFromHoriz), y: Math.sin(offsetFromHoriz), z: 0 };
      const start = { x: 0, y: 0, z: 0 };
      const cursor = { x: 1.0, y: Math.tan(offsetFromHoriz) * 1.0, z: 0 };

      const hit = app.snap.resolve(cursor, { direction: dir, strokeStart: start });
      return hit
        ? { kind: hit.kind, type: hit.type, point: hit.point, angleDeg: (hit.angle * 180 / Math.PI) }
        : null;
    });
    expect(result).not.toBeNull();
    expect(result.kind).toBe('parallel');
    // Locked direction is along +X; projection of (1, ~0.035, 0) from origin onto +X ≈ x=1, y=0
    expect(result.point.y).toBeCloseTo(0, 5);
    expect(result.point.x).toBeCloseTo(1.0, 3);
  });

  test('15. fonts loaded — Pixelify Sans 700 + Geist Mono 400 are ready', async ({ page }) => {
    const ready = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        pixelify: document.fonts.check('700 24px "Pixelify Sans"'),
        geistMono: document.fonts.check('400 16px "Geist Mono"'),
        geist: document.fonts.check('400 15px "Geist"'),
      };
    });
    expect(ready.pixelify).toBe(true);
    expect(ready.geistMono).toBe(true);
    expect(ready.geist).toBe(true);
  });

  // ── New tests (16-24) — tool implementations + cursor rework ──

  test('16. mascot is removed', async ({ page }) => {
    const mascotCount = await page.evaluate(() => document.querySelectorAll('.mascot').length);
    expect(mascotCount).toBe(0);
    const mascotById = await page.evaluate(() => document.getElementById('mascot'));
    expect(mascotById).toBeNull();
  });

  test('17. line tool: click → move → click commits a 2-sample stroke', async ({ page }) => {
    const before = await page.evaluate(() => window.__app__.testHook.getStrokeCount());

    const canvas = page.locator('#three-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');

    // Activate the line tool through the sidebar
    await page.locator('[data-tool="line"]').click({ force: true });

    const x1 = box.x + 200, y1 = box.y + 200;
    const x2 = box.x + 300, y2 = box.y + 300;
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(x2, y2);
    await page.mouse.down();
    await page.mouse.up();

    const after = await page.evaluate(() => ({
      count: window.__app__.testHook.getStrokeCount(),
      verts: window.__app__.vertexCount,
    }));
    expect(after.count).toBe(before + 1);
    // Last stroke should have exactly 2 samples.
    const lastLen = await page.evaluate(() => {
      const s = window.__app__.strokes;
      return s.strokes[s.strokes.length - 1].length;
    });
    expect(lastLen).toBe(2);
  });

  test('18. line tool Escape cancels the anchor — no stroke added', async ({ page }) => {
    const before = await page.evaluate(() => window.__app__.testHook.getStrokeCount());

    const canvas = page.locator('#three-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');

    await page.locator('[data-tool="line"]').click({ force: true });
    await page.mouse.move(box.x + 220, box.y + 220);
    await page.mouse.down();
    await page.mouse.up();
    // Hit Escape without second click
    await page.keyboard.press('Escape');

    const after = await page.evaluate(() => ({
      count: window.__app__.testHook.getStrokeCount(),
      anchor: window.__app__.state.line.anchor,
    }));
    expect(after.count).toBe(before);
    expect(after.anchor).toBeNull();
  });

  test('19. polygon tool: 4 vertices + close-radius click → closed 5-sample stroke', async ({ page }) => {
    const before = await page.evaluate(() => window.__app__.testHook.getStrokeCount());

    const canvas = page.locator('#three-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');

    await page.locator('[data-tool="polygon"]').click({ force: true });
    // Use 2D mode so world distances are predictable: ortho with halfH=2
    // → 1 pixel ≈ 4 / canvas_height world units, polygon close radius is 0.5.
    // We pick 4 corners that are >= 60 px apart from v0 in world distance
    // (well outside the 0.5 close-radius), then click within 1 px of v0 to close.
    await page.locator('[data-mode-set="2d"]').click({ force: true });

    // Placement via simulateClickAt to avoid any dblclick / native quirks.
    await page.evaluate(() => {
      const t = window.__app__.testHook;
      t.simulateClickAt(200, 200); // v0
      t.simulateClickAt(360, 200); // v1
      t.simulateClickAt(360, 360); // v2
      t.simulateClickAt(200, 360); // v3
      t.simulateClickAt(201, 201); // close (within close-radius of v0)
    });

    const after = await page.evaluate(() => ({
      count: window.__app__.testHook.getStrokeCount(),
      lastLen: (() => {
        const s = window.__app__.strokes;
        return s.strokes[s.strokes.length - 1].length;
      })(),
    }));
    expect(after.count).toBe(before + 1);
    expect(after.lastLen).toBe(5);

    // Last sample should equal the first sample (closed polygon).
    const sameEndpoint = await page.evaluate(() => {
      const s = window.__app__.strokes;
      const stroke = s.strokes[s.strokes.length - 1];
      const arr = stroke.geometry.attributes.position.array;
      const n = stroke.length;
      const a = { x: arr[0], y: arr[1], z: arr[2] };
      const b = { x: arr[(n - 1) * 3], y: arr[(n - 1) * 3 + 1], z: arr[(n - 1) * 3 + 2] };
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;
    });
    expect(sameEndpoint).toBe(true);
  });

  test('20. polygon Enter to close: 3 clicks + Enter → 4-sample closed stroke', async ({ page }) => {
    const before = await page.evaluate(() => window.__app__.testHook.getStrokeCount());

    const canvas = page.locator('#three-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');

    await page.locator('[data-tool="polygon"]').click({ force: true });

    const triPoints = [[260, 240], [360, 240], [310, 320]];
    for (const [x, y] of triPoints) {
      await page.mouse.move(box.x + x, box.y + y);
      await page.mouse.down();
      await page.mouse.up();
    }
    await page.keyboard.press('Enter');

    const after = await page.evaluate(() => ({
      count: window.__app__.testHook.getStrokeCount(),
      lastLen: (() => {
        const s = window.__app__.strokes;
        return s.strokes[s.strokes.length - 1].length;
      })(),
    }));
    expect(after.count).toBe(before + 1);
    expect(after.lastLen).toBe(4);
  });

  test('21. eraser: drag near a stroke removes it', async ({ page }) => {
    // Add a stroke at world (0, 0, 0) → (1, 0, 0)
    await page.evaluate(() => {
      window.__app__.testHook.addStroke('#FF5A1F', [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]);
    });
    const before = await page.evaluate(() => window.__app__.testHook.getStrokeCount());
    expect(before).toBeGreaterThan(0);

    // Switch to eraser tool
    await page.locator('[data-tool="eraser"]').click({ force: true });

    // The orthographic 2D camera is the simple one: world (0,0,0) maps to canvas center.
    // Switch to 2D so the projection is predictable for the test.
    await page.locator('[data-mode-set="2d"]').click({ force: true });

    const canvas = page.locator('#three-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');

    // World (0,0,0) → screen center; world (1,0,0) → screen (cx + halfW/2, cy)
    // Drag from center horizontally rightward. Either spot eraser-radius covers
    // some part of the stroke.
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 20, cy, { steps: 4 });
    await page.mouse.up();

    const after = await page.evaluate(() => window.__app__.testHook.getStrokeCount());
    expect(after).toBe(before - 1);
  });

  test('22. cursor overlay reflects active tool via [data-cursor-tool]', async ({ page }) => {
    const overlay = page.locator('[data-role="cursor-overlay"]');
    await expect(overlay).toHaveAttribute('data-cursor-tool', 'pencil');

    await page.locator('[data-tool="line"]').click({ force: true });
    await expect(overlay).toHaveAttribute('data-cursor-tool', 'line');

    await page.locator('[data-tool="eraser"]').click({ force: true });
    await expect(overlay).toHaveAttribute('data-cursor-tool', 'eraser');

    await page.locator('[data-tool="polygon"]').click({ force: true });
    await expect(overlay).toHaveAttribute('data-cursor-tool', 'polygon');

    await page.locator('[data-tool="hand"]').click({ force: true });
    await expect(overlay).toHaveAttribute('data-cursor-tool', 'hand');
  });

  test('23. no 3D pencil/cursor mesh in the scene graph', async ({ page }) => {
    const result = await page.evaluate(() => {
      const sceneObj = window.__app__.testHook.scene.scene;
      const byPencil = sceneObj.getObjectByName('cursor-pencil');
      const byCursor = sceneObj.getObjectByName('cursor');
      return { byPencil: byPencil || null, byCursor: byCursor || null };
    });
    expect(result.byPencil).toBeNull();
    expect(result.byCursor).toBeNull();
  });

  test('24. setTool helper + simulateClickAt round-trip work for line tool', async ({ page }) => {
    const before = await page.evaluate(() => window.__app__.testHook.getStrokeCount());

    await page.evaluate(() => {
      const t = window.__app__.testHook;
      t.setTool('line');
      t.simulateClickAt(220, 220);
      t.simulateClickAt(320, 280);
    });

    const after = await page.evaluate(() => ({
      count: window.__app__.testHook.getStrokeCount(),
      lastLen: (() => {
        const s = window.__app__.strokes;
        return s.strokes[s.strokes.length - 1]?.length ?? 0;
      })(),
    }));
    expect(after.count).toBe(before + 1);
    expect(after.lastLen).toBe(2);
  });

  test('25. keyboard: pressing 2 selects the line tool', async ({ page }) => {
    await page.evaluate(() => window.__app__.testHook.setTool('pencil'));
    await page.keyboard.press('2');
    const tool = await page.evaluate(() => window.__app__.state.activeTool);
    expect(tool).toBe('line');
  });

  test('26. keyboard: Z undoes the last stroke', async ({ page }) => {
    await page.evaluate(() => {
      window.__app__.testHook.addStroke('#1A1814', [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      ]);
    });
    const before = await page.evaluate(() => window.__app__.testHook.getStrokeCount());
    await page.keyboard.press('z');
    const after = await page.evaluate(() => window.__app__.testHook.getStrokeCount());
    expect(after).toBe(before - 1);
  });

  test('27. keyboard: WASD pans the camera-mapping scope (pose offset, not the scene view)', async ({ page }) => {
    const before = await page.evaluate(() => {
      window.__app__.pose.setOffset(0, 0);
      const p = window.__app__.scene.cameraPersp.position;
      window.__app__.state.lastFrameTs = 0;
      return { offsetX: window.__app__.pose.offsetX, offsetY: window.__app__.pose.offsetY, camX: p.x, camY: p.y };
    });
    await page.keyboard.down('d');
    await page.waitForTimeout(180);
    await page.keyboard.up('d');
    await page.waitForTimeout(50);
    const after = await page.evaluate(() => {
      const p = window.__app__.scene.cameraPersp.position;
      return { offsetX: window.__app__.pose.offsetX, offsetY: window.__app__.pose.offsetY, camX: p.x, camY: p.y };
    });
    // Pose mapping offset should slide in +X; the scene camera should not move.
    expect(after.offsetX).toBeGreaterThan(before.offsetX + 0.05);
    expect(Math.abs(after.camX - before.camX)).toBeLessThan(1e-6);
    expect(Math.abs(after.camY - before.camY)).toBeLessThan(1e-6);
  });

  test('29. sensitivity: setSensitivity scales mapping bounds linearly', async ({ page }) => {
    const result = await page.evaluate(() => {
      const p = window.__app__.pose;
      p.setSensitivity(1);
      const b1 = p.getMappingBounds();
      p.setSensitivity(2);
      const b2 = p.getMappingBounds();
      return {
        widthAt1: b1.maxX - b1.minX,
        widthAt2: b2.maxX - b2.minX,
        heightAt1: b1.maxY - b1.minY,
        heightAt2: b2.maxY - b2.minY,
      };
    });
    expect(result.widthAt2 / result.widthAt1).toBeCloseTo(2, 4);
    expect(result.heightAt2 / result.heightAt1).toBeCloseTo(2, 4);
  });

  test('30. sensitivity slider in sidebar updates pose.sensitivity', async ({ page }) => {
    const slider = page.locator('#sensitivity');
    await slider.evaluate((el) => { el.value = '2.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const sens = await page.evaluate(() => window.__app__.pose.sensitivity);
    expect(sens).toBeCloseTo(2.5, 6);
  });

  test('31. scope wireframe: G key toggles visibility', async ({ page }) => {
    const before = await page.evaluate(() => window.__app__.scene.isScopeVisible());
    await page.keyboard.press('g');
    const mid = await page.evaluate(() => window.__app__.scene.isScopeVisible());
    await page.keyboard.press('g');
    const after = await page.evaluate(() => window.__app__.scene.isScopeVisible());
    expect(mid).toBe(!before);
    expect(after).toBe(before);
  });

  test('32. world mapping is faster: same landmark moves the cursor twice as far as v0.1 with sensitivity 1', async ({ page }) => {
    const dx = await page.evaluate(() => {
      const Pose = window.__app__.pose.constructor;
      // v0.1 mapped lm.x=0.0 → +0.8 world (gain 1.6); we expect +1.6 now.
      const p = Pose.computeWorldFromLandmark({ x: 0, y: 0.5, z: 0 });
      return p.x;
    });
    expect(dx).toBeCloseTo(1.6, 4);
  });

  test('33. pose offset shifts mapping bounds without changing their size', async ({ page }) => {
    const result = await page.evaluate(() => {
      const p = window.__app__.pose;
      p.setSensitivity(1);
      p.setOffset(0, 0);
      const b0 = p.getMappingBounds();
      p.setOffset(0.5, -0.25);
      const b1 = p.getMappingBounds();
      return {
        widthBefore: b0.maxX - b0.minX, widthAfter: b1.maxX - b1.minX,
        heightBefore: b0.maxY - b0.minY, heightAfter: b1.maxY - b1.minY,
        centerXBefore: (b0.minX + b0.maxX) / 2, centerXAfter: (b1.minX + b1.maxX) / 2,
        centerYBefore: (b0.minY + b0.maxY) / 2, centerYAfter: (b1.minY + b1.maxY) / 2,
      };
    });
    // Size unchanged; centers shifted by exactly the offset
    expect(result.widthAfter).toBeCloseTo(result.widthBefore, 6);
    expect(result.heightAfter).toBeCloseTo(result.heightBefore, 6);
    expect(result.centerXAfter - result.centerXBefore).toBeCloseTo(0.5, 6);
    expect(result.centerYAfter - result.centerYBefore).toBeCloseTo(-0.25, 6);
  });

  test('34. keyboard mode: data-keyboard-mode is true by default (no Joy-Con paired)', async ({ page }) => {
    const mode = await page.evaluate(() => document.body.dataset.keyboardMode);
    expect(mode).toBe('true');
  });

  test('41. pointerToWorld in 3D follows the orbited work plane (clicks can land at non-zero Z)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const s = window.__app__.scene;
      s.setMode('3d');
      // Orbit the camera so the view direction is significantly off the Z axis.
      // Move camera up + forward so view direction has a notable Y component.
      s.cameraPersp.position.set(0, 3, 3);
      s.cameraPersp.lookAt(s.controls.target);
      s.controls.update();
      // 2D-mode work plane would always give z=0. The 3D work plane is now
      // perpendicular to camera direction through controls.target, so a click
      // away from the screen centre lands at a point with non-zero Z.
      const rect = s.canvas.getBoundingClientRect();
      // Pick a point off-centre so the ray doesn't pass through the orbit target
      const cx = rect.left + rect.width * 0.25;
      const cy = rect.top + rect.height * 0.25;
      const w = s.pointerToWorld(cx, cy);
      return { x: w.x, y: w.y, z: w.z };
    });
    // We can't predict exact numbers (depends on canvas size + camera), but Z
    // must be measurably non-zero now that the work plane tracks the view.
    expect(Math.abs(result.z)).toBeGreaterThan(0.05);
  });

  test('39. OrbitControls is wired in 3D mode and disabled in 2D mode', async ({ page }) => {
    const result = await page.evaluate(() => {
      const s = window.__app__.scene;
      // Force 3D first
      s.setMode('3d');
      const r3d = { enabled: s.controls.enabled, hasTarget: !!s.controls.target };
      s.setMode('2d');
      const r2d = { enabled: s.controls.enabled };
      s.setMode('3d');
      return { r3d, r2d };
    });
    expect(result.r3d.enabled).toBe(true);
    expect(result.r3d.hasTarget).toBe(true);
    expect(result.r2d.enabled).toBe(false);
  });

  test('40. hand tool flips LEFT button to orbit; pencil keeps LEFT for drawing', async ({ page }) => {
    const result = await page.evaluate(() => {
      const t = window.__app__.testHook;
      const s = window.__app__.scene;
      t.setTool('hand');
      const onHand = s.controls.mouseButtons.LEFT;
      t.setTool('pencil');
      const onPencil = s.controls.mouseButtons.LEFT;
      return { onHand, onPencil };
    });
    // THREE.MOUSE.ROTATE === 0 in three; null when disabled
    expect(result.onHand).not.toBeNull();
    expect(result.onPencil).toBeNull();
  });

  test('38. grid snap is per-axis: Z snaps independently when X / Y are off-grid', async ({ page }) => {
    const result = await page.evaluate(() => {
      const s = window.__app__.snap;
      s.setEnabled('vertex', false);
      s.setEnabled('edge', false);
      s.setEnabled('parallel', false);
      s.setEnabled('grid', true);
      s.setGridSize(0.5);
      // Point far from any X/Y grid line, but exactly on a Z grid line (z=0.5)
      const hit = s.resolve({ x: 0.31, y: 0.27, z: 0.49 });
      return hit ? { kind: hit.kind, p: hit.point, axes: hit.axes } : null;
    });
    expect(result).not.toBeNull();
    expect(result.kind).toBe('grid');
    // Z must have snapped to 0.5; X and Y stay where they were (off-grid).
    expect(result.p.z).toBeCloseTo(0.5, 6);
    expect(result.axes.z).toBe(true);
    expect(result.axes.x).toBe(false);
    expect(result.axes.y).toBe(false);
    expect(result.p.x).toBeCloseTo(0.31, 6);
    expect(result.p.y).toBeCloseTo(0.27, 6);
  });

  test('36. dot-grid renders a window of points around the cursor (not a GridHelper)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const sceneObj = window.__app__.scene.scene;
      // No legacy GridHelper line groups should remain
      const gridHelpers = [];
      sceneObj.traverse((o) => {
        if (o.type === 'GridHelper' || o.name === 'grid3D' || o.name === 'grid2D') gridHelpers.push(o);
      });
      const dots = sceneObj.getObjectByName('dot-grid');
      const drawCount = dots ? dots.geometry.drawRange.count : 0;
      return { gridHelperCount: gridHelpers.length, hasDots: !!dots, drawCount };
    });
    expect(result.gridHelperCount).toBe(0);
    expect(result.hasDots).toBe(true);
    // 11 × 11 × 11 = 1331 dots in 3D mode
    expect(result.drawCount).toBeGreaterThan(100);
    expect(result.drawCount).toBeLessThanOrEqual(11 * 11 * 11);
  });

  test('37. grid-size slider drives both Snap and DotGrid', async ({ page }) => {
    const slider = page.locator('#grid-size');
    await slider.evaluate((el) => { el.value = '0.25'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const result = await page.evaluate(() => ({
      snap: window.__app__.snap.gridSize,
      dot:  window.__app__.scene.dotGrid.gridSize,
    }));
    expect(result.snap).toBeCloseTo(0.25, 6);
    expect(result.dot).toBeCloseTo(0.25, 6);
  });

  test('35. shortcut hints exist on every tool button', async ({ page }) => {
    const labels = await page.evaluate(() => Array.from(
      document.querySelectorAll('.tool .tool__kbd')
    ).map((el) => el.textContent.trim()));
    expect(labels).toEqual(['1', '2', '3', '4', '5']);
  });

  test('28. shift-line: drag with Shift held collapses the stroke to 2 samples', async ({ page }) => {
    await page.evaluate(() => window.__app__.testHook.setTool('pencil'));
    const canvas = await page.locator('#three-canvas').boundingBox();
    const cx = canvas.x + 100;
    const cy = canvas.y + 100;
    // Drag freehand with Shift held the entire time
    await page.keyboard.down('Shift');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 50, cy + 30, { steps: 6 });
    await page.mouse.move(cx + 100, cy + 60, { steps: 6 });
    await page.mouse.move(cx + 200, cy + 80, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    // Allow the render loop to flush
    await page.waitForTimeout(50);
    const len = await page.evaluate(() => {
      const s = window.__app__.strokes;
      return s.strokes[s.strokes.length - 1]?.length ?? 0;
    });
    // shift-line collapses every freehand sample down to start + current
    expect(len).toBe(2);
  });
});

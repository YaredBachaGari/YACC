// Integer-zoom camera over the world container: drag to pan, wheel to zoom,
// eased fly-to. Positions are rounded so pixels stay crisp.

import type { Container } from "pixi.js";

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
// Zoom moves in steps of 1/devicePixelRatio, so zoom × dpr is always a whole
// number and every art pixel covers whole device pixels (1.5x is crisp on Retina).
const DPR = Math.max(1, Math.round(window.devicePixelRatio || 1));
const STEP = 1 / DPR;
const snapZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z / STEP) * STEP));
const snapPx = (v: number) => Math.round(v * DPR) / DPR;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

interface Flight {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  t: number;
  dur: number;
}

export class Camera {
  zoom = 2;
  x = 0; // world point at the centre of the free area
  y = 0;
  worldW = 1;
  worldH = 1;
  private flight: Flight | null = null;

  constructor(
    private world: Container,
    private viewport: () => { w: number; h: number },
    private insets: () => Insets,
    private reducedMotion: () => boolean,
  ) {}

  setWorldSize(w: number, h: number) {
    this.worldW = w;
    this.worldH = h;
  }

  /** Zoom that shows the whole office in the free area. */
  fitZoom(): number {
    const { w, h } = this.viewport();
    const i = this.insets();
    const fw = Math.max(100, w - i.left - i.right);
    const fh = Math.max(100, h - i.top - i.bottom);
    // Let the lawn margin crop a little so we land on a bigger step.
    const ratio = Math.min(fw / this.worldW, fh / this.worldH) + 0.2;
    return snapZoom(Math.floor(ratio / STEP) * STEP);
  }

  home(animate = true) {
    this.flyTo(this.worldW / 2, this.worldH / 2, this.fitZoom(), animate);
  }

  flyTo(x: number, y: number, zoom = this.zoom, animate = true) {
    const z = snapZoom(zoom);
    if (!animate || this.reducedMotion()) {
      this.flight = null;
      Object.assign(this, { x, y, zoom: z });
      this.apply();
      return;
    }
    this.flight = { from: { x: this.x, y: this.y, z: this.zoom }, to: { x, y, z }, t: 0, dur: 0.7 };
  }

  /** `delta` is in steps (+1 = one step closer). */
  zoomBy(delta: number, anchor?: { x: number; y: number }) {
    const z = snapZoom(this.zoom + delta * STEP);
    if (z === this.zoom) return;
    this.flight = null;
    if (anchor) {
      // Keep the world point under the cursor fixed.
      const before = this.screenToWorld(anchor.x, anchor.y);
      this.zoom = z;
      const after = this.screenToWorld(anchor.x, anchor.y);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
    } else this.zoom = z;
    this.apply();
  }

  panBy(dxScreen: number, dyScreen: number) {
    this.flight = null;
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.apply();
  }

  update(dt: number) {
    const f = this.flight;
    if (!f) return;
    f.t = Math.min(1, f.t + dt / f.dur);
    const e = easeInOut(f.t);
    this.x = f.from.x + (f.to.x - f.from.x) * e;
    this.y = f.from.y + (f.to.y - f.from.y) * e;
    // Zoom snaps at the middle of the flight so it stays on a step.
    this.zoom = f.t < 0.5 ? f.from.z : f.to.z;
    if (f.t >= 1) this.flight = null;
    this.apply();
  }

  private centre() {
    const { w, h } = this.viewport();
    const i = this.insets();
    return { cx: i.left + (w - i.left - i.right) / 2, cy: i.top + (h - i.top - i.bottom) / 2 };
  }

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.world.x) / this.zoom, y: (sy - this.world.y) / this.zoom };
  }

  worldToScreen(wx: number, wy: number) {
    return { x: wx * this.zoom + this.world.x, y: wy * this.zoom + this.world.y };
  }

  apply() {
    // Keep at least part of the office on screen.
    const m = 60;
    this.x = Math.max(-m, Math.min(this.worldW + m, this.x));
    this.y = Math.max(-m, Math.min(this.worldH + m, this.y));
    const { cx, cy } = this.centre();
    this.world.scale.set(this.zoom);
    this.world.position.set(snapPx(cx - this.x * this.zoom), snapPx(cy - this.y * this.zoom));
  }
}

// Furniture and decor drawn once into the static layer.

import { text, textW } from "../engine/font";
import { C } from "../engine/palette";
import { box, disc, ellipse, type Pen } from "../engine/pen";

export function plant(p: Pen, cx: number, baseY: number, big = true) {
  const r = big ? 7 : 5;
  p.rect(cx - 4, baseY - 7, 9, 7, C.ink);
  p.rect(cx - 3, baseY - 6, 7, 5, C.pot);
  p.rect(cx - 3, baseY - 6, 7, 1, "#d4704f");
  p.rect(cx + 2, baseY - 5, 1, 4, C.potD);
  disc(p, cx, baseY - 7 - r, r + 1, C.ink);
  disc(p, cx, baseY - 7 - r, r, C.leafD);
  disc(p, cx - 1, baseY - 8 - r, r - 2, C.leaf);
  p.rect(cx - 3, baseY - 10 - r, 2, 2, C.leafL);
  p.rect(cx + 2, baseY - 6 - r, 1, 2, C.leafL);
}

export function tree(p: Pen, x: number, y: number, r: number) {
  ellipse(p, x + 3, y + r - 1, r, 4, C.shadow, 0.25);
  p.rect(x - 2, y + r - 9, 5, 9, C.ink);
  p.rect(x - 1, y + r - 9, 3, 8, "#7a4a2a");
  disc(p, x, y, r + 1, C.ink);
  disc(p, x, y, r, C.leafD);
  disc(p, x - 2, y - 2, r - 3, C.leaf);
  disc(p, x - 5, y - 5, 3, C.leafL);
  p.rect(x + 4, y + 2, 2, 2, C.leafL);
}

export function beanbag(p: Pen, cx: number, cy: number, col: string, dark: string) {
  ellipse(p, cx + 1, cy + 5, 7, 2, C.shadow, 0.25);
  ellipse(p, cx, cy, 7, 6, C.ink);
  ellipse(p, cx, cy, 6, 5, col);
  ellipse(p, cx - 2, cy - 2, 2, 1, "#ffffff", 0.33);
  p.rect(cx - 4, cy + 2, 8, 2, dark);
}

export function monitorFrame(p: Pen, mx: number, my: number) {
  box(p, mx, my, 22, 15, C.bezel);
  p.rect(mx + 2, my + 2, 18, 11, C.screen);
  p.rect(mx + 9, my + 15, 4, 3, C.metalD);
  p.rect(mx + 6, my + 18, 10, 1, C.metalDD);
}

export function plate(p: Pen, label: string, cx: number, y: number) {
  const w = textW(label);
  box(p, Math.round(cx - w / 2) - 3, y, w + 6, 8, C.white);
  text(p, label, Math.round(cx - w / 2), y + 1, C.ink);
}

/** Desk with a monitor, keyboard and mug. `dx, dy` = top-left of the desk area. */
export function workDesk(p: Pen, dx: number, dy: number, prop: number) {
  p.rect(dx + 1, dy + 26, 46, 4, C.shadow, 0.25);
  box(p, dx, dy + 4, 48, 18, C.desk);
  p.rect(dx + 1, dy + 5, 46, 1, C.woodL);
  box(p, dx, dy + 20, 48, 7, C.deskD);
  p.rect(dx + 2, dy + 26, 3, 4, C.deskDD);
  p.rect(dx + 43, dy + 26, 3, 4, C.deskDD);
  box(p, dx + 15, dy + 14, 18, 4, C.metal);
  for (let x = dx + 17; x < dx + 31; x += 3) p.rect(x, dy + 15, 2, 1, C.metalD);
  box(p, dx + 37, dy + 9, 5, 6, C.white);
  p.rect(dx + 42, dy + 11, 1, 2, C.ink);
  if (prop % 3 === 0) {
    // rubber duck
    p.rect(dx + 5, dy + 9, 5, 4, C.yellow);
    p.rect(dx + 8, dy + 8, 3, 2, C.yellow);
    p.rect(dx + 11, dy + 9, 2, 1, C.orange);
    p.rect(dx + 9, dy + 8, 1, 1, C.ink);
  } else if (prop % 3 === 1) {
    // small plant
    box(p, dx + 4, dy + 11, 7, 5, C.pot);
    p.rect(dx + 6, dy + 5, 3, 6, C.leaf);
    p.rect(dx + 5, dy + 7, 1, 2, C.leaf);
    p.rect(dx + 9, dy + 6, 1, 2, C.leaf);
    p.rect(dx + 7, dy + 4, 1, 1, C.pink);
  } else {
    // book stack
    p.rect(dx + 4, dy + 12, 8, 2, C.red);
    p.rect(dx + 5, dy + 10, 7, 2, C.blue);
    p.rect(dx + 4, dy + 8, 7, 2, C.green);
  }
  monitorFrame(p, dx + 13, dy - 6);
}

/** Cubicle partitions: two sides and a top with a door gap at tile 1. */
export function partitions(p: Pen, X: number, Y: number, tiles: number) {
  for (const col of [0, tiles - 1]) {
    const cx = X + col * 16 + 8;
    p.rect(cx - 3, Y, 6, tiles * 16 + 4, C.ink);
    p.rect(cx - 2, Y + 1, 4, tiles * 16 - 4, C.part);
    p.rect(cx - 2, Y + 1, 2, tiles * 16 - 4, C.partCap);
    p.rect(cx - 2, Y + tiles * 16 - 3, 4, 6, C.partD);
  }
  for (let t = 0; t < tiles; t++) {
    if (t === 1) continue;
    const x = X + t * 16;
    p.rect(x, Y - 1, 16, 1, C.ink);
    p.rect(x, Y, 16, 3, C.partCap);
    p.rect(x, Y + 3, 16, 10, C.part);
    p.rect(x, Y + 13, 16, 2, C.partD);
    p.rect(x, Y + 15, 16, 1, C.ink);
    p.rect(x + 15, Y + 3, 1, 10, C.partD);
  }
  const gx = X + 16;
  p.rect(gx - 1, Y - 1, 2, 17, C.ink);
  p.rect(gx + 15, Y - 1, 2, 17, C.ink);
}

export function rackBody(p: Pen, x: number, y: number, h: number, label: string) {
  p.rect(x + 1, y + h - 1, 30, 3, "#000000", 0.3);
  box(p, x + 1, y, 30, h, "#2a2833");
  p.rect(x + 2, y + 1, 1, h - 2, "#3d3a48");
  p.rect(x + 28, y + 1, 2, h - 2, "#1f1d26");
  for (let i = 0; i < 8; i++) {
    const yy = y + 12 + i * 10;
    p.rect(x + 4, yy, 23, 8, "#36333f");
    p.rect(x + 4, yy + 8, 23, 1, "#1f1d26");
    p.rect(x + 6, yy + 3, 8, 1, "#4c4858");
  }
  const nm = label.toUpperCase().slice(0, 6);
  box(p, x + 16 - textW(nm) / 2 - 3, y + 3, textW(nm) + 6, 8, C.white);
  text(p, nm, x + 16 - textW(nm) / 2, y + 4, C.ink);
}

export function easel(p: Pen, x: number, y: number, w: number, h: number, title: string, seed: () => number) {
  p.rect(x + 4, y + h - 2, 3, 30, C.deskDD);
  p.rect(x + w - 7, y + h - 2, 3, 30, C.deskDD);
  p.rect(x + 6, y + h + 26, w - 12, 2, C.shadow, 0.25);
  box(p, x, y, w, h, C.corkD);
  p.rect(x + 2, y + 2, w - 4, h - 4, C.cork);
  for (let i = 0; i < 40; i++) p.rect(x + 3 + Math.floor(seed() * (w - 6)), y + 9 + Math.floor(seed() * (h - 12)), 1, 1, C.corkD);
  p.rect(x + 2, y + 2, w - 4, 7, C.white);
  text(p, title, x + w / 2 - textW(title) / 2, y + 3, C.ink);
}

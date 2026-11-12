// Short-lived effects: Team MCP envelopes, floating text, confetti.

import { tag, textW } from "../engine/font";
import { C } from "../engine/palette";
import type { Pen } from "../engine/pen";

interface Envelope {
  kind: "env";
  fromX: number;
  fromY: number;
  toId: string;
  t: number;
}
interface FloatText {
  kind: "text";
  str: string;
  x: number;
  y: number;
  life: number;
  color: string;
}
interface Pixel {
  kind: "px";
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

type Effect = Envelope | FloatText | Pixel;

export class Effects {
  private list: Effect[] = [];

  envelope(fromX: number, fromY: number, toId: string) {
    this.list.push({ kind: "env", fromX, fromY, toId, t: 0 });
  }

  text(str: string, x: number, y: number, color: string = C.yellow) {
    this.list.push({ kind: "text", str, x, y, life: 1.6, color });
  }

  burst(x: number, y: number, colors: string[], n = 14) {
    for (let i = 0; i < n; i++)
      this.list.push({ kind: "px", x, y, vx: (Math.random() - 0.5) * 70, vy: -30 - Math.random() * 50, life: 0.6 + Math.random() * 0.6, color: colors[i % colors.length] });
  }

  clear() {
    this.list = [];
  }

  update(dt: number) {
    for (const e of this.list) {
      if (e.kind === "env") e.t += dt / 1.1;
      else if (e.kind === "text") {
        e.life -= dt;
        e.y -= 12 * dt;
      } else {
        e.life -= dt;
        e.vy += 140 * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }
    }
    this.list = this.list.filter((e) => (e.kind === "env" ? e.t < 1 : e.life > 0));
  }

  draw(p: Pen, posOf: (id: string) => { x: number; y: number } | null) {
    for (const e of this.list) {
      if (e.kind === "env") {
        const to = posOf(e.toId);
        if (!to) continue;
        const k = e.t < 0.5 ? 2 * e.t * e.t : 1 - Math.pow(-2 * e.t + 2, 2) / 2;
        const x = Math.round(e.fromX + (to.x - e.fromX) * k) - 4;
        const y = Math.round(e.fromY + (to.y - 20 - e.fromY) * k - Math.sin(k * Math.PI) * 36) - 3;
        p.rect(x, y, 9, 7, C.ink);
        p.rect(x + 1, y + 1, 7, 5, C.white);
        p.rect(x + 2, y + 2, 1, 1, C.pink);
        p.rect(x + 3, y + 3, 3, 1, C.pink);
        p.rect(x + 6, y + 2, 1, 1, C.pink);
      } else if (e.kind === "text") {
        if (e.life > 0.15 || Math.floor(e.life * 30) % 2) {
          const w = textW(e.str);
          p.rect(Math.round(e.x - w / 2) - 2, Math.round(e.y) - 2, w + 4, 9, C.ink);
          tag(p, e.str, e.x, Math.round(e.y), C.ink, e.color);
        }
      } else p.rect(Math.round(e.x), Math.round(e.y), 1, 1, e.color);
    }
  }
}

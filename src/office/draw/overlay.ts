// Per-bot overlays: shadow, eyes, antenna, emote bubbles, name tags, selection.

import type { AgentState } from "../../data/types";
import { stateStyle } from "../../theme/tokens";
import type { Bot } from "../actors/bots";
import { tag, text } from "../engine/font";
import { C } from "../engine/palette";
import { ellipse, type Pen } from "../engine/pen";
import type { PxRect } from "../layout/layout";

export function drawShadow(p: Pen, bot: Bot) {
  ellipse(p, Math.round(bot.x), Math.round(bot.y) + 1, 4, 1, C.shadow, 0.3);
}

export function drawFace(p: Pen, bot: Bot, state: AgentState, t: number) {
  const x = Math.round(bot.x) - 6;
  const y = bot.headY;
  const st = stateStyle[state];
  let ant: string = st.color;
  if (state === "needs-input") ant = Math.floor(t * 6) % 2 ? st.color : st.dim;
  else if (state === "working") ant = Math.floor(t * 2) % 2 ? st.color : "#9ddcff";
  p.rect(x + 5, y + 1, 2, 1, ant);

  const col = state === "needs-input" ? C.red : state === "review-passed" ? C.green : "#bff6ff";
  const blink = Math.floor(t * 10 + bot.index * 7) % 37 === 0;
  if (bot.face === "down") {
    if (state === "review-passed") {
      for (const ex of [3, 6]) {
        p.rect(x + ex, y + 7, 1, 1, col);
        p.rect(x + ex + 1, y + 6, 1, 1, col);
        p.rect(x + ex + 2, y + 7, 1, 1, col);
      }
    } else if (state === "idle") {
      p.rect(x + 3, y + 7, 2, 1, C.lav);
      p.rect(x + 7, y + 7, 2, 1, C.lav);
    } else {
      p.rect(x + 4, y + (blink ? 7 : 6), 1, blink ? 1 : 2, col);
      p.rect(x + 7, y + (blink ? 7 : 6), 1, blink ? 1 : 2, col);
    }
  } else if (bot.face === "right" || bot.face === "left") {
    p.rect(x + (bot.face === "right" ? 8 : 3), y + (blink ? 7 : 6), 1, blink ? 1 : 2, col);
  }
  if (bot.path.length && Math.floor(t * 12) % 2) p.rect(x + 5, y + 14, 2, 1, C.orange);
}

function bubble(p: Pen, cx: number, y: number, fill: string = C.white) {
  const x = Math.round(cx) - 6;
  p.rect(x + 1, y, 11, 9, C.ink);
  p.rect(x, y + 1, 13, 7, C.ink);
  p.rect(x + 1, y + 1, 11, 7, fill);
  p.rect(x + 5, y + 9, 3, 1, C.ink);
  p.rect(x + 6, y + 10, 1, 1, C.ink);
  p.rect(x + 6, y + 8, 1, 1, fill);
  return x;
}

export function drawEmote(p: Pen, bot: Bot, state: AgentState, t: number, simT: number) {
  if (bot.carry !== null) return;
  let type: string | null = null;
  if (bot.emote && simT < bot.emote.until) type = bot.emote.type;
  else if (bot.path.length) type = null;
  else if (state === "needs-input") type = "bang";
  else if (state === "in-review") type = "wait";
  else if (state === "review-passed") type = "check";
  else if (state === "working") type = "dots";
  else if (state === "idle") type = "zz";
  if (!type) return;
  const cx = Math.round(bot.x);
  const top = bot.headY - 12;
  if (type === "zz") {
    const k = (t * 0.8 + bot.index * 0.3) % 1;
    text(p, "Z", cx + 4 + Math.round(k * 3), top + 6 - Math.round(k * 8), C.lav);
    return;
  }
  if (type === "bang") {
    const by = top - (Math.floor(t * 4) % 2);
    const x = bubble(p, cx, by, C.red);
    p.rect(x + 6, by + 2, 1, 3, C.white);
    p.rect(x + 6, by + 6, 1, 1, C.white);
    return;
  }
  const x = bubble(p, cx, top);
  if (type === "dots") for (let i = 0; i < 3; i++) p.rect(x + 3 + i * 3, top + 4 - (Math.floor(t * 4) % 3 === i ? 1 : 0), 1, 1, C.blue);
  if (type === "wait") {
    const c = C.orange;
    p.rect(x + 4, top + 2, 5, 1, c);
    p.rect(x + 5, top + 3, 3, 1, c);
    p.rect(x + 6, top + 4, 1, 1, c);
    p.rect(x + 5, top + 5, 3, 1, c);
    p.rect(x + 4, top + 6, 5, 1, c);
  }
  if (type === "check") for (let i = 0; i < 7; i++) p.rect(x + 3 + i, top + (i < 3 ? 4 + i : 8 - i), 1, 1, "#00a83a");
  if (type === "talk") for (let i = 0; i < 3; i++) p.rect(x + 3 + i * 3, top + 4, 1, 1, Math.floor(t * 6) % 3 >= i ? C.ink : C.lav);
  if (type === "mail") {
    p.rect(x + 3, top + 2, 7, 5, C.pink);
    p.rect(x + 4, top + 3, 5, 3, C.white);
    p.rect(x + 5, top + 4, 3, 1, C.pink);
  }
  if (type === "ok") text(p, "OK", x + 3, top + 2, "#00a83a");
  if (type === "coffee") {
    p.rect(x + 4, top + 3, 4, 4, C.ink);
    p.rect(x + 5, top + 3, 2, 1, "#7a4a2a");
    p.rect(x + 8, top + 4, 1, 2, C.ink);
    p.rect(x + 5, top + 1 - (Math.floor(t * 4) % 2), 1, 1, C.lav);
  }
}

export function drawNameTag(p: Pen, bot: Bot) {
  tag(p, bot.config.name.toUpperCase().slice(0, 10), Math.round(bot.x), bot.headY - 9, C.ink, bot.color);
}

/** Blinking selection brackets around a rect. */
export function drawSelection(p: Pen, r: PxRect, t: number) {
  if (Math.floor(t * 3) % 3 === 0) return;
  const { x, y, w, h } = r;
  const L = 4;
  const c = C.yellow;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    p.rect(sx > 0 ? cx - 1 : cx - L + 1, sy > 0 ? cy - 1 : cy, L, 1, c);
    p.rect(sx > 0 ? cx - 1 : cx, sy > 0 ? cy - 1 : cy - L + 1, 1, L, c);
  }
}

// Seated people for the modern office: flat illustration, facing you across their desk.
// Looks are picked from the agent's id, so each agent always looks the same.

import type { AgentState } from "../data/types";

const SKIN = ["#f6d2b0", "#eab98c", "#d29a6a", "#b0764a", "#8a5634", "#5e3a22"];
const HAIR = ["#2a1c14", "#4b2e1c", "#7a4a26", "#b5793c", "#d8b47a", "#1d1d24", "#8b8b93", "#a0442e"];

export interface Look {
  skin: string;
  hair: string;
  style: number; // 0 short, 1 long, 2 bun, 3 curly, 4 buzz
  glasses: boolean;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function lookFor(id: string): Look {
  const h = hash(id);
  return { skin: SKIN[h % SKIN.length], hair: HAIR[(h >>> 4) % HAIR.length], style: (h >>> 8) % 5, glasses: (h >>> 12) % 4 === 0 };
}

/** Darker or lighter version of a #rrggbb colour (amount -1..1). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export interface AvatarPose {
  state: AgentState;
  t: number; // seconds
  seed: number; // per agent, so they don't move in step
  alpha?: number;
  badge?: "lead" | "ceo";
  /** The person is at a desk with a laptop: hands on it when working. */
  typing?: boolean;
}

/** Draws a seated person. (cx, sy) is the middle of the shoulders, just above the desk edge. */
export function drawAvatar(g: CanvasRenderingContext2D, cx: number, sy: number, shirt: string, look: Look, pose: AvatarPose) {
  const { state, t, seed } = pose;
  g.save();
  g.globalAlpha = pose.alpha ?? 1;
  const breathe = Math.sin(t * 1.8 + seed) * 0.8;
  const y = sy + breathe;

  // body
  g.fillStyle = shirt;
  g.beginPath();
  g.moveTo(cx - 30, y + 34);
  g.quadraticCurveTo(cx - 32, y + 2, cx - 16, y - 4);
  g.lineTo(cx + 16, y - 4);
  g.quadraticCurveTo(cx + 32, y + 2, cx + 30, y + 34);
  g.closePath();
  g.fill();
  // collar
  g.fillStyle = shade(shirt, -0.25);
  g.beginPath();
  g.moveTo(cx - 8, y - 4);
  g.lineTo(cx, y + 6);
  g.lineTo(cx + 8, y - 4);
  g.closePath();
  g.fill();
  if (pose.badge === "ceo") {
    // blazer lapels
    g.fillStyle = shade(shirt, -0.35);
    g.fillRect(cx - 22, y + 2, 8, 30);
    g.fillRect(cx + 14, y + 2, 8, 30);
  }
  if (pose.badge === "lead") {
    g.fillStyle = "#ffcf3a";
    star(g, cx + 15, y + 12, 5);
  }

  // neck + head
  g.fillStyle = shade(look.skin, -0.12);
  g.fillRect(cx - 5, y - 12, 10, 10);
  const hy = y - 30;
  if (look.style === 1) {
    // long hair behind the head
    g.fillStyle = look.hair;
    round(g, cx - 20, hy - 14, 40, 44, 16);
  }
  g.fillStyle = look.skin;
  g.beginPath();
  g.ellipse(cx, hy, 17, 19, 0, 0, Math.PI * 2);
  g.fill();
  hair(g, cx, hy, look);

  // face
  const blink = (t + seed * 1.7) % 4.2 < 0.12;
  const looking = state === "working" ? 3 : 0; // working: eyes down at the laptop
  g.fillStyle = "#2a1c14";
  if (blink) {
    g.fillRect(cx - 9, hy + 1 + looking, 6, 1.6);
    g.fillRect(cx + 3, hy + 1 + looking, 6, 1.6);
  } else {
    dot(g, cx - 6, hy + 1 + looking, 2.1);
    dot(g, cx + 6, hy + 1 + looking, 2.1);
  }
  if (look.glasses) {
    g.strokeStyle = "#2a1c14";
    g.lineWidth = 1.3;
    g.strokeRect(cx - 11, hy - 3 + looking, 9, 7);
    g.strokeRect(cx + 2, hy - 3 + looking, 9, 7);
  }
  g.strokeStyle = shade(look.skin, -0.45);
  g.lineWidth = 1.6;
  g.beginPath();
  if (state === "needs-input") g.arc(cx, hy + 11, 3, 0, Math.PI * 2); // "oh"
  else if (state === "review-passed" || state === "idle") g.arc(cx, hy + 8, 5, 0.15 * Math.PI, 0.85 * Math.PI); // smile
  else g.moveTo(cx - 4, hy + 10), g.lineTo(cx + 4, hy + 10);
  g.stroke();
  // cheeks
  g.fillStyle = "rgba(255,120,120,0.18)";
  dot(g, cx - 11, hy + 7, 3);
  dot(g, cx + 11, hy + 7, 3);

  // arms
  g.fillStyle = shade(shirt, -0.08);
  if (state === "needs-input") {
    // a raised hand, waving
    const wave = Math.sin(t * 6 + seed) * 3;
    g.save();
    g.translate(cx + 26, y + 4);
    g.rotate(-0.35 + wave * 0.03);
    round(g, -5, -40, 10, 42, 5);
    g.fillStyle = look.skin;
    dot(g, 0, -42, 6);
    g.restore();
  } else if (state === "idle" && !pose.typing) {
    // holding a mug
    g.fillStyle = "#ffffff";
    round(g, cx + 18, y + 14, 12, 14, 3);
    g.fillStyle = "#c47b4a";
    g.fillRect(cx + 20, y + 16, 8, 3);
  }
  g.restore();
}

/** Hands on the laptop keys; drawn after the desk so they sit on top of it. */
export function drawHands(g: CanvasRenderingContext2D, cx: number, deskY: number, look: Look, t: number, seed: number, working: boolean) {
  const a = working ? Math.sin(t * 13 + seed) * 2 : 0;
  const b = working ? Math.sin(t * 13 + seed + 2.1) * 2 : 0;
  g.fillStyle = look.skin;
  dot(g, cx - 22, deskY + 8 + a, 5.5);
  dot(g, cx + 22, deskY + 8 + b, 5.5);
}

function hair(g: CanvasRenderingContext2D, cx: number, hy: number, look: Look) {
  g.fillStyle = look.hair;
  switch (look.style) {
    case 0: // short
      g.beginPath();
      g.ellipse(cx, hy - 9, 18, 12, 0, Math.PI, 0);
      g.fill();
      g.fillRect(cx - 18, hy - 10, 6, 10);
      break;
    case 1: // long: the back was drawn behind; a fringe here
      g.beginPath();
      g.ellipse(cx, hy - 10, 18, 11, 0, Math.PI, 0);
      g.fill();
      break;
    case 2: // bun
      dot(g, cx, hy - 24, 8);
      g.beginPath();
      g.ellipse(cx, hy - 9, 18, 11, 0, Math.PI, 0);
      g.fill();
      break;
    case 3: // curly
      for (let i = -3; i <= 3; i++) dot(g, cx + i * 5.5, hy - 14 + Math.abs(i) * 1.6, 6.5);
      break;
    default: // buzz
      g.globalAlpha *= 0.85;
      g.beginPath();
      g.ellipse(cx, hy - 8, 17, 10, 0, Math.PI, 0);
      g.fill();
      g.globalAlpha /= 0.85;
  }
}

export function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

export function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

// The modern office, drawn with Canvas 2D: a warm open-plan floor seen from a slight angle
// (desks show their top and front), a glass CEO office, the lead's desk, a meeting area with a
// live whiteboard, a lounge, and desk pods where each agent sits at its assigned desk.

import type { AgentConfig, AgentStatus, AgentState, OfficeSnapshot } from "../data/types";
import { stageOf } from "../data/workflow";
import { dot, drawAvatar, drawHands, lookFor, round, shade } from "./avatar";
import type { ModernLayout, Rect } from "./layout";

const INK = "#2b2433";
const MUTED = "#7b7183";
const FONT = "Inter, system-ui, -apple-system, Segoe UI, sans-serif";

export const STATE_STYLE: Record<AgentState, { label: string; color: string }> = {
  working: { label: "Working", color: "#2fb36d" },
  "needs-input": { label: "Needs you", color: "#f29b1d" },
  "in-review": { label: "Waiting for review", color: "#4a90e2" },
  "review-passed": { label: "Review passed", color: "#2fb36d" },
  idle: { label: "Idle", color: "#a59cad" },
};

export interface Frame {
  t: number;
  snap: OfficeSnapshot;
  hover: string | null; // hit id under the pointer
  reducedMotion: boolean;
}

// ---------------------------------------------------------------- room shell

export function drawShell(g: CanvasRenderingContext2D, L: ModernLayout, officeName: string, t: number) {
  // floor: warm planks
  g.fillStyle = "#eadcc4";
  g.fillRect(0, L.wallH, L.w, L.h - L.wallH);
  g.strokeStyle = "rgba(160,120,80,0.16)";
  g.lineWidth = 1;
  for (let y = L.wallH + 22; y < L.h; y += 22) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(L.w, y);
    g.stroke();
    for (let x = ((y / 22) % 2) * 90; x < L.w; x += 180) {
      g.beginPath();
      g.moveTo(x, y - 22);
      g.lineTo(x, y);
      g.stroke();
    }
  }
  // back wall
  const wall = g.createLinearGradient(0, 0, 0, L.wallH);
  wall.addColorStop(0, "#f7f3ec");
  wall.addColorStop(1, "#ebe4d8");
  g.fillStyle = wall;
  g.fillRect(0, 0, L.w, L.wallH);
  g.fillStyle = "#cdbfa9";
  g.fillRect(0, L.wallH - 6, L.w, 6); // skirting
  // windows along the wall, between the rooms' features
  const sky = (Math.sin(t * 0.02) + 1) / 2;
  for (let x = 24; x < L.w - 120; x += 210) {
    if (x + 150 > L.whiteboard.x - 10 && x < L.whiteboard.x + L.whiteboard.w + 10) continue;
    if (x + 150 > L.sign.x - 110 && x < L.sign.x + 110) continue;
    const grad = g.createLinearGradient(0, 14, 0, 74);
    grad.addColorStop(0, sky > 0.5 ? "#9fd2f5" : "#a9d8f7");
    grad.addColorStop(1, "#dff1fb");
    g.fillStyle = "#ffffff";
    round(g, x - 4, 10, 158, 70, 6);
    g.fillStyle = grad;
    round(g, x, 14, 150, 62, 4);
    g.fillStyle = "rgba(255,255,255,0.75)";
    cloud(g, x + 40 + ((t * 3) % 120), 34);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x + 75, 14);
    g.lineTo(x + 75, 76);
    g.stroke();
  }
  // the office sign
  g.fillStyle = INK;
  round(g, L.sign.x - 100, L.sign.y - 22, 200, 40, 8);
  g.fillStyle = "#ffffff";
  g.font = `700 18px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(fit(g, officeName, 180), L.sign.x, L.sign.y - 1);
  // corridor runner
  g.fillStyle = "rgba(120,96,70,0.08)";
  g.fillRect(24, L.ceo.y + L.ceo.h + 14, L.w - 48, 28);
  // open-plan rug
  g.fillStyle = "#dfe7e3";
  round(g, L.floor.x, L.floor.y, L.floor.w, L.floor.h, 18);
  g.strokeStyle = "#c6d4cd";
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(L.floor.x + 6, L.floor.y + 6, L.floor.w - 12, L.floor.h - 12, 14);
  g.stroke();
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number) {
  dot(g, x, y, 8);
  dot(g, x + 10, y - 4, 10);
  dot(g, x + 22, y, 8);
}

// ---------------------------------------------------------------- furniture

/** A desk seen from slightly above: top surface, front panel, legs. */
function desk(g: CanvasRenderingContext2D, cx: number, y: number, w: number, top = "#d9b48a") {
  g.fillStyle = "rgba(43,36,51,0.12)";
  g.beginPath();
  g.ellipse(cx, y + 62, w / 2 + 8, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade(top, -0.38);
  g.fillRect(cx - w / 2 + 8, y + 30, 6, 30);
  g.fillRect(cx + w / 2 - 14, y + 30, 6, 30);
  g.fillStyle = shade(top, -0.18);
  round(g, cx - w / 2, y + 14, w, 26, 6);
  g.fillStyle = top;
  round(g, cx - w / 2, y, w, 24, 7);
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.fillRect(cx - w / 2 + 8, y + 3, w - 16, 2);
}

/** An office chair seen from the front, behind whoever sits in it. */
function chair(g: CanvasRenderingContext2D, cx: number, y: number, color = "#3d3a48", empty = false) {
  g.fillStyle = shade(color, 0.08);
  round(g, cx - 27, y - 52, 54, 66, 14);
  g.fillStyle = color;
  round(g, cx - 22, y - 46, 44, 54, 11);
  if (empty) {
    // seat visible when nobody is in it
    g.fillStyle = shade(color, -0.15);
    round(g, cx - 26, y + 4, 52, 14, 6);
  }
}

/** The back of an open laptop. Its logo glows in the state's colour. */
function laptop(g: CanvasRenderingContext2D, cx: number, deskY: number, glow: string | null, t: number) {
  g.fillStyle = "#c9ccd6";
  round(g, cx - 30, deskY - 26, 60, 32, 4);
  g.fillStyle = "#b4b8c4";
  g.fillRect(cx - 34, deskY + 4, 68, 5);
  if (glow) {
    g.save();
    g.globalAlpha = 0.65 + Math.sin(t * 2.4) * 0.2;
    g.fillStyle = glow;
    dot(g, cx, deskY - 11, 5);
    g.restore();
  } else {
    g.fillStyle = "#a9adb9";
    dot(g, cx, deskY - 11, 4);
  }
}

function plant(g: CanvasRenderingContext2D, x: number, y: number, s = 1) {
  g.fillStyle = "#c46a4a";
  round(g, x - 9 * s, y, 18 * s, 18 * s, 4 * s);
  g.fillStyle = "#3f9b5f";
  for (const [dx, dy, r] of [[-7, -6, 9], [7, -7, 9], [0, -15, 10], [-3, -2, 7], [5, -1, 7]]) dot(g, x + dx * s, y + dy * s, r * s);
  g.fillStyle = "#57b874";
  dot(g, x - 2 * s, y - 13 * s, 5 * s);
}

function mug(g: CanvasRenderingContext2D, x: number, y: number, c: string) {
  g.fillStyle = c;
  round(g, x, y - 12, 11, 13, 3);
  g.strokeStyle = c;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x + 12, y - 6, 3.5, -Math.PI / 2, Math.PI / 2);
  g.stroke();
}

function papers(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = "#ffffff";
  g.fillRect(x, y - 6, 20, 12);
  g.fillStyle = "#f2efe8";
  g.fillRect(x + 3, y - 9, 20, 12);
}

// ---------------------------------------------------------------- labels and bubbles

function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** Name pill under a desk: status dot, name, role. */
function nameplate(g: CanvasRenderingContext2D, cx: number, y: number, name: string, role: string, color: string | null, dim = false) {
  g.font = `600 13px ${FONT}`;
  const nameW = Math.min(110, g.measureText(name).width);
  g.font = `500 11px ${FONT}`;
  const roleW = Math.min(90, g.measureText(role).width);
  const w = 26 + nameW + 8 + roleW + 12;
  g.save();
  g.globalAlpha = dim ? 0.6 : 1;
  g.fillStyle = "#ffffff";
  g.shadowColor = "rgba(43,36,51,0.15)";
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;
  round(g, cx - w / 2, y, w, 24, 12);
  g.restore();
  g.save();
  g.globalAlpha = dim ? 0.6 : 1;
  g.fillStyle = color ?? "#d0cad6";
  dot(g, cx - w / 2 + 13, y + 12, 5);
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = `600 13px ${FONT}`;
  g.fillStyle = INK;
  g.fillText(fit(g, name, 110), cx - w / 2 + 24, y + 12.5);
  g.font = `500 11px ${FONT}`;
  g.fillStyle = MUTED;
  g.fillText(fit(g, role, 90), cx - w / 2 + 24 + nameW + 8, y + 12.5);
  g.restore();
}

/** A speech bubble over someone's head. */
function bubble(g: CanvasRenderingContext2D, x: number, y: number, kind: "dots" | "!" | "check" | "zz" | "starting", color: string, t: number) {
  const pulse = kind === "!" ? 1 + Math.sin(t * 5) * 0.08 : 1;
  g.save();
  g.translate(x, y);
  g.scale(pulse, pulse);
  g.fillStyle = "#ffffff";
  g.shadowColor = "rgba(43,36,51,0.18)";
  g.shadowBlur = 6;
  round(g, -18, -16, 36, 26, 12);
  g.shadowBlur = 0;
  g.beginPath();
  g.moveTo(-6, 9);
  g.lineTo(-12, 17);
  g.lineTo(2, 9);
  g.closePath();
  g.fill();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.lineCap = "round";
  if (kind === "dots" || kind === "starting")
    for (let i = 0; i < 3; i++) {
      const up = Math.max(0, Math.sin(t * 5 - i * 0.7)) * 3;
      dot(g, -9 + i * 9, -3 - up, 2.6);
    }
  else if (kind === "!") {
    g.font = `800 17px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("!", 0, -2);
  } else if (kind === "check") {
    g.beginPath();
    g.moveTo(-7, -3);
    g.lineTo(-2, 2);
    g.lineTo(8, -8);
    g.stroke();
  } else {
    g.font = `700 12px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("z z", 0, -3);
  }
  g.restore();
}

function hoverRing(g: CanvasRenderingContext2D, r: Rect) {
  g.save();
  g.strokeStyle = "rgba(74,144,226,0.85)";
  g.lineWidth = 3;
  g.setLineDash([8, 6]);
  g.beginPath();
  g.roundRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 16);
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- people at desks

interface Seat {
  agent: AgentConfig;
  status: AgentStatus | undefined;
}

/** Someone at a desk, or an empty desk. Draw order: chair, person, desk, laptop, hands, things, name, bubble. */
function seat(g: CanvasRenderingContext2D, cx: number, deskY: number, deskW: number, s: Seat | null, f: Frame, opts: { lead?: boolean; label?: string; items: number }) {
  const t = f.reducedMotion ? 0 : f.t;
  const st = s?.status;
  const session = st?.session.state ?? "stopped";
  const present = !!s && (session === "running" || session === "starting");
  const state: AgentState = st?.state ?? "idle";
  const seed = s ? lookFor(s.agent.id).style + s.agent.id.length : 0;
  chair(g, cx, deskY - 6, opts.lead ? "#4a3f5c" : "#3d3a48", !present);
  if (s && present) {
    const look = lookFor(s.agent.id);
    drawAvatar(g, cx, deskY - 30, s.agent.color, look, { state, t, seed, alpha: session === "starting" ? 0.55 : 1, badge: opts.lead ? "lead" : undefined, typing: true });
    desk(g, cx, deskY, deskW, opts.lead ? "#cfa47a" : "#d9b48a");
    laptop(g, cx, deskY, session === "running" ? STATE_STYLE[state].color : null, t);
    if (state === "working" || state === "idle" || state === "in-review" || state === "review-passed") drawHands(g, cx, deskY, look, t, seed, state === "working" && session === "running");
  } else {
    desk(g, cx, deskY, deskW, opts.lead ? "#cfa47a" : "#d9b48a");
    laptop(g, cx, deskY, null, t);
  }
  // a few things on the desk, different per desk
  if (opts.items % 3 === 0) plant(g, cx + deskW / 2 - 18, deskY + 2, 0.7);
  if (opts.items % 3 === 1) mug(g, cx + deskW / 2 - 26, deskY + 14, "#e7695d");
  if (opts.items % 3 === 2) papers(g, cx - deskW / 2 + 10, deskY + 12);
  if (opts.lead) {
    // the lead's second screen
    g.fillStyle = "#30303c";
    round(g, cx + 46, deskY - 30, 44, 30, 4);
    g.fillStyle = "#4a90e2";
    g.globalAlpha = present ? 0.5 : 0.15;
    g.fillRect(cx + 49, deskY - 27, 38, 24);
    g.globalAlpha = 1;
  }

  if (!s) {
    g.font = `500 12px ${FONT}`;
    g.fillStyle = "rgba(123,113,131,0.75)";
    g.textAlign = "center";
    g.fillText(opts.label ?? "Free desk", cx, deskY + 82);
    return;
  }
  const color = !present ? "#c9c2cf" : session === "starting" ? "#e8c35a" : STATE_STYLE[state].color;
  nameplate(g, cx, deskY + 70, s.agent.name, s.agent.temporary ? `${s.agent.role} · temp` : s.agent.role, color, !present);
  if (!present) return;
  const headY = deskY - 30 - 58;
  if (session === "starting") bubble(g, cx + 26, headY, "starting", "#e8c35a", t);
  else if (state === "needs-input") bubble(g, cx + 30, headY, "!", STATE_STYLE["needs-input"].color, t);
  else if (state === "in-review") bubble(g, cx + 30, headY, "dots", STATE_STYLE["in-review"].color, t);
  else if (state === "review-passed") bubble(g, cx + 30, headY, "check", STATE_STYLE["review-passed"].color, t);
  else if (state === "idle" && st && Date.now() - Date.parse(st.stateSince) > 10 * 60_000) bubble(g, cx + 30, headY, "zz", MUTED, t);
}

export function drawDesks(g: CanvasRenderingContext2D, L: ModernLayout, f: Frame) {
  const team = f.snap.config.team;
  for (const d of L.desks) {
    const agent = team.find((a) => a.id === d.agentId) ?? null;
    if (f.hover === `agent:${d.agentId}`) hoverRing(g, d.rect);
    seat(g, d.cx, d.deskY, 150, agent ? { agent, status: f.snap.agents.find((a) => a.agentId === agent.id) } : null, f, { items: d.index, label: `Desk ${d.index + 1} · free` });
  }
}

// ---------------------------------------------------------------- rooms

export function drawCeoOffice(g: CanvasRenderingContext2D, L: ModernLayout, f: Frame) {
  const r = L.ceo;
  // carpet
  g.fillStyle = "#e7dff0";
  round(g, r.x, r.y, r.w, r.h, 12);
  if (f.hover === "ceo") hoverRing(g, r);
  // desk with the CEO (you) behind it, always there
  const cx = r.x + r.w / 2;
  const deskY = r.y + 132;
  chair(g, cx, deskY - 6, "#2b2433");
  drawAvatar(g, cx, deskY - 30, "#40506b", lookFor(`ceo:${f.snap.config.ceo.name}`), { state: "idle", t: f.reducedMotion ? 0 : f.t, seed: 2, badge: "ceo", typing: true });
  desk(g, cx, deskY, 190, "#8a6446");
  laptop(g, cx, deskY, "#ffffff", f.reducedMotion ? 0 : f.t);
  plant(g, r.x + 26, r.y + 40, 0.9);
  plant(g, r.x + r.w - 26, r.y + 40, 0.9);
  // glass walls
  g.fillStyle = "rgba(170,210,235,0.22)";
  g.fillRect(r.x, r.y + r.h - 10, r.w * 0.6, 10);
  g.fillRect(r.x + r.w - 10, r.y, 10, r.h);
  g.strokeStyle = "rgba(120,160,190,0.7)";
  g.lineWidth = 2;
  g.strokeRect(r.x + r.w - 10, r.y, 10, r.h);
  g.strokeRect(r.x, r.y + r.h - 10, r.w * 0.6, 10);
  nameplate(g, cx, deskY + 70, f.snap.config.ceo.name, "CEO · you", "#40506b");
  // unread briefings: a little stack on the desk
  const unread = (f.snap.briefings ?? []).filter((b) => !b.read).length;
  if (unread) {
    g.fillStyle = "#4a90e2";
    dot(g, cx - 70, deskY + 6, 11);
    g.fillStyle = "#ffffff";
    g.font = `700 12px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(unread), cx - 70, deskY + 6.5);
  }
}

export function drawLeadArea(g: CanvasRenderingContext2D, L: ModernLayout, f: Frame) {
  const r = L.lead;
  g.fillStyle = "#efe3cf";
  round(g, r.x, r.y, r.w, r.h, 12);
  const lead = f.snap.config.team.find((a) => a.isLead) ?? null;
  if (lead && f.hover === `agent:${lead.id}`) hoverRing(g, r);
  g.fillStyle = "#b9a58a";
  round(g, r.x + r.w - 60, r.y + 18, 44, 70, 6); // bookshelf
  for (let i = 0; i < 3; i++) {
    g.fillStyle = ["#e7695d", "#4a90e2", "#2fb36d"][i];
    g.fillRect(r.x + r.w - 54 + i * 12, r.y + 26, 9, 22);
    g.fillStyle = ["#f2b84b", "#7a5aa6", "#e7695d"][i];
    g.fillRect(r.x + r.w - 54 + i * 12, r.y + 56, 9, 24);
  }
  seat(g, L.leadDesk.cx, L.leadDesk.deskY, 200, lead ? { agent: lead, status: f.snap.agents.find((a) => a.agentId === lead.id) } : null, f, { lead: true, items: 1 });
}

export function drawMeeting(g: CanvasRenderingContext2D, L: ModernLayout, f: Frame) {
  const r = L.meeting;
  g.fillStyle = "#e3ebe6";
  round(g, r.x, r.y, r.w, r.h, 12);
  // round table with chairs
  const cx = r.x + r.w / 2;
  const cy = r.y + 120;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.fillStyle = "#3d3a48";
    round(g, cx + Math.cos(a) * 92 - 14, cy + Math.sin(a) * 52 - 12, 28, 24, 8);
  }
  g.fillStyle = "rgba(43,36,51,0.12)";
  g.beginPath();
  g.ellipse(cx, cy + 14, 82, 34, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#b5865e";
  g.beginPath();
  g.ellipse(cx, cy + 6, 78, 32, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#cfa47a";
  g.beginPath();
  g.ellipse(cx, cy, 78, 32, 0, 0, Math.PI * 2);
  g.fill();
  g.font = `600 12px ${FONT}`;
  g.fillStyle = MUTED;
  g.textAlign = "center";
  g.fillText("Meeting area", cx, r.y + r.h - 14);
  drawWhiteboard(g, L, f);
}

/** The plan on the wall: a column per stage (or status), a sticky per item in its owner's colour. */
function drawWhiteboard(g: CanvasRenderingContext2D, L: ModernLayout, f: Frame) {
  const r = L.whiteboard;
  const snap = f.snap;
  g.fillStyle = "#9aa3ad";
  round(g, r.x - 4, r.y - 4, r.w + 8, r.h + 8, 6);
  g.fillStyle = "#ffffff";
  round(g, r.x, r.y, r.w, r.h, 4);
  if (f.hover === "plan") hoverRing(g, { x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 });
  const board = snap.boards.filter((b) => b.status === "active").sort((a, b) => a.order - b.order)[0];
  const tasks = snap.tasks.filter((x) => x.boardId === board?.id);
  const wf = snap.config.workflow;
  const byStage = wf.stages.length > 1 || wf.stages[0]?.gate !== "pull-request";
  const cols = byStage
    ? [...wf.stages.map((s) => ({ name: s.name, items: tasks.filter((x) => x.status !== "done" && stageOf(wf, x).id === s.id) })), { name: "Done", items: tasks.filter((x) => x.status === "done") }]
    : [
        { name: "To do", items: tasks.filter((x) => x.status === "todo" || x.status === "blocked") },
        { name: "Doing", items: tasks.filter((x) => x.status === "in-progress") },
        { name: "Review", items: tasks.filter((x) => x.status === "in-review") },
        { name: "Done", items: tasks.filter((x) => x.status === "done") },
      ];
  const cw = (r.w - 12) / cols.length;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  cols.forEach((c, i) => {
    const x = r.x + 6 + i * cw;
    g.font = `600 9px ${FONT}`;
    g.fillStyle = MUTED;
    g.fillText(fit(g, `${c.name.toUpperCase()} ${c.items.length}`, cw - 6), x + 2, r.y + 13);
    if (i) {
      g.fillStyle = "#e6e2ea";
      g.fillRect(x - 2, r.y + 4, 1, r.h - 8);
    }
    c.items.slice(0, 8).forEach((task, j) => {
      const owner = snap.config.team.find((a) => a.id === task.ownerId);
      g.fillStyle = task.status === "blocked" ? "#ff8a8a" : owner ? shade(owner.color, 0.35) : "#ffe9a8";
      g.fillRect(x + 3 + (j % 4) * 11, r.y + 19 + Math.floor(j / 4) * 11, 9, 9);
    });
    if (c.items.length > 8) {
      g.fillStyle = MUTED;
      g.font = `600 9px ${FONT}`;
      g.fillText(`+${c.items.length - 8}`, x + 3, r.y + 52);
    }
  });
  g.font = `600 10px ${FONT}`;
  g.fillStyle = INK;
  g.fillText(fit(g, board ? board.title : "No active board", r.w - 12), r.x + 6, r.y + r.h - 6);
}

export function drawLounge(g: CanvasRenderingContext2D, L: ModernLayout) {
  const r = L.lounge;
  g.fillStyle = "#f1e6dc";
  round(g, r.x, r.y, r.w, r.h, 12);
  // sofa
  g.fillStyle = "#3f7f8f";
  round(g, r.x + 30, r.y + 120, 150, 46, 14);
  g.fillStyle = "#4f95a6";
  round(g, r.x + 38, r.y + 104, 134, 32, 12);
  g.fillStyle = "#2f5f6b";
  round(g, r.x + 22, r.y + 112, 20, 56, 8);
  round(g, r.x + 168, r.y + 112, 20, 56, 8);
  // coffee bar
  g.fillStyle = "#cbb79c";
  round(g, r.x + 26, r.y + 20, 120, 40, 6);
  g.fillStyle = "#3d3a48";
  round(g, r.x + 40, r.y + 4, 28, 30, 4);
  mug(g, r.x + 84, r.y + 34, "#ffffff");
  mug(g, r.x + 104, r.y + 34, "#e7695d");
  plant(g, r.x + r.w - 34, r.y + 50, 1.2);
  plant(g, r.x + r.w - 40, r.y + r.h - 34, 1);
  g.font = `600 12px ${FONT}`;
  g.fillStyle = MUTED;
  g.textAlign = "center";
  g.fillText("Lounge", r.x + r.w / 2, r.y + r.h - 14);
}

// ---------------------------------------------------------------- messages between desks

/** A paper plane flying from sender to receiver for messages sent in the last few seconds. */
export function drawMessages(g: CanvasRenderingContext2D, L: ModernLayout, f: Frame, seatOf: (id: string) => { x: number; y: number } | null) {
  if (f.reducedMotion) return;
  const now = Date.now();
  for (const m of f.snap.messages.slice(0, 12)) {
    const age = (now - Date.parse(m.at)) / 1000;
    if (age < 0 || age > 3) continue;
    const a = m.fromId === "you" ? { x: L.ceo.x + L.ceo.w / 2, y: L.ceo.y + 70 } : seatOf(m.fromId);
    const b = seatOf(m.toId);
    if (!a || !b) continue;
    const p = Math.min(1, age / 1.6);
    const mx = (a.x + b.x) / 2;
    const my = Math.min(a.y, b.y) - 90;
    g.save();
    g.globalAlpha = 1 - Math.max(0, age - 2);
    g.strokeStyle = "rgba(74,144,226,0.45)";
    g.lineWidth = 2;
    g.setLineDash([5, 7]);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.quadraticCurveTo(mx, my, b.x, b.y);
    g.stroke();
    const q = (u: number, s: number, c: number, e: number) => (1 - u) * (1 - u) * s + 2 * (1 - u) * u * c + u * u * e;
    const x = q(p, a.x, mx, b.x);
    const y = q(p, a.y, my, b.y);
    g.setLineDash([]);
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#4a90e2";
    g.beginPath();
    g.moveTo(x + 9, y);
    g.lineTo(x - 7, y - 6);
    g.lineTo(x - 3, y);
    g.lineTo(x - 7, y + 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}

// Turns the team + workflow config into an office: room modules on a tile grid.
//
//   ┌ back wall: plan board · sign · shelf · clock · window ─┬ server ┐
//   │ Lead corner (20 wide)          │ Lounge (≥ 9 wide)      │  room  │
//   │ ─────────────── corridor ───────────────────────────── │ racks  │
//   │ Desk grid (7×7 cubicles, pitch 8)   │ Review column     │        │
//   │ ════════════════ PR belt ═══════════╪═ gate ══════════════╗     │
//   └──────────────────────────────────────────────────────────╨─────┘

import type { AgentConfig, Environment, HqConfig } from "../../data/types";
import { deskCarpets } from "../engine/palette";
import { WalkGrid, type Tile } from "../engine/path";

export const TS = 16;
export const MARGIN = 3;

const LEAD_W = 20;
const MIN_LOUNGE_W = 9;
const REVIEW_W = 10;
const TOP_Y = 4; // first floor row
const DESK_Y = 14; // first cubicle row
const CUB = 7;
const PITCH = 8;
const RACKS_PER_ROW = 5;

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeskSpot {
  agentId: string;
  index: number;
  x0: number; // cubicle origin, building tiles
  y0: number;
  seat: Tile;
  drop: Tile;
  rect: PxRect; // world px
  carpet: [string, string];
}

export interface Rack extends PxRect {
  name: string;
  agentId: string | null;
}

export type HitKind = "agent" | "plan" | "prs" | "gate" | "env";

export interface Hit {
  kind: HitKind;
  id: string;
  rect: PxRect;
}

export interface OfficeLayout {
  key: string;
  W: number; // building size in tiles
  H: number;
  ox: number; // building origin in world px
  oy: number;
  worldW: number;
  worldH: number;
  mainW: number;
  grid: WalkGrid; // building tile coords
  lead: { agentId: string | null; seat: Tile; rect: PxRect };
  plan: { board: PxRect; spot: Tile };
  lounge: { x0: number; w: number; coffee: Tile[] };
  desks: DeskSpot[];
  belt: { y: number; x0: number; x1: number; topY: number | null }; // px; topY = vertical run end
  gate: PxRect | null;
  prBoard: PxRect | null;
  serverRoom: { glassX: number; x0: number; w: number } | null; // tiles
  racks: Rack[];
  mailbox: PxRect | null;
  cables: { agentId: string; pts: [number, number][] }[];
  door: Tile;
  wander: Tile[];
  hits: Hit[];
}

export function layoutKey(config: HqConfig, envs: Environment[]): string {
  const wf = config.workflow;
  return JSON.stringify([
    config.team.map((a) => [a.id, a.name, a.color, a.isLead]),
    wf.review.enabled,
    wf.review.tool,
    wf.deploy.enabled,
    envs.map((e) => e.name),
    config.project.officeName ?? "",
  ]);
}

export function deskColumns(n: number): number {
  if (n <= 4) return Math.max(1, n);
  return Math.min(5, Math.ceil(n / 2));
}

export function generateLayout(config: HqConfig, envs: Environment[]): OfficeLayout {
  const lead: AgentConfig | undefined = config.team.find((a) => a.isLead);
  const workers = config.team.filter((a) => !a.isLead);
  const review = config.workflow.review.enabled;
  const hasServer = config.workflow.deploy.enabled && envs.length > 0;

  const cols = deskColumns(workers.length);
  const rows = Math.max(1, Math.ceil(workers.length / cols));
  const x0r = 2 + cols * PITCH; // review column start
  const mainW = Math.max(LEAD_W + MIN_LOUNGE_W, x0r + (review ? REVIEW_W : 2) - 1);
  const loungeW = mainW - LEAD_W;

  const rackCount = hasServer ? envs.length : 0;
  const rackRows = Math.ceil(rackCount / RACKS_PER_ROW);
  const srW = hasServer ? Math.max(5, 2 + Math.min(rackCount, RACKS_PER_ROW) * 2) : 0;
  const glassX = mainW + 1;

  const yb = DESK_Y + rows * PITCH; // belt row
  const minH = hasServer ? Math.ceil((22 + rackRows * 112) / TS) + 3 : 0;
  const H = Math.max(yb + 3, minH);
  const W = 1 + mainW + (hasServer ? 1 + srW : 0) + 1;

  const ox = MARGIN * TS;
  const oy = MARGIN * TS;
  const px = (tx: number) => ox + tx * TS;
  const py = (ty: number) => oy + ty * TS;

  // ---------------------------------------------------------- walkable grid
  const grid = new WalkGrid(W, H);
  grid.set(1, TOP_Y, mainW, H - 2, true);
  grid.set(0, 13, 0, 13, true); // door
  // lead corner furniture
  grid.set(13, 5, 17, 6, false); // lead desk
  grid.set(18, 4, 19, 4, false); // bookshelf
  grid.set(11, 4, 11, 4, false); // plant
  grid.set(1, 4, 1, 4, false);
  for (const [x, y] of [[3, 8], [8, 8], [5, 10], [1, 11]] as Tile[]) grid.set(x, y, x, y, false);
  // lounge furniture
  const L = LEAD_W + 1;
  grid.set(L, 4, L + 3, 4, false); // counter + fridge
  grid.set(L + 2, 8, L + 5, 8, false); // couch
  grid.set(L + 3, 10, L + 4, 10, false); // table
  grid.set(mainW, 4, mainW, 4, false); // water cooler
  grid.set(mainW, 7, mainW, 8, false); // arcade
  // belt + bottom
  grid.set(2, yb, mainW, yb, false);

  // ---------------------------------------------------------- desks
  const desks: DeskSpot[] = workers.map((a, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x0 = 2 + c * PITCH;
    const y0 = DESK_Y + r * PITCH;
    grid.set(x0, y0, x0 + CUB - 1, y0, false);
    grid.set(x0 + 1, y0, x0 + 1, y0, true); // door gap
    grid.set(x0, y0, x0, y0 + CUB - 1, false);
    grid.set(x0 + CUB - 1, y0, x0 + CUB - 1, y0 + CUB - 1, false);
    grid.set(x0 + 2, y0 + 1, x0 + 4, y0 + 2, false);
    return {
      agentId: a.id,
      index: i,
      x0,
      y0,
      seat: [x0 + 3, y0 + 3],
      drop: [x0 + 3, yb - 1],
      rect: { x: px(x0), y: py(y0) - 4, w: CUB * TS, h: CUB * TS + 4 },
      carpet: deskCarpets[i % deskCarpets.length],
    };
  });

  // ---------------------------------------------------------- review column
  let gate: PxRect | null = null;
  let prBoard: PxRect | null = null;
  if (review) {
    gate = { x: px(x0r + 2), y: py(yb) - 25, w: 68, h: 46 };
    grid.set(x0r + 2, yb - 1, x0r + 6, yb + 1, false);
    prBoard = { x: px(x0r + 4), y: py(yb - 6) + 4, w: 64, h: 40 };
    grid.set(x0r + 4, yb - 6, x0r + 7, yb - 3, false);
  }

  // ---------------------------------------------------------- server room
  const racks: Rack[] = [];
  let mailbox: PxRect | null = null;
  const beltY = py(yb) + 8;
  let beltX1: number;
  let beltTop: number | null = null;
  if (hasServer) {
    grid.set(glassX, 0, W - 1, H - 1, false);
    envs.forEach((env, i) => {
      const c = i % RACKS_PER_ROW;
      const r = Math.floor(i / RACKS_PER_ROW);
      racks.push({ name: env.name, agentId: env.agentId, x: px(glassX + 2) + c * 32, y: oy + 22 + r * 112, w: 32, h: 92 });
    });
    beltX1 = px(glassX + 1) + 8;
    beltTop = oy + 112;
  } else {
    beltX1 = px(mainW) - 4;
    mailbox = { x: px(mainW) - 6, y: py(yb) - 14, w: 22, h: 30 };
    grid.set(mainW, yb - 1, mainW, yb, false);
  }

  // ---------------------------------------------------------- cables (desk → own rack)
  const cables: OfficeLayout["cables"] = [];
  desks.forEach((d, i) => {
    const rack = racks.find((r) => r.agentId === d.agentId);
    if (!rack) return;
    const sx = px(d.x0 + 3) + 4 + (i % 3) * 3;
    const laneY = py(yb) - 4 - (i % 4) * 3;
    const rx = rack.x + 10 + (i % 3) * 4;
    cables.push({ agentId: d.agentId, pts: [[sx, py(d.y0 + 2) + 12], [sx, laneY], [rx, laneY], [rx, rack.y + rack.h]] });
  });

  // ---------------------------------------------------------- hits
  const hits: Hit[] = [];
  const planBoard = { x: px(2) + 3, y: oy + 19, w: 140, h: 40 };
  hits.push({ kind: "plan", id: "plan", rect: { x: planBoard.x - 3, y: planBoard.y - 8, w: planBoard.w + 6, h: planBoard.h + 14 } });
  if (lead) hits.push({ kind: "agent", id: lead.id, rect: { x: px(12), y: oy + 64, w: 6 * TS, h: 3 * TS } });
  for (const d of desks) hits.push({ kind: "agent", id: d.agentId, rect: d.rect });
  if (gate) hits.push({ kind: "gate", id: "gate", rect: { x: gate.x, y: gate.y - 16, w: gate.w, h: gate.h + 16 } });
  if (prBoard) hits.push({ kind: "prs", id: "prs", rect: { x: prBoard.x, y: prBoard.y, w: prBoard.w, h: prBoard.h + 26 } });
  for (const r of racks) hits.push({ kind: "env", id: r.name, rect: r });

  const coffee: Tile[] = [[L, 5], [L + 1, 5], [L + 2, 5]];
  const wander: Tile[] = [[L + 3, 9], [L + 5, 9], [L + 6, 6], [4, 9], [7, 9], [6, 11], [Math.min(mainW - 1, L + 7), 11]];

  return {
    key: layoutKey(config, envs),
    W,
    H,
    ox,
    oy,
    worldW: (W + MARGIN * 2) * TS,
    worldH: (H + MARGIN * 2) * TS,
    mainW,
    grid,
    lead: { agentId: lead?.id ?? null, seat: [15, 7], rect: { x: px(12), y: oy + 64, w: 6 * TS, h: 3 * TS } },
    plan: { board: planBoard, spot: [6, 5] },
    lounge: { x0: L, w: loungeW, coffee },
    desks,
    belt: { y: beltY, x0: px(2), x1: beltX1, topY: beltTop },
    gate,
    prBoard,
    serverRoom: hasServer ? { glassX, x0: glassX + 1, w: srW } : null,
    racks,
    mailbox,
    cables,
    door: [1, 13],
    wander: wander.filter(([x, y]) => grid.ok(x, y)),
    hits,
  };
}

/** Tile centre in world px. */
export function tileCentre(l: OfficeLayout, t: Tile): { x: number; y: number } {
  return { x: l.ox + t[0] * TS + 8, y: l.oy + t[1] * TS + 8 };
}

// Where things are in the modern office. World units are CSS pixels at zoom 1.
//
//   ┌──────────────────── back wall: windows · office sign ─────────────────────┐
//   │ CEO office (glass) │ Lead desk │ Meeting area + whiteboard │ Lounge        │
//   │ ───────────────────────────── corridor ───────────────────────────────────│
//   │ Desk pods: two desks per pod, an aisle between pods, one desk per seat    │
//   └───────────────────────────────────────────────────────────────────────────┘
// One desk for every seat up to the headcount limit, so free desks show the room to hire.

import type { HqConfig } from "../data/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeskSlot {
  index: number; // desk number - 1
  rect: Rect; // the cell, for hit tests and hover
  cx: number; // desk centre
  deskY: number; // top edge of the desk surface
  agentId: string | null;
}

export interface ModernLayout {
  key: string;
  w: number;
  h: number;
  wallH: number;
  ceo: Rect;
  lead: Rect;
  leadDesk: { cx: number; deskY: number };
  meeting: Rect;
  whiteboard: Rect;
  lounge: Rect;
  floor: Rect; // open plan
  desks: DeskSlot[];
  sign: { x: number; y: number };
}

const PAD = 40;
const WALL_H = 96;
const TOP_H = 236;
const CELL_W = 210;
const CELL_H = 196;
const AISLE = 44;
const GAP = 24;

export function deskCount(config: HqConfig): number {
  const workers = config.team.filter((a) => !a.isLead);
  const highest = Math.max(-1, ...workers.map((a) => a.desk ?? -1));
  return Math.min(11, Math.max(1, config.limits.maxAgents - 1, workers.length, highest + 1));
}

export function modernLayoutKey(config: HqConfig): string {
  return JSON.stringify([config.team.map((a) => [a.id, a.isLead, a.desk]), config.limits.maxAgents, config.project.officeName ?? ""]);
}

export function modernLayout(config: HqConfig): ModernLayout {
  const n = deskCount(config);
  const cols = n <= 4 ? n : Math.min(4, Math.ceil(n / 2));
  const rows = Math.ceil(n / cols);
  const pods = (c: number) => Math.floor(c / 2); // aisles before column c
  const desksW = cols * CELL_W + pods(cols - 1) * AISLE;

  const roomW = { ceo: 300, lead: 290, meeting: 360, lounge: 250 };
  const topW = roomW.ceo + roomW.lead + roomW.meeting + roomW.lounge + GAP * 3;
  const innerW = Math.max(topW, desksW + 80);
  const w = innerW + PAD * 2;

  let x = PAD + (innerW - topW) / 2;
  const y = WALL_H;
  const ceo = { x, y, w: roomW.ceo, h: TOP_H };
  x += roomW.ceo + GAP;
  const lead = { x, y, w: roomW.lead, h: TOP_H };
  x += roomW.lead + GAP;
  const meeting = { x, y, w: roomW.meeting, h: TOP_H };
  x += roomW.meeting + GAP;
  const lounge = { x, y, w: roomW.lounge, h: TOP_H };

  const floorY = WALL_H + TOP_H + 56;
  const startX = PAD + (innerW - desksW) / 2;
  const holders = new Map(config.team.filter((a) => !a.isLead && a.desk !== undefined).map((a) => [a.desk!, a.id]));
  const desks: DeskSlot[] = Array.from({ length: n }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const rx = startX + c * CELL_W + pods(c) * AISLE;
    const ry = floorY + r * CELL_H;
    return { index: i, rect: { x: rx, y: ry, w: CELL_W, h: CELL_H }, cx: rx + CELL_W / 2, deskY: ry + 104, agentId: holders.get(i) ?? null };
  });
  const h = floorY + rows * CELL_H + PAD;

  return {
    key: modernLayoutKey(config),
    w,
    h,
    wallH: WALL_H,
    ceo,
    lead,
    leadDesk: { cx: lead.x + lead.w / 2, deskY: lead.y + 128 },
    meeting,
    whiteboard: { x: meeting.x + 30, y: 18, w: meeting.w - 60, h: WALL_H - 26 },
    lounge,
    floor: { x: startX - 24, y: floorY - 20, w: desksW + 48, h: rows * CELL_H + 10 },
    desks,
    sign: { x: ceo.x + ceo.w / 2, y: 46 },
  };
}

export const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

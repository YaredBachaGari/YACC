// Hover-robot sprites, recoloured per agent. The lead wears a crown.

import type { Texture } from "pixi.js";
import { shade } from "../../theme/tokens";
import { C } from "../engine/palette";
import { flipCanvas, spriteCanvas } from "../engine/pen";
import { canvasTexture } from "../engine/textures";

const HEAD_ANTENNA = [".....kk.....", "....k..k....", ".....kk....."];
const HEAD_CROWN = ["..k..kk..k..", "..kGkGGkGk..", "..kGGGGGGk.."];
const BODY_FRONT = ["..kkkkkkkk..", ".khhBBBBBBk.", ".khVVVVVVBk.", ".kBVVVVVVBk.", ".kBVVVVVVBk.", ".kbBBBBBBbk.", "..kkkkkkkk..", "...kBBBBk...", ".kbkBBBBkbk.", ".kk.kbbk.kk.", ".....kk....."];
const BODY_BACK = ["..kkkkkkkk..", ".khhBBBBBBk.", ".kBBBBBBBBk.", ".kBBkbbkBBk.", ".kBBBBBBBBk.", ".kbBBBBBBbk.", "..kkkkkkkk..", "...kBBBBk...", ".kbkBBBBkbk.", ".kk.kbbk.kk.", ".....kk....."];
const BODY_TYPE = ["..kkkkkkkk..", ".khhBBBBBBk.", ".kBBBBBBBBk.", ".kBBkbbkBBk.", ".kBBBBBBBBk.", ".kbBBBBBBbk.", "..kkkkkkkk..", ".kbkBBBBkbk.", ".kkkBBBBkkk.", "....kbbk....", ".....kk....."];
const BODY_SIDE = ["..kkkkkkkk..", ".khhBBBBBBk.", ".kBBBBBVVVk.", ".kBBBBBVVVk.", ".kBBBBBVVVk.", ".kbBBBBBBbk.", "..kkkkkkkk..", "...kBBBBk...", "...kbBBBbk..", "....kbbkk...", ".....kk....."];

export type Facing = "front" | "back" | "type" | "side" | "sideL";

export interface RobotSprites {
  canvases: Record<Facing, HTMLCanvasElement>;
  textures: Record<Facing, Texture>;
}

const canvasCache = new Map<string, Record<Facing, HTMLCanvasElement>>();
const spriteCache = new Map<string, RobotSprites>();

/** Plain canvases for each facing (no Pixi) — also used by HUD portraits. */
export function robotCanvases(color: string, lead: boolean): Record<Facing, HTMLCanvasElement> {
  const key = `${color}|${lead}`;
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const pal = { k: C.ink, B: color, b: shade(color, -0.3), h: shade(color, 0.6), V: "#16213f", G: C.gold };
  const head = lead ? HEAD_CROWN : HEAD_ANTENNA;
  const side = spriteCanvas([...head, ...BODY_SIDE], pal);
  const canvases: Record<Facing, HTMLCanvasElement> = {
    front: spriteCanvas([...head, ...BODY_FRONT], pal),
    back: spriteCanvas([...head, ...BODY_BACK], pal),
    type: spriteCanvas([...head, ...BODY_TYPE], pal),
    side,
    sideL: flipCanvas(side),
  };
  canvasCache.set(key, canvases);
  return canvases;
}

export function robotSprites(color: string, lead: boolean): RobotSprites {
  const key = `${color}|${lead}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const canvases = robotCanvases(color, lead);
  const textures = Object.fromEntries(Object.entries(canvases).map(([k, c]) => [k, canvasTexture(c)])) as Record<Facing, Texture>;
  const out = { canvases, textures };
  spriteCache.set(key, out);
  return out;
}

export const RABBIT = [
  "..k...k..", ".kOk.kOk.", ".kPk.kPk.", ".kPk.kPk.", ".kOkkkOk.", "kOOOOOOOk",
  "kOkOOOkOk", "kOOOpOOOk", ".kOWWWOk.", "kOOWWWOOk", "kOOWWWOOk", ".kkkkkkk.",
];
export const RABBIT_BLINK = [
  "..k...k..", ".kOk.kOk.", ".kPk.kPk.", ".kPk.kPk.", ".kOkkkOk.", "kOOOOOOOk",
  "kOOOOOOOk", "kkkOpOkkk", ".kOWWWOk.", "kOOWWWOOk", "kOOWWWOOk", ".kkkkkkk.",
];
export const RABBIT_PAL = { k: C.ink, O: C.rabbit, P: C.pink, p: "#ff5c86", W: C.white };

/** A small scanner eye used for review tools other than CodeRabbit. */
export const SCANNER = ["..kkkkk..", ".kMMMMMk.", "kMWWWWWMk", "kMWkkkWMk", "kMWWWWWMk", ".kMMMMMk.", "..kkkkk..", "....k....", "...kkk..."];
export const SCANNER_PAL = { k: C.ink, M: C.metal, W: C.white };

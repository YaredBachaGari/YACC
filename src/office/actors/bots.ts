// Robot agents: where they walk and what they show, derived from live status.

import { Sprite, type Container } from "pixi.js";
import type { AgentConfig, AgentState } from "../../data/types";
import type { Tile } from "../engine/path";
import { robotSprites, type Facing } from "../draw/robots";
import { tileCentre, type OfficeLayout } from "../layout/layout";

export type Face = "up" | "down" | "left" | "right";
export type EmoteType = "talk" | "coffee" | "mail" | "ok" | "heart";

type Errand =
  | { kind: "plan" }
  | { kind: "drop"; onArrive: () => void; deadline: number }
  | { kind: "coffee" }
  | { kind: "wander" };

const SPEED = 52; // px per second

export class Bot {
  x: number;
  y: number;
  path: Tile[] = [];
  face: Face = "up";
  seated = false;
  errand: Errand | null = null;
  pause = 0; // seconds to linger before the next idle errand
  emote: { type: EmoteType; until: number } | null = null;
  carry: number | null = null; // PR number being carried
  headY = 0;
  color: string;
  isLead: boolean;
  readonly sprite: Sprite;
  private sprites: ReturnType<typeof robotSprites>;

  constructor(public config: AgentConfig, public index: number, start: { x: number; y: number }, layer: Container) {
    this.x = start.x;
    this.y = start.y;
    this.color = config.color;
    this.isLead = config.isLead;
    this.sprites = robotSprites(config.color, config.isLead);
    this.sprite = new Sprite(this.sprites.textures.back);
    layer.addChild(this.sprite);
  }

  restyle(config: AgentConfig) {
    this.config = config;
    if (config.color !== this.color || config.isLead !== this.isLead) {
      this.color = config.color;
      this.isLead = config.isLead;
      this.sprites = robotSprites(config.color, config.isLead);
    }
  }

  destroy() {
    this.sprite.destroy();
  }

  tile(l: OfficeLayout): Tile {
    return [Math.floor((this.x - l.ox) / 16), Math.floor((this.y - l.oy) / 16)];
  }

  goTo(l: OfficeLayout, target: Tile) {
    const [sx, sy] = l.grid.nearest(...this.tile(l));
    this.path = l.grid.find(sx, sy, target[0], target[1]);
    this.seated = false;
  }

  move(dt: number, l: OfficeLayout) {
    if (!this.path.length) return;
    const next = tileCentre(l, this.path[0]);
    const dx = next.x - this.x;
    const dy = next.y - this.y;
    const dist = Math.hypot(dx, dy);
    const step = SPEED * dt;
    if (Math.abs(dx) > Math.abs(dy)) this.face = dx > 0 ? "right" : "left";
    else if (Math.abs(dy) > 0.01) this.face = dy > 0 ? "down" : "up";
    if (dist <= step) {
      this.x = next.x;
      this.y = next.y;
      this.path.shift();
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }
  }

  /** Positions the sprite for this frame. */
  render(t: number, state: AgentState) {
    const moving = this.path.length > 0;
    const hover = 3 + (Math.floor(t * (moving ? 6 : 2.5) + this.index) % 2);
    const x = Math.round(this.x) - 6;
    const y = Math.round(this.y) - 13 - hover;
    let f: Facing = "front";
    if (this.face === "up") f = this.seated && state === "working" && Math.floor(t * 8) % 2 ? "type" : "back";
    else if (this.face === "right") f = "side";
    else if (this.face === "left") f = "sideL";
    this.sprite.texture = this.sprites.textures[f];
    this.sprite.position.set(x, y);
    this.sprite.zIndex = Math.round(this.y);
    this.headY = y;
  }
}

/** Decides each bot's next move from its agent's state. */
export function think(bot: Bot, l: OfficeLayout, state: AgentState, simT: number, rand: () => number) {
  if (bot.path.length) return;
  const seat = seatOf(bot, l);
  const atSeat = seat && Math.abs(bot.x - tileCentre(l, seat).x) < 1 && Math.abs(bot.y - tileCentre(l, seat).y) < 1;

  // Finish an errand on arrival.
  const e = bot.errand;
  if (e) {
    if (e.kind === "drop") {
      bot.errand = null;
      e.onArrive();
      return;
    }
    if (e.kind === "plan") bot.emote = { type: "talk", until: simT + 1.6 };
    if (e.kind === "coffee") bot.emote = { type: "coffee", until: simT + 2.4 };
    bot.errand = null;
    bot.pause = e.kind === "wander" ? 2 + rand() * 3 : 1.8;
    return;
  }
  if (bot.pause > 0) return;

  if (state !== "idle") {
    if (seat && !atSeat) bot.goTo(l, seat);
    else {
      bot.seated = true;
      bot.face = "up";
    }
    return;
  }
  // Idle: coffee, then wander.
  if (rand() < 0.5 && l.lounge.coffee.length) {
    bot.errand = { kind: "coffee" };
    bot.goTo(l, l.lounge.coffee[bot.index % l.lounge.coffee.length]);
  } else if (l.wander.length) {
    bot.errand = { kind: "wander" };
    bot.goTo(l, l.wander[Math.floor(rand() * l.wander.length)]);
  }
  if (!bot.path.length) bot.errand = null;
}

export function seatOf(bot: Bot, l: OfficeLayout): Tile | null {
  if (bot.config.isLead) return l.lead.seat;
  return l.desks.find((d) => d.agentId === bot.config.id)?.seat ?? null;
}

export function sendOnErrand(bot: Bot, l: OfficeLayout, errand: Errand, target: Tile) {
  bot.errand = errand;
  bot.pause = 0;
  bot.goTo(l, target);
  if (!bot.path.length && errand.kind === "drop") {
    bot.errand = null;
    errand.onArrive();
  }
}

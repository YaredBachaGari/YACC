// Reconciles the scene's actors with a new snapshot: layout rebuilds, bots,
// parcels, and one-off reactions to new activity and Team MCP messages.

import type { OfficeSnapshot, ReviewState } from "../data/types";
import { Bot, seatOf, sendOnErrand } from "./actors/bots";
import { BeltPath, type Parcel } from "./actors/parcels";
import { C } from "./engine/palette";
import { generateLayout, layoutKey, tileCentre } from "./layout/layout";
import type { OfficeScene } from "./OfficeScene";

export function syncScene(s: OfficeScene, snap: OfficeSnapshot, epoch: number) {
  const fresh = epoch !== s.epoch;
  if (fresh) {
    s.epoch = epoch;
    for (const b of s.bots.values()) b.destroy();
    s.bots.clear();
    s.parcels = [];
    s.prevReview.clear();
    s.seenActivity.clear();
    s.seenMessages.clear();
    s.effects.clear();
    s.layout = null;
  }

  // ---------------------------------------------------------- layout
  const key = layoutKey(snap.config, snap.environments);
  const firstLayout = !s.layout;
  if (!s.layout || s.layout.key !== key) {
    const l = generateLayout(snap.config, snap.environments);
    s.layout = l;
    s.belt = new BeltPath(l);
    s.setStatic(l, snap.config);
    if (firstLayout) s.camera.home(false);
    for (const b of s.bots.values()) {
      if (b.errand?.kind === "drop") b.errand.onArrive();
      b.errand = null;
      b.path = [];
      const [nx, ny] = l.grid.nearest(...b.tile(l));
      const c = tileCentre(l, [nx, ny]);
      b.x = c.x;
      b.y = c.y;
    }
  }
  const l = s.layout;

  // ---------------------------------------------------------- bots
  const ids = new Set(snap.config.team.map((a) => a.id));
  for (const [id, b] of s.bots) if (!ids.has(id)) (b.destroy(), s.bots.delete(id));
  snap.config.team.forEach((a, i) => {
    const existing = s.bots.get(a.id);
    if (existing) {
      existing.restyle(a);
      existing.index = i;
      return;
    }
    const bot = new Bot(a, i, { x: 0, y: 0 }, s.actors);
    const seat = seatOf(bot, l);
    const start = fresh || firstLayout || !seat ? (seat ?? l.door) : l.door;
    Object.assign(bot, tileCentre(l, start));
    s.bots.set(a.id, bot);
  });

  // ---------------------------------------------------------- parcels
  // Closed-without-merge PRs leave the office.
  const prs = new Map(snap.pullRequests.filter((p) => !p.closed).map((p) => [p.number, p]));
  s.prs = prs;
  s.parcels = s.parcels.filter((p) => prs.has(p.num) && p.mode !== "gone");
  for (const pr of snap.pullRequests) {
    const prev = s.prevReview.get(pr.number);
    if (prev === undefined && !pr.merged && !s.parcels.some((p) => p.num === pr.number)) {
      const parcel: Parcel = { num: pr.number, authorId: pr.authorId, mode: "belt", s: s.dropS(pr.authorId), fly: null };
      s.parcels.push(parcel);
      const bot = s.bots.get(pr.authorId);
      const desk = l.desks.find((d) => d.agentId === pr.authorId);
      if (fresh) {
        if (pr.review === "changes-requested") parcel.mode = "home";
        else if (pr.review === "passed" && s.belt.gateExit !== null) parcel.s = s.belt.gateExit;
      } else if (bot && desk) {
        parcel.mode = "carry";
        bot.carry = pr.number;
        sendOnErrand(bot, l, {
          kind: "drop",
          deadline: s.t + 8,
          onArrive: () => {
            bot.carry = null;
            if (parcel.mode === "carry") {
              parcel.mode = "belt";
              parcel.s = s.dropS(pr.authorId);
            }
          },
        }, desk.drop);
      }
    }
    if (prev !== undefined && prev !== pr.review) reviewChanged(s, pr.review);
    s.prevReview.set(pr.number, pr.review);
  }

  // ---------------------------------------------------------- activity + messages
  const lead = snap.config.team.find((a) => a.isLead);
  for (const ev of [...snap.activity].reverse()) {
    if (s.seenActivity.has(ev.id)) continue;
    s.seenActivity.add(ev.id);
    if (fresh) continue;
    if (ev.type === "task.assigned" && lead && ev.agentId === lead.id) {
      const bot = s.bots.get(lead.id);
      if (bot && !bot.errand) sendOnErrand(bot, l, { kind: "plan" }, l.plan.spot);
    }
  }
  for (const m of [...snap.messages].reverse()) {
    if (s.seenMessages.has(m.id)) continue;
    s.seenMessages.add(m.id);
    if (fresh) continue;
    const from = s.bots.get(m.fromId);
    const to = s.bots.get(m.toId);
    if (!from || !to) continue;
    s.effects.envelope(from.x, from.headY, m.toId);
    from.emote = { type: "talk", until: s.t + 1.4 };
    to.emote = { type: "mail", until: s.t + 2.6 };
  }
}

function reviewChanged(s: OfficeScene, review: ReviewState) {
  const g = s.layout?.gate;
  if (!g) return;
  const cx = g.x + g.w / 2;
  if (review === "passed") {
    s.gateMode = { mode: "passed", at: s.t };
    s.effects.text("PASSED", cx, g.y - 20, C.green);
    if (!s.reducedMotion) s.effects.burst(cx, g.y - 6, [C.green, C.yellow, C.white]);
  } else if (review === "changes-requested") {
    s.gateMode = { mode: "changes", at: s.t };
    s.effects.text("CHANGES", cx, g.y - 20, C.red);
  }
}

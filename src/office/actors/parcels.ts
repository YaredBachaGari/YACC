// PR parcels on the belt. Their position is driven by the PR's review state:
// desk → belt → gate (scan) → back to the desk on changes, on through on pass,
// → main on merge.

import type { PullRequest } from "../../data/types";
import type { OfficeLayout } from "../layout/layout";

type Mode = "carry" | "belt" | "scan" | "fly" | "home" | "gone";

export interface Parcel {
  num: number;
  authorId: string;
  mode: Mode;
  s: number; // distance along the belt
  fly: { from: Pt; to: Pt; t: number; then: Mode; s: number } | null;
}

interface Pt {
  x: number;
  y: number;
}

const BELT_SPEED = 40;
const GAP = 12;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class BeltPath {
  readonly hLen: number;
  readonly len: number;
  readonly gateEntry: number | null;
  readonly gateCentre: number | null;
  /** Where passed parcels wait: just past the gate housing, so they stay visible. */
  readonly gateExit: number | null;

  constructor(private l: OfficeLayout) {
    const b = l.belt;
    this.hLen = b.x1 - b.x0;
    this.len = this.hLen + (b.topY !== null ? b.y - b.topY : 0);
    this.gateEntry = l.gate ? l.gate.x - 6 - b.x0 : null;
    this.gateCentre = l.gate ? l.gate.x + l.gate.w / 2 - b.x0 : null;
    this.gateExit = l.gate ? l.gate.x + l.gate.w + 10 - b.x0 : null;
  }

  pos(s: number): Pt {
    const b = this.l.belt;
    return s <= this.hLen ? { x: b.x0 + s, y: b.y } : { x: b.x1, y: b.y - (s - this.hLen) };
  }

  sAtX(x: number) {
    return Math.max(0, Math.min(this.hLen, x - this.l.belt.x0));
  }
}

export interface ParcelHooks {
  deskPos(agentId: string): Pt | null;
  dropS(agentId: string): number;
  onMerged(p: Parcel): void;
}

export function updateParcels(parcels: Parcel[], prs: Map<number, PullRequest>, path: BeltPath, dt: number, hooks: ParcelHooks) {
  // Fly-ins / fly-outs
  for (const p of parcels) {
    if (p.mode !== "fly" || !p.fly) continue;
    p.fly.t = Math.min(1, p.fly.t + dt / 0.9);
    if (p.fly.t >= 1) {
      p.mode = p.fly.then;
      p.s = p.fly.s;
      p.fly = null;
    }
  }

  const onBelt = parcels.filter((p) => p.mode === "belt" || p.mode === "scan").sort((a, b) => b.s - a.s);
  let scanning = onBelt.some((p) => p.mode === "scan");

  for (const p of parcels) {
    const pr = prs.get(p.num);
    if (!pr || p.mode === "gone" || p.mode === "fly" || p.mode === "carry") continue;
    const desk = hooks.deskPos(p.authorId);

    if (pr.review === "changes-requested" && !pr.merged) {
      if ((p.mode === "belt" || p.mode === "scan") && desk) {
        p.fly = { from: path.pos(p.s), to: desk, t: 0, then: "home", s: 0 };
        p.mode = "fly";
        if (p.mode === "fly") scanning = onBelt.some((q) => q !== p && q.mode === "scan");
      }
      continue;
    }
    if (p.mode === "home") {
      const s = pr.review === "passed" || pr.merged ? path.gateExit !== null ? path.gateExit : hooks.dropS(p.authorId) : hooks.dropS(p.authorId);
      p.fly = { from: desk ?? path.pos(s), to: path.pos(s), t: 0, then: "belt", s };
      p.mode = "fly";
    }
  }

  // Move along the belt, keeping a gap behind the parcel ahead.
  let ahead: Parcel | null = null;
  for (const p of onBelt) {
    const pr = prs.get(p.num);
    if (!pr || p.mode === "fly" || p.mode === "home") continue;
    let target: number;
    if (pr.merged) target = path.len;
    else if (pr.review === "passed" || path.gateEntry === null) target = path.gateExit !== null ? Math.max(p.s, path.gateExit) : path.len - 30;
    else if (pr.review === "reviewing" && !scanning && path.gateCentre !== null && p.s >= path.gateEntry - 1) {
      target = path.gateCentre;
      p.mode = "scan";
      scanning = true;
    } else target = p.mode === "scan" && path.gateCentre !== null ? path.gateCentre : path.gateEntry;
    if (ahead && !pr.merged && ahead.mode !== "gone") target = Math.min(target, ahead.s - GAP);
    if (pr.review === "passed" && p.mode === "scan") p.mode = "belt";
    // Merged parcels hurry to main so the belt never lags far behind the PR state.
    if (p.s < target) p.s = Math.min(target, p.s + BELT_SPEED * (pr.merged ? 2.5 : 1) * dt);
    if (pr.merged && p.s >= path.len - 0.5) {
      p.mode = "gone";
      hooks.onMerged(p);
      continue;
    }
    ahead = p;
  }
}

/** World position of a parcel for drawing, or null when hidden. */
export function parcelPos(p: Parcel, path: BeltPath): (Pt & { lift: number }) | null {
  if (p.mode === "belt" || p.mode === "scan") return { ...path.pos(p.s), lift: 0 };
  if (p.mode === "fly" && p.fly) {
    const e = easeInOut(p.fly.t);
    const x = p.fly.from.x + (p.fly.to.x - p.fly.from.x) * e;
    const y = p.fly.from.y + (p.fly.to.y - p.fly.from.y) * e;
    return { x, y, lift: Math.sin(e * Math.PI) * 30 };
  }
  return null;
}

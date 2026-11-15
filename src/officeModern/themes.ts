// Office themes (plan step 5.4): the modern office's palette, floor, wall and furniture, as data.
// The drawing code reads the active theme; templates pick one (Software Team → Modern,
// Content Studio → Studio, R&D Lab → Lab), and Settings → Project changes it.

import type { ThemeId } from "../data/types";

export interface OfficeTheme {
  id: ThemeId;
  label: string;
  description: string;
  floor: { kind: "planks" | "tiles" | "concrete"; base: string; line: string };
  wall: { kind: "plain" | "brick"; top: string; bottom: string; skirting: string; brick?: string };
  /** Windows show day or night. */
  night: boolean;
  sign: { bg: string; fg: string };
  corridor: string;
  rug: { fill: string; line: string };
  rooms: { ceo: string; lead: string; meeting: string; lounge: string };
  desk: { top: string; lead: string; ceo: string };
  chair: string;
  sofa: [string, string, string]; // seat, back, arms
  table: [string, string]; // edge, top
  /** 0 none, 1 a few, 2 many. */
  plants: number;
  pot: string;
  /** Room labels ("Lounge") and other quiet text. */
  muted: string;
  /** Around the building. */
  outside: string;
  /** Three swatches for the theme picker. */
  swatches: [string, string, string];
}

export const THEMES: Record<ThemeId, OfficeTheme> = {
  modern: {
    id: "modern",
    label: "Modern",
    description: "Warm wood, light walls and big windows.",
    floor: { kind: "planks", base: "#eadcc4", line: "rgba(160,120,80,0.16)" },
    wall: { kind: "plain", top: "#f7f3ec", bottom: "#ebe4d8", skirting: "#cdbfa9" },
    night: false,
    sign: { bg: "#2b2433", fg: "#ffffff" },
    corridor: "rgba(120,96,70,0.08)",
    rug: { fill: "#dfe7e3", line: "#c6d4cd" },
    rooms: { ceo: "#e7dff0", lead: "#efe3cf", meeting: "#e3ebe6", lounge: "#f1e6dc" },
    desk: { top: "#d9b48a", lead: "#cfa47a", ceo: "#8a6446" },
    chair: "#3d3a48",
    sofa: ["#3f7f8f", "#4f95a6", "#2f5f6b"],
    table: ["#b5865e", "#cfa47a"],
    plants: 1,
    pot: "#c46a4a",
    muted: "#7b7183",
    outside: "#bfcbbd",
    swatches: ["#eadcc4", "#d9b48a", "#3f7f8f"],
  },
  studio: {
    id: "studio",
    label: "Studio",
    description: "A creative studio: terracotta, blush walls and lots of plants.",
    floor: { kind: "planks", base: "#efd9c3", line: "rgba(170,110,70,0.16)" },
    wall: { kind: "plain", top: "#fbeee8", bottom: "#f3dcd2", skirting: "#d9b2a0" },
    night: false,
    sign: { bg: "#a8432c", fg: "#fff6ee" },
    corridor: "rgba(170,90,60,0.08)",
    rug: { fill: "#f4d7c4", line: "#e6b99c" },
    rooms: { ceo: "#f6e1ea", lead: "#f7e6cf", meeting: "#e8efe0", lounge: "#f8e2d4" },
    desk: { top: "#e8c9a3", lead: "#deb386", ceo: "#9a5a3c" },
    chair: "#6a4a5c",
    sofa: ["#d0765a", "#de8a6e", "#a85a42"],
    table: ["#b8774f", "#d79a6c"],
    plants: 2,
    pot: "#e3a55a",
    muted: "#8a6f6a",
    outside: "#d6cbb8",
    swatches: ["#f4d7c4", "#c4573e", "#3f9b5f"],
  },
  lab: {
    id: "lab",
    label: "Lab",
    description: "Clean white desks, tiled floor and teal accents.",
    floor: { kind: "tiles", base: "#e8eef0", line: "rgba(90,130,140,0.18)" },
    wall: { kind: "plain", top: "#f8fbfb", bottom: "#e7f0f1", skirting: "#b8cfd2" },
    night: false,
    sign: { bg: "#137a7f", fg: "#ffffff" },
    corridor: "rgba(40,120,130,0.07)",
    rug: { fill: "#d7ecec", line: "#b4d8d9" },
    rooms: { ceo: "#e4ecf6", lead: "#e7f1ee", meeting: "#e1eef2", lounge: "#eef1ea" },
    desk: { top: "#f4f6f7", lead: "#e9eef0", ceo: "#5d6b74" },
    chair: "#2f5e66",
    sofa: ["#3d8c90", "#55a6aa", "#2b6a6e"],
    table: ["#a9b8bd", "#dbe4e7"],
    plants: 1,
    pot: "#ffffff",
    muted: "#62767c",
    outside: "#c8d6d8",
    swatches: ["#e8eef0", "#f4f6f7", "#137a7f"],
  },
  loft: {
    id: "loft",
    label: "Loft",
    description: "Brick walls, dark wood and leather.",
    floor: { kind: "planks", base: "#8f6b4f", line: "rgba(40,24,14,0.25)" },
    wall: { kind: "brick", top: "#b5654a", bottom: "#a3573e", skirting: "#4a3428", brick: "rgba(255,230,210,0.22)" },
    night: false,
    sign: { bg: "#1f1a17", fg: "#f2c36b" },
    corridor: "rgba(30,18,10,0.12)",
    rug: { fill: "#c9b79c", line: "#a8957a" },
    rooms: { ceo: "#d9c9b6", lead: "#cdb497", meeting: "#c7c0aa", lounge: "#d6bfa5" },
    desk: { top: "#6b4a34", lead: "#5c3e2b", ceo: "#3e2a1e" },
    chair: "#2a2320",
    sofa: ["#7a4a2c", "#8e5a38", "#5c3720"],
    table: ["#4f3626", "#6b4a34"],
    plants: 1,
    pot: "#3a3a3a",
    muted: "#6b5644",
    outside: "#9aa39a",
    swatches: ["#b5654a", "#6b4a34", "#f2c36b"],
  },
  night: {
    id: "night",
    label: "Night shift",
    description: "Dark and calm, with the city outside.",
    floor: { kind: "concrete", base: "#2c2f3a", line: "rgba(255,255,255,0.05)" },
    wall: { kind: "plain", top: "#1d2030", bottom: "#24283a", skirting: "#3a3f55" },
    night: true,
    sign: { bg: "#6c5ce7", fg: "#ffffff" },
    corridor: "rgba(255,255,255,0.04)",
    rug: { fill: "#353a4b", line: "#454b61" },
    rooms: { ceo: "#363250", lead: "#343a4a", meeting: "#2f3c44", lounge: "#3a3444" },
    desk: { top: "#4a4f63", lead: "#555b72", ceo: "#2a2d3a" },
    chair: "#181a24",
    sofa: ["#5a4fbf", "#6c5ce7", "#4337a0"],
    table: ["#3c4152", "#4f5568"],
    plants: 1,
    pot: "#6c5ce7",
    muted: "#a7a9bf",
    outside: "#151824",
    swatches: ["#24283a", "#4a4f63", "#6c5ce7"],
  },
};

export const themeOf = (id: ThemeId | undefined): OfficeTheme => THEMES[id ?? "modern"] ?? THEMES.modern;

// Office palette (PICO-8 flavoured). HUD-shared colours come from theme/tokens.

import { colors } from "../../theme/tokens";

export const C = {
  ink: colors.ink,
  grass: "#4a8f3d", grassD: "#3d7a34", grassL: "#62a84a",
  path: "#d9c49a", pathD: "#bfa57a",
  wood: "#c98e5b", woodD: "#b37a4a", woodL: "#d8a06c", woodLine: "#94603a",
  wall: "#4f7a6e", wallD: "#41675c", wallL: "#5f8b7e", wallTop: "#2c3d42", wallTopL: "#4a5d61", base: "#6b4a3a",
  wallSrv: "#3e4a5e", wallSrvD: "#323d50",
  carpetJ: "#8e3b46", carpetJD: "#742f39",
  rugG: "#5f8f52", rugGD: "#4e7a43", rugP: "#7a5a8e", rugPD: "#664a78",
  tileL: "#e9dcc6", tileD: "#d3c3a8",
  grate: "#4f4a52", grateD: "#3b373e", grateL: "#625c66",
  part: "#8b9bb4", partD: "#6b7a94", partCap: "#c9d1de",
  desk: "#b97a4b", deskD: "#8a5a3b", deskDD: "#5e3a26",
  metal: "#c2c3c7", metalL: "#e4e3ea", metalD: "#8e8a96", metalDD: "#5f5a66",
  screen: "#111d35", bezel: "#3a3f55",
  leaf: "#38b764", leafD: "#257953", leafL: "#73d36b", pot: "#b5523b", potD: "#8a3b2a",
  belt: "#3a3640", beltL: "#57525e", rail: "#9d98a6",
  cork: "#c48a52", corkD: "#9b6638",
  sky: "#8fd3ff", skyN: "#1d2b53", cloud: "#ffffff",
  couch: "#3f7f8f", couchD: "#2f5f6b",
  red: colors.red, orange: colors.orange, yellow: colors.yellow, green: colors.green, blue: colors.blue, lav: colors.lav,
  pink: colors.pink, peach: "#ffccaa", white: colors.white, navy: colors.navy,
  rabbit: "#ff7a30", gold: "#ffcf3a",
  shadow: "#241a2e",
} as const;

/** Floor carpet colours for desks, cycled by desk index. */
export const deskCarpets: [string, string][] = [
  ["#3e5f8a", "#334f75"],
  ["#b5893a", "#9a7230"],
  ["#4f7f5a", "#41694a"],
  ["#7a4f7e", "#663f69"],
  ["#8a5a3e", "#744a32"],
  ["#3f7f8f", "#2f5f6b"],
];

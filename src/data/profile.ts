// Agent and CEO profiles: how they look in the office, and a short bio.
// Shared by the browser and the server so both clean input the same way.

import { THEME_IDS, type AvatarConfig, type ThemeId } from "./types";

export const BIO_MAX = 280;
/** Uploaded pictures are resized in the browser to this square before upload. */
export const AVATAR_PX = 128;
/** The largest upload the server accepts (a 128px PNG is usually 10–40 KB). */
export const AVATAR_MAX_BYTES = 200 * 1024;
/** Index ranges of the built-in looks (see officeModern/avatar.ts). */
export const SKIN_COUNT = 6;
export const HAIR_COUNT = 8;
export const STYLE_COUNT = 5;

const index = (v: unknown, count: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < count ? v : undefined);

/** A file name for an uploaded avatar, relative to .yacc/: avatars/<id>-<stamp>.png. */
export const AVATAR_IMAGE = /^avatars\/[a-z0-9][a-z0-9-]{0,80}\.png$/;

/**
 * Keeps only the parts of an avatar that make sense. Undefined when nothing is left,
 * so a profile with no choices doesn't write an empty `avatar: {}`.
 */
export function cleanAvatar(raw: unknown): AvatarConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  const out: AvatarConfig = {};
  const skin = index(v.skin, SKIN_COUNT);
  const hair = index(v.hair, HAIR_COUNT);
  const style = index(v.style, STYLE_COUNT);
  if (skin !== undefined) out.skin = skin;
  if (hair !== undefined) out.hair = hair;
  if (style !== undefined) out.style = style;
  if (typeof v.glasses === "boolean") out.glasses = v.glasses;
  if (typeof v.image === "string" && AVATAR_IMAGE.test(v.image)) out.image = v.image;
  return Object.keys(out).length ? out : undefined;
}

/** A bio on one paragraph, at most BIO_MAX characters. */
export function cleanBio(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, BIO_MAX) : "";
}

export function cleanTheme(raw: unknown): ThemeId | undefined {
  return THEME_IDS.find((t) => t === raw);
}

/** Is this the start of a PNG file? */
export function isPng(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length > sig.length && sig.every((b, i) => bytes[i] === b);
}

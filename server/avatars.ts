// Uploaded profile pictures, kept in the repo under .yacc/avatars/ so teammates see the same office.
// The browser resizes to a small square PNG first; here we only check it and write it.
// Each upload gets a new file name, so browsers never show a stale cached picture.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { AVATAR_IMAGE, AVATAR_MAX_BYTES, isPng } from "../src/data/profile";

const dir = (root: string) => join(root, ".yacc", "avatars");

export class AvatarError extends Error {}

/** Checks and writes a picture for `who` (an agent id or "ceo"). Returns its path relative to .yacc/. */
export function saveAvatar(root: string, who: string, base64: string): string {
  const clean = base64.replace(/^data:image\/png;base64,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw new AvatarError("The picture isn't valid base64.");
  const bytes = Buffer.from(clean, "base64");
  if (bytes.length > AVATAR_MAX_BYTES) throw new AvatarError(`The picture is too large (${Math.round(bytes.length / 1024)} KB; at most ${AVATAR_MAX_BYTES / 1024} KB).`);
  if (!isPng(bytes)) throw new AvatarError("The picture must be a PNG.");
  const id = who.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "agent";
  const rel = `avatars/${id}-${randomBytes(4).toString("hex")}.png`;
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(join(root, ".yacc", rel), bytes);
  return rel;
}

/** Deletes a picture HQ wrote (anything else is left alone). */
export function removeAvatar(root: string, rel: string | undefined) {
  if (!rel || !AVATAR_IMAGE.test(rel)) return;
  rmSync(join(root, ".yacc", rel), { force: true });
}

/** The bytes for GET /avatars/<file>, or null when there is no such picture. */
export function readAvatar(root: string, file: string): Buffer | null {
  const rel = `avatars/${file}`;
  if (!AVATAR_IMAGE.test(rel)) return null;
  const path = join(root, ".yacc", rel);
  return existsSync(path) ? readFileSync(path) : null;
}

// A profile (plan step 5.1): how someone looks in the office (a built-in look, or a picture you
// upload), their colour and a short bio. Used for agents and for you, the CEO.

import { useRef, useState } from "react";
import { AVATAR_MAX_BYTES, AVATAR_PX, BIO_MAX } from "../../data/profile";
import type { AvatarConfig } from "../../data/types";
import { AVATAR_PRESETS, HAIR, HAIR_STYLES, SKIN, lookFor } from "../../officeModern/avatar";
import { agentPalette } from "../../theme/tokens";
import { Field, Portrait } from "../kit";
import { CommitInput, Toggle } from "./controls";

/**
 * Reads an image file, crops it to the middle square and scales it to AVATAR_PX as a PNG.
 * Returns the PNG as base64 (no data: prefix).
 */
export async function squarePng(file: Blob, px = AVATAR_PX): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This browser can't resize pictures.");
  g.imageSmoothingQuality = "high";
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, px, px);
  bitmap.close?.();
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

interface Props {
  /** The id the default look comes from (agents: their id; the CEO: "ceo:<name>"). */
  lookId: string;
  name: string;
  avatar?: AvatarConfig;
  color: string;
  lead?: boolean;
  onLook: (avatar: AvatarConfig | null) => void;
  onPhoto: (png: string | null) => void;
  onColor?: (color: string) => void;
  bio?: string;
  onBio?: (bio: string) => void;
}

export function ProfileEditor({ lookId, name, avatar, color, lead = false, onLook, onPhoto, onColor, bio, onBio }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const look = lookFor(lookId, avatar);
  const { image: _image, ...current } = avatar ?? {};
  // The parts of the look that are set, filled in from the default so one change keeps the rest.
  const full: AvatarConfig = { skin: SKIN.indexOf(look.skin), hair: HAIR.indexOf(look.hair), style: look.style, glasses: look.glasses };
  const change = (patch: AvatarConfig) => onLook({ ...full, ...current, ...patch });
  const same = (p: AvatarConfig) => p.skin === full.skin && p.hair === full.hair && p.style === full.style && !!p.glasses === !!full.glasses;

  const upload = async (f: File | undefined) => {
    setError("");
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("Pick an image file (PNG, JPEG, WebP or GIF).");
    setBusy(true);
    try {
      const png = await squarePng(f);
      if ((png.length * 3) / 4 > AVATAR_MAX_BYTES) return setError("That picture is too detailed to keep small. Try another one.");
      onPhoto(png);
    } catch {
      setError("Couldn't read that picture. Try a PNG or JPEG.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="grid grid-cols-[96px_1fr] gap-3" aria-label={`${name}'s profile`}>
      <div className="flex flex-col items-center gap-2">
        <Portrait color={color} lead={lead} size={88} who={{ id: lookId, avatar }} forceFace />
        <button className="btn w-full px-1 text-[12px]" onClick={() => onLook(null)} disabled={!Object.keys(current).length} title="Back to the look HQ picked">
          Default look
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <span className="text-[14px] font-semibold">Look</span>
          <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Built-in looks">
            {AVATAR_PRESETS.map((p, i) => (
              <button
                key={i}
                role="radio"
                aria-checked={!avatar?.image && same(p)}
                aria-label={`Look ${i + 1}`}
                className="rounded-full p-0.5"
                style={{ outline: !avatar?.image && same(p) ? "3px solid #241a2e" : undefined }}
                onClick={() => onLook(p)}
              >
                <Portrait color={color} lead={lead} size={40} who={{ id: lookId, avatar: p }} forceFace />
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Skin">
            <div className="flex flex-wrap gap-1.5">
              {SKIN.map((c, i) => (
                <button key={c} className="h-6 w-6 rounded-full border-[3px] border-ink" style={{ background: c, outline: i === full.skin ? "3px solid #241a2e" : undefined, outlineOffset: 1 }} aria-label={`Skin tone ${i + 1}`} aria-pressed={i === full.skin} onClick={() => change({ skin: i })} />
              ))}
            </div>
          </Field>
          <Field label="Hair">
            <div className="flex flex-wrap gap-1.5">
              {HAIR.map((c, i) => (
                <button key={c} className="h-6 w-6 rounded-full border-[3px] border-ink" style={{ background: c, outline: i === full.hair ? "3px solid #241a2e" : undefined, outlineOffset: 1 }} aria-label={`Hair colour ${i + 1}`} aria-pressed={i === full.hair} onClick={() => change({ hair: i })} />
              ))}
            </div>
          </Field>
          <Field label="Hair style">
            <select className="field" value={full.style} onChange={(e) => change({ style: Number(e.target.value) })}>
              {HAIR_STYLES.map((s, i) => (
                <option key={s} value={i}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end pb-1">
            <Toggle checked={!!full.glasses} onChange={(v) => change({ glasses: v })} label="Glasses" />
          </div>
        </div>
        <Field label="Picture" hint={`Optional. Shown round, in place of the drawn face. Cropped to a square and shrunk to ${AVATAR_PX}px in your browser, then kept in .yacc/avatars/.`}>
          <div className="flex items-center gap-2">
            <input ref={file} type="file" accept="image/*" className="sr-only" aria-label={`Upload a picture for ${name}`} onChange={(e) => void upload(e.target.files?.[0])} />
            <button className="btn px-2 text-[13px]" onClick={() => file.current?.click()} disabled={busy}>
              {busy ? "Resizing…" : avatar?.image ? "Replace picture" : "Upload picture"}
            </button>
            {avatar?.image && (
              <button className="btn px-2 text-[13px] text-red" onClick={() => onPhoto(null)}>
                Remove picture
              </button>
            )}
            {error && <span role="alert" className="text-[12px] text-red">{error}</span>}
          </div>
        </Field>
        {onColor && (
          <Field label="Colour" hint="Their shirt in the office, and their colour in panels and charts.">
            <div className="flex flex-wrap gap-1.5">
              {agentPalette.map((c) => (
                <button
                  key={c}
                  className="h-6 w-6 border-[3px] border-ink"
                  style={{ background: c, outline: c === color ? "3px solid #241a2e" : undefined, outlineOffset: 1 }}
                  aria-label={`Colour ${c}`}
                  aria-pressed={c === color}
                  onClick={() => onColor(c)}
                />
              ))}
            </div>
          </Field>
        )}
        {onBio && (
          <Field label="Bio" hint={`Up to ${BIO_MAX} characters. Shown in their drawer; they read it in their role file, and teammates see it in list_workers.`}>
            <CommitInput multiline className="field h-[64px] resize-y" maxLength={BIO_MAX} value={bio ?? ""} placeholder={`e.g. ${name} cares about small, well-tested changes and clear notes.`} onCommit={(v) => onBio(v)} />
          </Field>
        )}
      </div>
    </div>
  );
}

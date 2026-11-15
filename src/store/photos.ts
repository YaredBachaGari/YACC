// Uploaded profile pictures, loaded once and shared by the office canvas and the panels.

import { useEffect, useState } from "react";
import type { AvatarConfig } from "../data/types";
import { useOffice } from "./office";

const cache = new Map<string, HTMLImageElement>();
const waiting = new Map<string, Set<() => void>>();

/** The loaded picture for a profile, or null (none, or still loading: drawn illustrated until then). */
export function photoFor(avatar: AvatarConfig | undefined, onLoad?: () => void): HTMLImageElement | null {
  const image = avatar?.image;
  if (!image) return null;
  const url = useOffice.getState().source.avatarUrl(image);
  if (!url) return null;
  let img = cache.get(url);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    const done = () => {
      for (const fn of waiting.get(url) ?? []) fn();
      waiting.delete(url);
    };
    img.onload = done;
    img.onerror = done;
    img.src = url;
    cache.set(url, img);
  }
  if (img.complete && img.naturalWidth > 0) return img;
  if (onLoad && !img.complete) {
    const set = waiting.get(url) ?? new Set();
    set.add(onLoad);
    waiting.set(url, set);
  }
  return null;
}

/** photoFor for React: re-renders when the picture arrives. */
export function usePhoto(avatar: AvatarConfig | undefined): HTMLImageElement | null {
  const [, bump] = useState(0);
  const img = photoFor(avatar, () => bump((n) => n + 1));
  useEffect(() => undefined, [avatar?.image]);
  return img;
}

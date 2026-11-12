/**
 * Parses a CLI's JSON output, ignoring anything printed before or after it
 * (sbx can add a notice, e.g. about an update, to the same output). Null when
 * there's no valid JSON object in it.
 */
export function parseCliJson<T>(text: string): T | null {
  // An object or an array, whichever starts first.
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i !== -1);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = text.lastIndexOf(text[start] === "{" ? "}" : "]");
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/**
 * The sandboxes from `sbx ls --json`. sbx ≤ 0.47 wraps them ({ "sandboxes": [...] }); newer
 * versions print the array itself. Null when the output can't be read at all.
 */
export function sandboxList<T = { name: string }>(text: string): T[] | null {
  const data = parseCliJson<T[] | { sandboxes?: T[] }>(text);
  if (data === null) return null;
  return Array.isArray(data) ? data : (data.sandboxes ?? []);
}

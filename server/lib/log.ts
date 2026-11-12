const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export const log = {
  info: (...a: unknown[]) => console.log(dim("[hq]"), ...a),
  warn: (...a: unknown[]) => console.warn("\x1b[33m[hq]\x1b[0m", ...a),
  error: (...a: unknown[]) => console.error("\x1b[31m[hq]\x1b[0m", ...a),
};

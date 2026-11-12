// node-pty's prebuilt `spawn-helper` must be executable, or every spawn fails
// with "posix_spawnp failed". Some installs unpack it without the execute bit;
// the postinstall script fixes it, and this repeats the fix at startup for
// package managers that skip install scripts. (Windows has no spawn-helper.)

import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function ensurePtyHelperExecutable() {
  if (process.platform === "win32") return;
  try {
    // @lydell/node-pty loads its binaries from a per-platform package.
    const require = createRequire(createRequire(import.meta.url).resolve("@lydell/node-pty"));
    const root = dirname(dirname(require.resolve(`@lydell/node-pty-${process.platform}-${process.arch}`)));
    const helper = join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    if (existsSync(helper) && !(statSync(helper).mode & 0o111)) chmodSync(helper, 0o755);
  } catch {
    // Best effort: if it still fails, the terminal shows the error.
  }
}

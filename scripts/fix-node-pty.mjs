// node-pty's prebuilt `spawn-helper` must be executable, or every spawn fails
// with "posix_spawnp failed". Some package managers unpack it without the
// execute bit. (Windows has no spawn-helper.)
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (process.platform !== "win32") {
  try {
    const require = createRequire(createRequire(import.meta.url).resolve("@lydell/node-pty"));
    const root = dirname(dirname(require.resolve(`@lydell/node-pty-${process.platform}-${process.arch}`)));
    const helper = join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    if (existsSync(helper)) chmodSync(helper, 0o755);
  } catch {
    // node-pty not installed (e.g. UI-only install) — nothing to fix.
  }
}

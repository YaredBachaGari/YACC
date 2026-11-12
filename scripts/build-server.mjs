// Bundles the HQ server into one ESM file for the npm package. node_modules
// stay external (installed as the package's runtime dependencies).
import { build } from "esbuild";

await build({
  entryPoints: ["server/main.ts"],
  outfile: "dist-server/main.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: false,
  logLevel: "warning",
});
console.log("built dist-server/main.mjs");

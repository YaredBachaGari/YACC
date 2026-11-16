// Builds the public gallery from templates/<id>/ folders: one <id>.yacc-template.json bundle
// each, and templates/index.json listing them. CI checks the files are up to date (--check).
//
//   npx tsx scripts/build-gallery.ts [--check]

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { templateToBundle } from "../src/data/templateBundle";
import { readTemplate } from "../server/templates";
import { skillFiles } from "../server/templateShare";

const root = join(import.meta.dirname, "..", "templates");
const check = process.argv.includes("--check");
const out: Record<string, string> = {};
const index: { id: string; name: string; description: string; url: string; tags: string[] }[] = [];
const TAGS: Record<string, string[]> = { "newsletter-desk": ["writing", "weekly"], "market-research": ["research"], "website-builder": ["software", "github"] };

for (const id of readdirSync(root).sort()) {
  const dir = join(root, id);
  if (!existsSync(join(dir, "template.yml"))) continue;
  const t = readTemplate(dir, "user");
  const bundle = templateToBundle(t, skillFiles(dir));
  out[`${id}.yacc-template.json`] = JSON.stringify(bundle, null, 2) + "\n";
  index.push({ id, name: t.name, description: t.description, url: `${id}.yacc-template.json`, tags: TAGS[id] ?? [] });
}
out["index.json"] = JSON.stringify({ format: "yacc-gallery", version: 1, templates: index }, null, 2) + "\n";

let stale = 0;
for (const [file, text] of Object.entries(out)) {
  const path = join(root, file);
  const now = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (now === text) continue;
  stale++;
  if (check) console.error(`out of date: templates/${file}`);
  else writeFileSync(path, text);
}
if (check && stale) {
  console.error("Run: npx tsx scripts/build-gallery.ts");
  process.exit(1);
}
console.log(`gallery: ${index.length} templates${check ? ", up to date" : stale ? `, wrote ${stale} file(s)` : ", nothing changed"}`);

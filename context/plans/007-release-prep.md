## Implementation plan: release prep

### What we're building
`npx jsm-hq` works from any git repo on a stranger's machine: compiled server, built UI in the package, a welcome screen on first run, a README for newcomers, a license, and CI. The package is published from **JSM's official npm account** (not a personal one); this work prepares it and does a dry run only.

### Decisions
- **License:** MIT, with the "JSM HQ" name and logo not licensed (`TRADEMARKS.md`). `initial-idea.md` lists this as Adrian's decision — confirm with him before the repo goes public.
- **Distribution:** npm package `jsm-hq` (`npx jsm-hq`), published by JSM's npm account. Homebrew later if asked; no desktop app or Docker image for v1.
- **Runtime dependencies only:** node-pty, ws, the MCP SDK, zod. The UI ships pre-built.
- **No templates:** HQ owns the plan and writes ROLE.md. Instead, an opt-in "Export plan to docs/plan.md" in Settings → Project (off by default — it writes a tracked file).
- **First run:** a welcome screen when the repo has no `.jsmhq/config.json`: project name, lead + workers (Claude/Codex each), review tool.

### How to build it
1. Compile the server with esbuild to `dist-server/`; `bin/jsm-hq.mjs` with `--repo`, `--port`, `--no-open`, `--version`, `--help`; serves the built UI by default.
2. package.json: name, version 0.1.0, `bin`, `files`, `engines` (Node ≥ 20), runtime-only dependencies, node-pty fix at install and at startup.
3. Welcome screen (UI + server command) for a new config.
4. Opt-in plan export to `docs/plan.md`.
5. `LICENSE` (MIT), `TRADEMARKS.md`, README rewritten for newcomers (requirements, 2-minute quickstart, troubleshooting).
6. GitHub Actions: typecheck + build on push and PR.
7. Verify like a stranger: `npm pack`, install the tarball in an empty folder, run it against a fresh repo.

- **Done when:** the packed tarball runs from a clean folder against a new repo, with no jsm-hq clone and no dev tools.

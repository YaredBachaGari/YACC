# Contributing to YACC

## Run it from source

Needs Node.js 20+ and pnpm 10 or 11 (`corepack enable` gets you pnpm).

```bash
git clone https://github.com/YaredBachaGari/YACC && cd YACC
pnpm install
pnpm dev                                   # the UI with fake data, no agents
HQ_REPO=~/developer/hq-test pnpm dev:hq    # the real HQ server + UI, with hot reload
```

`pnpm dev` is a demo with fake data: nothing runs and nothing leaves the browser. To test a change for real, use `pnpm dev:hq` or `pnpm hq` against a throwaway repo.

| Command | Does |
| --- | --- |
| `pnpm dev` | Demo UI with fake data at http://localhost:5173 |
| `pnpm dev:hq` | Real HQ server + UI with hot reload (`HQ_REPO=<path>`) |
| `pnpm hq` | Builds the UI, then runs HQ like a release (`--repo <path> --port 7420`) |
| `pnpm build` | Type-checks, builds the UI to `dist/` and the server to `dist-server/` |
| `pnpm typecheck` | Type-check only |
| `npm pack` | Builds the npm tarball, to test it before publishing |

Start HQ with `HQ_DEBUG=1` to log why a queued message is waiting.

## Where things are

```
src/
  data/      Types, the OfficeDataSource interface, fake (data/mock) and real (data/ws) data
  store/     Zustand stores; the only code that talks to the data source
  office/    The PixiJS pixel office: layout, sprites, agents, belt
  ui/        Top bar, team panel, activity, drawers, settings, setup checklist, welcome
server/      Local HQ server: setup checks, workspaces, sessions (tmux, or HQ-run on Windows), sbx, hooks, Team MCP, GitHub
bin/         The yacc-hq command
docs/        User guides
context/     Implementation plans, and the first UI build brief (001-ui-build-context.md)
```

## Docker Sandboxes versions

HQ calls the `sbx` CLI and reads its output. sbx 0.48 changed several outputs (for example `sbx ls --json` and `sbx mcp ls --json` now return a bare array), so read sbx output in a way that accepts both the old and the new format. HQ is tested on sbx 0.47 and 0.50.

## Releasing

YACC is not published to npm yet (`"private": true` in `package.json` blocks an accidental publish). Run it from source, or build a tarball with `npm pack` and install that.

## Upstream

YACC is a fork of [jsmastery-pro/jsm-hq](https://github.com/jsmastery-pro/jsm-hq). To bring in upstream engine fixes:

```bash
git remote add upstream https://github.com/jsmastery-pro/jsm-hq.git   # once
git fetch upstream
git merge upstream/main    # expect conflicts in renamed files; keep the YACC names
```

The fork point is upstream `1d0ecdb` (v0.7.5, 2026-11-09).

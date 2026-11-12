## Implementation plan: Linux and Windows support

### What we're building
`npx @therealjsmastery/jsm-hq` works the same on macOS, Linux and Windows 11: the office, sandboxes, Team MCP, delivery and the PR loop. Mac keeps exactly today's behaviour. Linux is a small fix; Windows gets its own session backend because tmux doesn't exist there.

### What we know
- **Linux blocker:** `node-pty` 1.1.0 ships prebuilt binaries for macOS and Windows only (`prebuilds/` has no `linux-*`). On Linux and WSL, npx has to compile it with python, make and g++, which a fresh machine doesn't have. Likely cause of the silent WSL failure.
- **Windows test (native, by accident):** HQ started, found the repo (`E:/jsm-hq-test`), and `sbx` 0.47 and Claude Code both ran natively. Only tmux was missing. Then `listen EACCES 127.0.0.1:7420`: Windows reserves port ranges for Hyper-V/WSL/Docker.
- **tmux is used for:** keeping agents alive across HQ restarts, creating/killing sessions, attaching the browser terminal (`tmux attach` in a pty), typing messages (`send-keys`), reading the screen (`capture-pane`: Codex readiness, exit details), and detecting exits (`paneInfo`). About 30 call sites, all in `server/sessions.ts` and `server/tmux.ts`.
- **Launch commands are shell strings** (`shq` quoting, `set -a && . envfile` for Local mode). Fine for tmux, wrong for Windows.
- **Hooks:** sandbox-mode hooks run inside the sandbox (Linux), so `curl` is fine there. Local-mode hooks run on the host and need `sh` + `curl`.

### Decisions
- **node-pty with prebuilds for every platform:** switch to `@lydell/node-pty` (upstream node-pty repackaged with prebuilt binaries for macOS, Linux and Windows on x64 and arm64; no compile step). It's a 1.2 beta; verify it on all three before merging, and keep the spawn-helper chmod fix pointed at its new path.
- **Session backends behind one interface:** `tmux` (macOS, Linux; unchanged) and `pty` (Windows: HQ owns each agent's process through node-pty). Same operations: start, stop, isAlive, attach output, type, enter, resize, screen text, exit info.
- **Windows trade-offs, said plainly in the UI and README:**
  - Agents stop when HQ stops. On the next start HQ starts them fresh; sandboxes and workspaces are kept.
  - There's no `tmux attach` from another terminal; use the terminal in HQ instead.
  - A background helper that keeps agents alive is a possible later step, not v1.
- **Launch as argv, not shell strings:** adapters return `{ command, args, env }`. The tmux backend quotes them into a shell line (exactly today's string); the pty backend spawns them directly with no shell.
- **Local-mode env file on Windows:** not supported in v1. HQ never reads env files, and without a POSIX shell there's no safe way to load one. Sandbox mode keeps `--env-file`. The UI says so on Windows.
- **Local-mode hooks:** a small `hq-hook.mjs` run with `node` (works with cmd, PowerShell and Git Bash). Sandbox hooks stay `curl`.
- **Setup checklist:** on Windows, tmux isn't needed, so it isn't shown. Linux gets apt/dnf hints where they differ.
- **Port errors:** `EACCES` gets a clear message, like `EADDRINUSE`: "Windows reserved this port; try --port 8420", with the `netsh` command to see the ranges.
- **WSL stays possible** but isn't the recommended Windows path; native Windows 11 is (Docker Sandboxes supports it officially).

### How to build it
1. **Linux:** switch to `@lydell/node-pty`; update `scripts/fix-node-pty.mjs` and `server/lib/ptyFix.ts`; verify `npx` from a packed tarball in a clean Ubuntu 24.04 container (install, start, page loads, Local-mode agent starts in tmux).
2. **CI matrix:** ubuntu, macos, windows. Each job: install, build, pack, install the tarball in an empty folder, start HQ with `--no-open` on a temp repo, fetch the page and the WebSocket snapshot, stop it.
3. **Session backend interface;** move the tmux code behind it with no behaviour change. Re-run the full Mac flow live (start, deliver, Codex screen detection, restart reattach, remove).
4. **Launch as argv** in both adapters; the tmux backend produces the same command line as today (checked by a unit test).
5. **Windows `pty` backend:** spawn, keep a screen buffer (`@xterm/headless`) for screen text and exit details, type/enter by writing to the pty, resize, kill on stop and on HQ exit.
6. **Local-mode hook script** (`node hq-hook.mjs <event>`); Claude and Codex hook configs use it in Local mode.
7. **Windows details:** setup checks, the `EACCES` message, opening the browser (`cmd /c start` with proper escaping), the Local-mode env-file note, README Windows section.
8. **Test on a real Windows 11 PC** (you): welcome, Sandbox and Local agents with Claude and Codex, messages, PR loop, stop/restart. Fix and repeat.

- **Done when:** a fresh Mac, Ubuntu 24.04 and Windows 11 machine can each run `npx @therealjsmastery/jsm-hq`, start a Claude and a Codex agent in a sandbox, and pass a message from the lead to a worker; the Mac flow is unchanged; CI runs on all three.

### Not in this plan
- Keeping Windows agents alive after HQ stops (background helper).
- Local-mode env files on Windows.
- Older Linux distributions than Docker Sandboxes supports (Local mode may still work there).

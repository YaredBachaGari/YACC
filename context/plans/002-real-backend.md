## Implementation plan: real JSM HQ backend

### What we're building
A local HQ server that replaces the mock data source. You run `npx jsm-hq` inside your repo. It checks the tools it needs, creates a folder per agent (an HQ-managed clone with that agent's `ROLE.md`, hooks and MCP config), starts each agent in its own Docker Sandbox (or in Local mode) inside a tmux session, and streams the real Claude Code terminals to the UI we already built. Agents report their state through Claude Code hooks and talk to each other through HQ's Team MCP. HQ owns the plan, reads PRs and reviews through `gh`, and nudges agents when a review comes back. Every UI change goes through `OfficeDataSource`, so the office and drawers stay as they are.

### Terms we agreed on
- **Workspace:** an agent's folder, by default an HQ-managed full clone at `~/.jsmhq/<project>/<agent>/`. It can be pointed at an existing folder instead. Clone mode (`sbx --clone`) is a later option.
- **Agent files:** `ROLE.md`, `.claude/settings.local.json` (hooks) and `.mcp.json` (Team MCP with the agent's id and token). HQ writes them and lists them in `.git/info/exclude` so they're never committed.
- **Session:** the tmux session `hq-<agent>` that runs the agent. It survives HQ or browser restarts.
- **Agent mode:** Sandbox (`sbx run … claude <folder>`) or Local (`claude` in the same folder, permission prompts on).
- **Plan store:** HQ-owned boards and tasks in `.jsmhq/plan.json`. The lead changes them only through MCP tools.
- **Delivery:** HQ passes a message or command to an agent by typing it into the agent's terminal once the agent is idle. While the agent is busy, the message waits in a queue.
- **Setup checklist:** the screen shown when a required tool is missing.

### Decisions
- **Start HQ from inside the repo:** the repo path and GitHub remote are known with no path picker.
- **Separate folders by default:** matches the manual 3-agent test, and HQ can write each agent's files directly. Host worktrees are ruled out because the agent loses git inside the sandbox.
- **tmux for sessions:** agents keep working if HQ crashes, and `tmux attach -t hq-bob` works from any terminal.
- **HQ owns the plan:** agents work in separate clones, so files in the repo can't be a shared source of truth.
- **GitHub, read-only, through the `gh` CLI:** no app or OAuth for HQ. Agents push and open PRs themselves using the `sbx` GitHub secret (`sbx secret set github --command 'gh auth token'`).
- **Polling, not webhooks:** a local app has no public URL. HQ polls every ~20s and also right after a hook reports `gh pr create`.
- **Missing tools show a setup checklist, not an error.** It checks the OS, `sbx`, Docker sign-in, tmux and `gh`. Each line has the command for your OS with a Copy button, a docs link, auto re-check, and a visible "Run in terminal" button for `brew`, `winget` and `sbx login`. It never runs `sudo` scripts. The office still opens if setup is incomplete.
- **Local mode is built in Phase A as a fallback,** so teammates on machines that can't run sandboxes can still use HQ.
- **Keep the mock:** `VITE_HQ_SOURCE=mock|ws` switches sources, so UI work never needs Docker.

### Assumptions (confirm while building)
- `sbx run` behaves correctly inside tmux, and a stopped sandbox can be resumed.
- `sbx policy allow network host.docker.internal:<port>` covers the hooks and MCP traffic (one manual curl call already works).
- Claude Code inside a sandbox reads hooks and `.mcp.json` from the mounted folder.
- Claude login inside each sandbox works the way it did in the manual test.
- Sandbox requirements (from Docker docs): macOS 14+ on Apple silicon, Windows 11 with Hypervisor Platform, or Ubuntu 24.04+ with KVM.
- Install commands (from Docker docs):
  - macOS: `brew trust docker/tap && brew install docker/tap/sbx`
  - Windows: `winget install -h Docker.sbx`
  - Ubuntu: the `get.docker.com` script
  - Sign-in: `sbx login`
- Environments (InstaCloud/Vercel) and clone mode come later.

### How to build it

**Phase A: server, setup checklist, and one real agent end to end**
1. Server and `jsm-hq` command: Node + TypeScript, Hono + `ws`. It binds to 127.0.0.1:7420, creates a token on each start, and opens the browser with the token in the URL.
2. `.jsmhq/config.json` (team, workflow; safe to commit) and `.jsmhq/plan.json`.
3. Setup checklist: OS support, `sbx` installed (`sbx version`), Docker sign-in, tmux, `gh auth status` and a GitHub remote, plus the "Run in terminal" helper.
4. Workspace manager: clone into `~/.jsmhq/<project>/<agent>/`, write `ROLE.md`, the hooks and `.mcp.json`, and add the exclude entries.
5. Agent runner with two modes: Sandbox (`sbx run --name hq-<project>-<agent> claude <folder>` plus the HQ policy rule) and Local (`claude` in the same folder), both inside tmux.
6. Terminal bridge: node-pty runs `tmux attach` and streams over WebSocket to xterm. Input goes back the same way.
7. Hook endpoint: map Claude Code hook events to agent states (prompt or tool use = working, Notification = needs input, Stop = idle). Reject requests without the token.
8. `wsSource.ts`, which implements `OfficeDataSource`.
- **Done when:** on a supported Mac, Bob runs in a sandbox. On an unsupported machine, the checklist explains why and Bob runs in Local mode. In both cases his real terminal and state show in the office.

**Phase B: Team MCP and the plan**
9. MCP server (Streamable HTTP) with `list_workers`, `get_status`, `list_tasks`, `create_task`, `update_task`, `assign_task`, `send_message`, `get_my_task`.
10. Delivery queue: inject into a terminal on idle, otherwise wait for the next Stop hook.
11. Plan persistence, plus an export to `docs/plan.md` for people to read.
- **Done when:** the lead assigns a task and Bob starts it without you relaying anything, and a message from Bob reaches Alice.

**Phase C: GitHub and the review loop**
12. `gh api` poller: match PRs to tasks by the `[TASK-ID]` in the title, and read review state per tool (CodeRabbit/Greptile/Copilot bot reviews and checks, or human approvals).
13. Automations: on "changes requested", tell the author to fix the comments; on merge, mark the task done.
- **Done when:** a real PR moves across the belt, through the gate and on to merge.

**Phase C.5: Codex adapter** (decided 2026-10-15: only Claude Code + Codex for now)
- Per-CLI adapter: launch args, instruction file (`AGENTS.md` for Codex), MCP config format, status (hooks, or terminal-activity fallback), model flag.
- Verify Codex's notify hook and MCP-over-HTTP support live in a sandbox first. Other CLIs (Gemini, Copilot, Cursor, opencode…) wait until users ask.

**Phase D: real sandbox settings and extras**
14. Policy, domain and secret screens call `sbx` (confirm the exact syntax), then environment readers, and clone mode if a kit or in-sandbox command makes config injection possible.

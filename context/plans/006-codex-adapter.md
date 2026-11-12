## Implementation plan: Phase C.5 — Codex adapter

### What we're building
Agents can be **Claude Code** or **Codex**. Both get full HQ support: hook-driven status, the Team MCP, busy delivery via the Stop hook, and ROLE.md without touching the repo. CLI-specific bits live in per-CLI adapters.

### Verified live (Codex 0.149.1 in sbx)
- Project `.codex/config.toml` (after the folder is trusted) loads hooks, MCP and `developer_instructions`.
- Hooks (`features.hooks = true`) fire with the same payloads as Claude's: SessionStart (on the first prompt), UserPromptSubmit, PreToolUse, PermissionRequest, Stop, SessionEnd.
- `[mcp_servers.hq] url + http_headers` reaches HQ's MCP with the agent's identity.
- `developer_instructions` carries ROLE.md.
- Stop hook `{"decision":"block","reason":…}` makes Codex continue with queued messages.
- First start asks to trust the folder and the hooks (answered once in the terminal).

### Decisions
- `AgentConfig.cli: "claude" | "codex"` (default claude; old configs migrate).
- Adapters in `server/adapters/`: files to write (git-excluded), launch command, model flag.
- Codex readiness: SessionStart only fires on the first prompt, so HQ also detects Codex's prompt on screen ("Ask Codex to do anything") to know it can type, and detects the trust prompts to show "needs you".
- Setup checks only when relevant: "OpenAI key for Codex agents" (sandbox) and "codex installed" (Local mode).
- Never auto-answer Codex's trust prompts.

### How to build it
1. Types + migration; adapters for Claude (moved) and Codex.
2. Sessions use the adapter; PermissionRequest hook → needs input; Codex screen detection.
3. Setup checks for Codex.
4. UI: Agent dropdown + model field per CLI in Team settings; CLI shown on team cards and the drawer.
5. Live test: Claude lead + Codex worker in a scratch repo.

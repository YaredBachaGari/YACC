## Implementation plan: MCP servers for agents

### What we're building
An **MCP servers** section where you add MCP servers once and pick which agents get them. HQ uses Docker Sandboxes' own MCP registry (`sbx mcp`), so each server runs through sbx's gateway and its sign-in or API key never enters the sandbox.

### How sbx does it (checked with sbx 0.47)
- **Register on the host:** `sbx mcp add <name> --url <url>` (remote, MCP registry URL, or manifest) or `--command <cmd>` (local stdio).
- **Sign-in:**
  - OAuth servers: `sbx mcp auth <name>` opens the browser; tokens are stored by sbx.
  - API-key servers: `--header 'Authorization: Bearer ${token}'`, with the key stored by `sbx secret set mcp:<name>:token` (value on stdin).
- **Attach to a sandbox:** `sbx mcp load <name> --sandbox <sandbox>` works on a running sandbox, and the agent sees the tools immediately (no restart).
- **Status:** `sbx mcp ls --json` lists servers with `status` (ready / needs-auth) and `next_step`.

### Decisions
- **sbx is the source of truth for servers.** HQ lists what `sbx mcp ls` returns, including servers added outside HQ, and never keeps its own copy of server details or keys.
- **Per agent, HQ stores only the names it should attach** (`AgentConfig.mcp: string[]`). On every Start, and right away for a running agent, HQ runs `sbx mcp load` for each.
- **Adding a server in HQ:**
  - name and URL;
  - optional "API key" (sent to `sbx secret set mcp:<name>:token` on stdin, never stored or shown);
  - or "Sign in" for OAuth.
  - Local stdio (`--command`) is supported but kept under "More", since it runs a program on your Mac.
- **Sign in** runs `sbx mcp auth <name>` in a visible terminal, like the setup checklist's Run in terminal, because it needs the browser and may ask questions.
- **Removing:** "Remove from this agent" only detaches. "Delete server" runs `sbx mcp rm` after a confirmation, since it affects every sandbox on the machine.
- **Stack link:** catalog tools that have an MCP server (Stripe, PostHog, InstaCloud) show **Add MCP**, which prefills the name and URL.
- **Sandbox only:** Local-mode agents don't go through sbx. For them the section says so, and nothing is attached.

### Where it shows
- **Settings → MCP** (new tab):
  - the server list with status and Sign in;
  - "Add server";
  - a grid of servers × agents with checkboxes.
- **Agent drawer → Sandbox tab:** the agent's attached servers and their status.

### Verified (sbx 0.47, live)
- `sbx mcp load` on a running sandbox: the agent sees the tools immediately (inside, Claude has one server, `mcp-gateway`, and loaded servers appear through it).
- No sandbox network rules are needed for gateway traffic.
- Loaded servers survive Stop and Start; loading twice is harmless. Unknown server or a stopped sandbox → a clear error.
- A server that needs sign-in still loads, but only exposes an authorize tool until `sbx mcp auth`.
- There is no per-sandbox unload, and `sbx mcp ls` has no per-sandbox view locally, so HQ records what it attached (`~/.jsmhq/<project>/mcp-attached.json`) and unticking applies on recreate.
- API keys: `--header 'Authorization: Bearer ${token}'` plus `sbx secret set mcp:<name>:token`. sbx also stores `mcp:<name>:token:endpoint`; both are removed with the server.

### Was "to verify while building"
- Whether a server's traffic through the gateway also needs sandbox network rules (if so, Allow them when attaching, with the user's confirmation).
- What happens to loaded servers when a sandbox is stopped and started again (re-load on every Start either way).
- What `sbx mcp load` prints when a server needs sign-in, so HQ can show "Sign in first".
- `sbx mcp ls --json` with `--sandbox` (to show what's attached right now).

### How to build it
1. Server side: read `sbx mcp ls --json`; add (with header + secret), auth (terminal), rm, load; `AgentConfig.mcp` + migration; load on Start and on change.
2. UI: Settings → MCP tab, Sandbox-tab summary in the drawer, Add MCP from Stack.
3. Demo data for `pnpm dev`.
4. Live test: add a no-auth server and an API-key server, attach to a running agent, confirm the agent lists its tools without a restart; stop/start keeps them; remove detaches.
5. Docs: README + getting-started.

- **Done when:** you can add a server, sign in or set its key, and tick it for an agent in HQ, and the running agent can use its tools without a restart. Keys never appear in HQ or the sandbox.

### Not in this plan
- claude.ai connectors (Notion, Slack…): they come from the Claude account, not sbx. They keep showing in "Blocked by the sandbox" and are better dismissed.
- Codex-specific MCP config (sbx's gateway serves both CLIs; to verify).

## Implementation plan: Phase D — real sandbox settings

### What we're building
Settings → Sandbox applies settings for real through `sbx` and shows what is in effect, not what was saved. Split into **This agent** (sandbox-scoped) and **This machine** (all sandboxes), matching what `sbx` supports.

### Decisions
- **Base policy level:** machine-wide in sbx (`sbx policy init`; changing it means `reset`, which wipes every rule). HQ detects and shows it read-only, with the command and a docs link.
- **Allowed / blocked domains (per agent):** synced to `sbx policy allow/deny network --sandbox <name>`. HQ adds missing rules and removes only rules it added (tracked in `~/.jsmhq/<project>/sbx-owned.json`, removed by rule id). Kit, org and user CLI rules are never touched. Applied after the sandbox exists and on every change.
- **Service keys** (`github`, `anthropic`, `openai`, …): global or for one agent's sandbox. The value goes to `sbx secret set` via stdin; HQ never stores it. The list shows what `sbx secret ls --json` reports. Agent-scoped keys need the sandbox to exist.
- **Proxy:** under This machine (`sbx settings set/unset proxy.sandbox`), labelled as affecting all sandboxes.
- **App variables:** a per-agent env file `~/.jsmhq/<project>/<agent>.env` (0600), never read or committed by HQ, passed with `--env-file` (Sandbox) or sourced (Local). The UI says these values do enter the VM.
- **Removed from the data model:** per-agent policy level, per-agent proxy, free-form secret names.

### How to build it
1. `server/sbx.ts`: read rules (`policy ls --json`), detect the base level (`policy check`), list secrets, proxy get/set/unset.
2. Rule sync per agent (after first start and on change); report the rules in effect and errors.
3. Service keys: set/remove, global or per sandbox, value via stdin.
4. Env file: create and open; passed at start.
5. UI: This agent / This machine sections, rules in effect, key picker, env-file panel; stale fields removed.
6. Live test with a scratch sandbox: allow/block a domain (verify with `sbx policy ls` and `curl` inside), set/remove a sandbox key, env var visible to the agent.

- **Done when:** every control in Settings → Sandbox changes what `sbx` reports.

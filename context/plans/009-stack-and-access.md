## Implementation plan: Stack picker and access requests

### What we're building
An **optional** Stack section where a project can say what it's built with: one or more frameworks, and tools by category (auth, payments, database, analytics, security). Choosing something *does* something for the agents: their ROLE.md says what the stack is, the right agent skills are installed in their folders, the tool's docs and API domains can be allowed for their sandboxes, and they know which keys to expect. Skip the section and HQ works exactly as today.

Plus **access requests**: when an agent's sandbox blocks a domain, the agent asks through the Team MCP, and you click Allow or Deny in HQ. This covers any tool, including ones the picker doesn't list.

### Why
- Sandboxes (balanced policy) allow AI services, package registries and GitHub, but not most docs sites or third-party APIs. Agents then guess from memory or fail quietly.
- Most tools ship agent skills (and some an MCP server), but agents only use them if they're installed and the agent knows the project uses that tool.
- The picker stays neutral: several options per category, like the review tools (CodeRabbit, Greptile, Copilot, Human), plus "Other".

### Decisions
- **All optional.** No stack chosen → no ROLE.md section, no skills, no domains. Nothing is forced in the welcome either (an optional step with "Skip").
- **Frameworks: multi-select**, each with an optional "where" (`apps/web`, `apps/api`), for monorepos and Next.js + Express style projects.
- **Tools: at most one per category** to start (auth, payments, database, analytics, security), each with "Other" (name + docs URL).
- **The catalog is plain data** (`server/stack/catalog.ts`). Each entry has:
  - id, name, category;
  - docs domains and API domains;
  - the keys it needs (names only);
  - agent skills (source + names);
  - an optional MCP server;
  - a one-line ROLE.md note.

  Adding a tool means adding an entry, not code. 3–4 researched options per category to start.
- **Saved in `.jsmhq/config.json`** (`stack`), so the whole team shares it.
- **Network access is never added silently.**
  - Choosing a tool shows its domains with checkboxes. You confirm, and they're added to each agent's per-sandbox allow list (the existing Settings → Sandbox rules, removable, HQ-owned).
  - The base policy is never touched.
- **Keys:** HQ lists what each tool needs and where to put it (the agent's env file, or `sbx secret` for services sbx supports). It never asks for, stores or reads the values.
- **Skills over MCP.**
  - Skills are installed into each agent's folder (git-excluded) at Start, for both Claude Code and Codex.
  - MCP servers often need a browser sign-in, which doesn't work from a sandbox. They come later, and only for servers that accept a key.
- **`request_access(domain, reason)`** is a new Team MCP tool:
  - The agent turns "Needs you" with the domain and reason, and the drawer shows **Allow for this agent / Allow for everyone / Deny**.
  - Allow adds a per-sandbox rule and tells the agent. Deny tells the agent to continue without it.
  - Local-mode agents aren't sandboxed, so the tool tells them so.
  - ROLE.md rule: "If a request is blocked, call request_access; don't work around it."

### Catalog to start (domains and skills researched per entry before building)

| Category | Options |
|---|---|
| Frameworks (multi) | Next.js, React (Vite), Express, Hono, NestJS, React Router, Astro, SvelteKit, Nuxt, Other |
| Auth | Clerk, Better Auth, Auth0, Supabase Auth, Other |
| Payments | Clerk Billing, Stripe, Polar, Other |
| Database | InstaCloud, Neon, Supabase, Prisma Postgres, Other |
| Analytics | PostHog, Plausible, Vercel Analytics, Other |
| Security | Arcjet, Upstash Ratelimit, Other |

### Verified
- Skills: `npx skills add <source> --skill <names…> -a claude-code codex -y --copy` installs project-level, non-interactively, into `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex), plus a `skills-lock.json`. HQ installs once per project into `~/.jsmhq/<project>/skills-cache` and copies into each agent's folder (git-excluded; skills the repo already commits are left alone). Measured: 17 skills for Next.js + Express + Clerk + Clerk Billing + InstaCloud + PostHog + Arcjet in 41s the first time, 0.4s after that.
- Catalog sources and skill names were listed with `npx skills add <source> -l` (clerk/skills, PostHog/skills, arcjet/skills, InsForge/instacloud-skills, stripe/ai, vercel/next.js, vercel-labs/agent-skills).
- A sandbox block is an HTTP 403 from sbx's proxy with the body "Approval required for <host>:443. Review and respond with: sbx policy approval ls". Live test: a real Claude agent hit it, called request_access with the 403 text as its reason, Allow added a per-sandbox rule, and its retry worked without a restart.
- Follow-up idea: sbx queues every blocked request per sandbox (`sbx policy approval ls` / `respond`). HQ could surface those automatically, even when an agent doesn't call request_access.

### Was "to verify before building"
- How skills are installed and where each CLI reads them:
  - Claude Code: `.claude/skills/` in the project;
  - Codex: `.agents/skills/` or its own folder;
  - whether the skills CLI (`npx skills add …`) works non-interactively in an agent's folder;
  - whether sbx's shared skills store (`--skills`, read-only by default) already exposes host skills.
- Each catalog entry's docs and API domains, and its skill source.
- How a sandbox denial looks to the agent (error text), so the ROLE.md rule tells it what to watch for. `sbx policy log` may let HQ spot denials itself.

### How to build it
1. **Access requests:** `request_access` MCP tool, a "Needs you" card with Allow/Deny in the agent drawer, per-sandbox rule on Allow, reply to the agent, ROLE.md rule. Live test with a real sandbox and a blocked docs site.
2. **Stack config + catalog:** types, `config.stack`, catalog data for the first entries, migration (none = empty).
3. **Settings → Stack UI:** framework multi-select with "where", one picker per tool category, "Other", the domains confirmation and the keys list. Optional step in the welcome.
4. **ROLE.md "Stack" section** for every agent when a stack is set.
5. **Skills install** into agent folders at Start (git-excluded), for Claude Code and Codex.
6. **MCP (later):** only for servers that work with a key from a sandbox.
7. Docs: the getting-started guide and README.

- **Done when:**
  - a project with no stack behaves exactly as today;
  - choosing Next.js + Express and Clerk + PostHog puts both in every agent's ROLE.md, installs their skills, and (after you confirm) allows their domains;
  - an agent blocked on an unlisted docs site asks via `request_access`, and Allow lets it through without restarting it.

### Not in this plan
- Auto-allowing anything without you confirming.
- Per-agent stacks (the stack is per project).
- Setting up the tools' accounts or projects (creating a Clerk app, a PostHog project): the agent or you do that.

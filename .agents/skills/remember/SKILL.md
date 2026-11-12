---
name: remember
description: "Automatically restores context at the start of every new session so the agent knows exactly where the project stands. Also saves session state manually at the end when the developer is ready. /remember restore triggers automatically when a new session starts. /remember save is always run manually by the developer before closing a session."
---

## Project Context File

This skill reads and writes the project context file.
The name depends on your tool:

- Claude Code → `CLAUDE.md`
- Cursor → `.cursor/rules/rules.md`
- Codex → `AGENTS.md`
- Windsurf → `.windsurfrules`
- Other tools → check your tool's documentation

Throughout this skill, **"project context file"** refers
to whichever file your tool uses.

---

AI has no memory between sessions. Every new context window starts blank. This skill fixes that.

Restore runs automatically at the start of every session — the developer never has to think about it. Save is always manual — the developer decides when they are satisfied, when tests pass, when it is a clean stopping point. Never save automatically.

---

## The Rule

Session start → restore runs automatically.
Session end → developer runs `/remember save` when ready.

Save is never automatic. The developer must consciously decide this is a good stopping point before saving. Saving a broken or incomplete state creates a worse starting point than no state at all.

---

## File Structure

This skill reads and writes two places only:

```
context/
├── index.md                        ← always-on, <20 lines, every session reads this
└── dev-log/
    ├── auth-backend.md             ← on-demand, per feature-concern
    ├── auth-frontend.md
    └── dashboard-ui.md
```

**`context/index.md`** is the always-on file. Under 20 lines always. It tells any new session the current project state without loading anything else. Every save updates it.

**`context/dev-log/[feature-concern].md`** is per-session detail. One file per feature-concern. Append-only — never overwritten. Two developers on different features write to different files. No conflicts.

---

## Security Boundary

Never persist secrets. If any sensitive value appears in the conversation, do not write it to any file.

Sensitive data includes:
- API keys, access tokens, refresh tokens, session tokens
- Passwords, passphrases, private keys, certificates
- Cookies, auth headers, connection strings, webhook secrets

Store a redacted placeholder if the detail is useful: `[REDACTED_API_KEY]`.
If unsure whether something is sensitive, treat it as sensitive.

---

## Auto-Restore — Runs at Session Start

This triggers automatically when a new session begins. The developer does not invoke it manually.

### Step 1 — Check for context/index.md

Look for `context/index.md`.

**If it does not exist:**
```
No context found.

This looks like a fresh start. If this is a new project:
→ Run /mvp to define what you are building
→ Run /architect for technical decisions

If context should exist, check that the context/ folder
is in the project root.
```

Stop here. Do not proceed.

**If it exists** — read it fully. Then read the tool context file:
- project context file — Claude Code
- `AGENTS.md` — Codex
- `.cursor/rules/` — Cursor
- `.windsurfrules` — Windsurf

Do not read any other files at this stage.

### Step 2 — Identify active work

From `context/index.md`, identify which feature-concern is active.

**Infer first.** One feature in progress → restore it without asking.

**Ask when ambiguous.** Multiple features in progress → ask one question:

```
Which feature are you picking up?
Active: [list from index.md]
```

Read only the most recent entry from `context/dev-log/[feature-concern].md` — the entry at the top. Not the full history.

### Step 3 — Confirm before continuing

Do not start building. Show the developer what was restored and wait for confirmation.

```
Context restored.

Last session: [what was built — specific files and features]
Current state: [what works, what is partial, what is broken]
Decisions locked: [key decisions future work depends on]
Next up: [the specific first action this session]

Is this correct? Confirm to continue, or correct
anything before we start.
```

Only after confirmation does the session continue.

### Step 4 — If context is incomplete

If `context/index.md` exists but the dev-log is missing or unclear:

```
I found context/index.md but the dev-log for [feature-concern]
is [missing / unclear about: what is unclear].

Continue with what we have, or fill the gaps first?
```

Do not guess. Surface the gap. Let the developer decide.

---

## Manual Save — /remember save

The developer runs this when they are satisfied with the session. Not before. Not automatically.

### Step 1 — Identify the feature-concern

**Infer first.** Read the session. If it is obvious what was worked on — use that name without asking.

**Ask only when ambiguous:**
```
What feature and concern should I save this as?
Example: auth-backend, auth-frontend, dashboard-ui, payments-api
```

### Step 2 — Extract what matters

Review the session and extract only what a developer needs to continue in a completely fresh context. Not a transcript. The essential state only.

**What was built** — specific files created or modified.
Not "built the auth flow" — "created `app/(auth)/login/page.tsx` and `middleware.ts`. OAuth with Google and GitHub working end to end."

**Decisions made** — choices that are hard to reverse or that future work depends on.

**Problems solved** — anything that took significant time. So the next session does not solve it again.

**Current state** — exactly where things stand. What works, what is partial, what is broken.

**Next session starts with** — the very first specific action. Concrete enough to start immediately.

**Open questions** — anything unresolved that needs addressing next session.

What not to capture:
- Implementation details visible in the code
- Decisions already in project context file or `context/architecture.md`
- Anything inferable by reading the codebase
- Secrets or credential-like values

### Step 3 — Security check

Scan everything before writing. Remove or redact any credential, key, token, or secret.

### Step 4 — Write the dev-log entry

Append-only. Never overwrite. Add new entry at the top of the file.

File: `context/dev-log/[feature-concern].md`

Create if it does not exist. Prepend above previous entries if it does.

```markdown
## Session — [date and time]

### What was built
[Specific files and features completed this session]

### Decisions made
[Decisions that future work depends on]

### Problems solved
[Issues resolved — so they are not solved again]

### Current state
[What works, what is partial, what is broken]

### Next session starts with
[The very first specific action next session]

### Open questions
[Anything unresolved]
```

### Step 5 — Update context/index.md

Update to reflect current project state. Create if it does not exist.

Keep it under 20 lines. Every line costs tokens on every session.

```markdown
# Project Index

Updated: [date] | Stack: [main stack]

## Active Work
- [feature-concern]: [status, one line] → context/dev-log/[feature-concern].md
- [feature-concern]: [status, one line] → context/dev-log/[feature-concern].md

## Last Decision
[Most recent important decision, one line]

## What Not To Touch
[Locked areas, active constraints, things currently being changed]

## Reference if needed
- Product scope: context/mvp.md
- Architecture: context/architecture.md
- Feature plans: context/plans/
```

Update only lines that changed. Do not rewrite sections that are still accurate.

### Step 6 — Confirm

```
Saved → context/dev-log/[feature-concern].md
Updated → context/index.md

Close the session when ready. Next session restores automatically.
```

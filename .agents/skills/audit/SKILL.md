---
name: audit
description: "Onboard the agentic workflow onto an existing codebase that was built without it. Reads the actual code to understand what exists, then generates project context file, context/index.md, and context/architecture.md from evidence — not assumption. Run once when bringing an existing project into the JSM workflow. After this runs, go straight to /plan for the next feature."
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

Joining an existing codebase without understanding it first is how agents make confident mistakes. They invent a description of the project that sounds right but does not match reality. Then every session builds on that invented foundation.

This skill fixes that. It reads what actually exists before writing anything. It flags what it is not sure about. It never invents.

After this skill runs, the project is fully onboarded. The next step is always `/plan [feature]` — not `/mvp`, not `/architect`. Those are for new projects. This codebase already has a product and an architecture. This skill documents what they are.

---

## Before Starting — Set Expectations

Tell the developer what is about to happen:

```
I am going to read your codebase before writing anything.

I will work through it systematically — structure first,
then stack, then patterns, then conventions.

For large codebases I will cover the main patterns but
cannot read every file. I will flag anything I am uncertain
about so you can correct it before anything gets written.

This takes a few minutes. Starting now.
```

---

## Step 1 — Read the Structure

Start with the shape of the project. Do not read file contents yet.

Read in this order:

**Root level** — list everything in the root directory. Identify:
- Package files: `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.
- Config files: framework configs, TypeScript config, linting, environment examples
- Existing context files: project context file, `AGENTS.md`, `.cursor/rules/`, `.windsurfrules`
- `README.md` if present
- Main source folders

**Source structure** — list the top-level folders inside the main source directory. Do not go deeper yet. Just understand the shape.

**Existing context files** — if any exist (project context file, `AGENTS.md`, etc.), read them now. They may already contain useful information. Note what they say and whether it appears accurate based on the structure you see.

After reading structure, form an initial hypothesis about what kind of project this is. Do not state it yet — just hold it.

---

## Step 2 — Read the Stack

Read the package or dependency file in full. This is the most reliable source of truth for what the project actually uses.

For JavaScript/TypeScript: `package.json`
For Python: `pyproject.toml` or `requirements.txt`
For other stacks: the equivalent dependency manifest

Extract:
- Main framework and version
- Database client or ORM
- Auth library if present
- Testing framework
- Key dependencies that indicate architectural decisions
- Package manager (check for lockfile: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`)

Also read the main config file for the framework if it exists:
- `next.config.js` / `next.config.ts` for Next.js
- `vite.config.ts` for Vite
- `nest-cli.json` for NestJS
- Framework equivalent for other stacks

This gives you the technical foundation. Note anything unexpected — a dependency that does not fit the apparent project type, a library that suggests a pattern you did not expect.

---

## Step 3 — Read the Patterns

Now read actual code. Strategically — not exhaustively.

The goal is to understand how this codebase is organized and how code is written. Read representative files, not all files.

### 3a — Entry points

Read the main entry point. For a web app this is usually the root layout, main page, or app entry. For an API it is the main router or server file. This shows the top-level structure.

### 3b — One complete feature

Find one feature that appears complete — has a UI component or route, a data layer, and ideally a test. Read all the files for that one feature. This reveals the patterns the team uses end to end.

Look for:
- How components are structured
- How data fetching works
- How errors are handled
- How types are defined
- How files are named
- How folders are organized within a feature

### 3c — Data layer

Read one or two files from the data layer — schema, models, or database queries. This reveals how data is structured and accessed.

### 3d — Tests if present

If tests exist, read one test file. This reveals what testing patterns the project uses and what level of coverage exists.

### 3e — Any files that look unusual

If anything in the structure looked unexpected during Step 1 — read it now. Unusual patterns should be understood, not ignored.

---

## Step 4 — Identify What You Know and What You Don't

Before writing anything, be honest about what was confirmed by reading versus what is still uncertain.

Build two lists mentally:

**Confirmed** — things seen directly in the code, not inferred.
- Stack and versions from package files
- Folder structure from direct observation
- Patterns seen in the files actually read

**Uncertain** — things that seem likely but were not confirmed.
- Patterns that appeared in some files but not others
- Conventions that may not be consistent across the codebase
- Areas of the codebase not read

Do not write uncertain things as facts. Flag them.

---

## Step 5 — Surface Gaps Before Writing

Before writing any file, tell the developer what was found and what needs confirmation.

```
I have read through the codebase. Here is what I found:

**Stack (confirmed):**
- [framework + version]
- [database/ORM]
- [auth approach if found]
- [package manager]

**Structure (confirmed):**
- [main folder organization]
- [key patterns observed]

**Uncertain — need your input:**
- [thing that was unclear]: I saw [what you saw] but I am not sure if [what you are uncertain about]. Which is it?
- [thing that was unclear]: [same pattern]

**Not covered:**
- [area of codebase not read] — if there are important conventions here I should know about, tell me now.

Once you confirm or correct the uncertain items, I will write the context files.
```

Wait for the developer's response. Update your understanding before writing anything.

---

## Step 6 — Write the Three Files

Only after the developer confirms do you write. Three files, in this order.

---

### File 1 — context/architecture.md

Documents what already exists. Not what should exist — what does.

```markdown
# Architecture

Documented: [date]
Project: [what this project is, one sentence]

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | [name + version] | |
| Language | [language + version if known] | |
| Database | [database + ORM/client] | |
| Auth | [auth approach or library] | |
| Styling | [CSS approach] | |
| Testing | [test framework if present] | |
| Package manager | [pnpm / npm / yarn] | |
| Deployment | [if determinable from config] | |

## Project Structure

[Describe the actual folder organization as found]

## Patterns in Use

[The conventions actually observed in the code — how components
are structured, how data is fetched, how errors are handled,
how files are named. Specific, not generic.]

## Conventions

[5-8 project-specific rules observed in the code.
Not "write clean code" — actual patterns this project uses.]

- [specific convention observed]
- [specific convention observed]
- [specific convention observed]

## Known Gaps

[Areas of the codebase not read during audit.
Important for future sessions to know what was not covered.]

## What Was Not Confirmed

[Anything uncertain that the developer could not clarify.
Flag it here so future sessions treat it as assumption, not fact.]
```

---

### File 2 — project context file

If project context file already exists — do not overwrite it. Show what you would add or change:

```
project context file already exists. Here is what I would update:

[proposed changes]

Should I merge these in?
```

Wait for confirmation before touching it.

If project context file does not exist — write it and show it before finalizing:

```
Proposed project context file:

[content]

Does this look right?
```

Only write after confirmation.

Keep it under 30 lines. Only things true across the entire project.

```markdown
# [Project Name]

## Stack
- [main framework and language]
- [database and ORM]
- [styling approach]
- Package manager: [choice]

## Commands
- Dev: [command]
- Build: [command]
- Test: [command — or "No test command found" if absent]
- Lint: [command — or "No lint command found" if absent]

## Rules
- [rule that applies everywhere in this project]
- [rule that applies everywhere in this project]

## Context
- Architecture: context/architecture.md
- Project index: context/index.md
- Feature plans: context/plans/
```

---

### File 3 — context/index.md

This is the always-on project state file. Keep it under 20 lines.

```markdown
# Project Index

Updated: [date] | Stack: [main stack one line]

## Active Work
- No active features tracked yet. Run /plan [feature] to start.

## Last Decision
[Most recent decision found in the codebase if determinable,
or "Not yet tracked — decisions will appear here after /remember save"]

## What Not To Touch
[Any areas that looked locked, in progress, or fragile based on reading]

## Reference
- Architecture: context/architecture.md
- Feature plans: context/plans/
```

---

## Step 7 — Confirm and Hand Off

After writing all three files:

```
Audit complete.

Written:
→ context/architecture.md
→ project context file [written / updated / unchanged]
→ context/index.md

[N] things I was uncertain about are flagged in
context/architecture.md under "What Was Not Confirmed."
Review those when they become relevant.

This project is now set up for the JSM workflow.
Next step: /plan [feature-name] to start building.
```

---

## What This Skill Does Not Do

**It does not invent.** If something was not confirmed by reading the code, it is either flagged as uncertain or not included. A shorter accurate file is better than a longer invented one.

**It does not judge.** The codebase may have inconsistencies, outdated patterns, or technical debt. This skill documents what exists — it does not critique it. That is the developer's job.

**It does not replace /plan.** After this runs, the next step is `/plan [feature]`. Not more setup. Not `/mvp`. Not `/architect`. Those are for new projects. This codebase is already built — the workflow continues from here.

**It does not read everything.** A 400-file production codebase cannot be fully read without consuming the entire context window. This skill reads strategically and flags what was not covered. Future sessions fill in gaps naturally as they work in different areas.

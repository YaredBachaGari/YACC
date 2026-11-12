---
name: document
description: "Generate documentation from what was actually built and decided. Three modes: PR description and changelog for a single feature, developer-facing docs as a proper linked folder structure, or user-facing docs. Detects which modes are relevant before offering them. Optional — run when documentation is actually needed, not after every feature."
---

## Project Context File

This skill reads the project context file.
The name depends on your tool:

- Claude Code → `CLAUDE.md`
- Cursor → `.cursor/rules/rules.md`
- Codex → `AGENTS.md`
- Windsurf → `.windsurfrules`
- Other tools → check your tool's documentation

Throughout this skill, **"project context file"** refers
to whichever file your tool uses.

---

Good documentation explains what exists to someone who was not there when it was built. It is never one long page — it is a folder of focused files, each with a single job, linked from a root README so a developer can find exactly what they need in seconds.

This skill writes from what was actually built and decided. It does not invent. If something was not captured, the documentation says so rather than guessing.

---

## Step 0 — Check That Something Exists

Before doing anything else, check for the minimum required context.

Look for:
- The project context file
- `context/architecture.md`
- `context/mvp.md`
- Any files in `context/dev-log/`

If none of these exist:

```
There is no project context to document yet.

To generate documentation, I need at least one of:
- A project context file (CLAUDE.md or equivalent)
- context/architecture.md — for developer docs
- context/mvp.md — for product or user docs
- context/dev-log/ entries — for PR descriptions

Run /architect on a new project or /audit on an
existing one first, then come back to /document.
```

Stop completely. Do not proceed.

If at least one source exists, continue to Step 1.

---

## Step 1 — Determine the Mode

If the developer specified a mode directly — `/document pr`, `/document dev`, or `/document user` — skip to that mode's section.

If no mode was specified, figure out which modes are relevant before asking.

### Check whether user docs make sense

Read `context/mvp.md` if it exists. Look at the User field and product description.

**User docs are relevant when** the product has someone who needs to learn how to operate it — a SaaS tool, an app with features to discover, a CLI, a library with an API.

**User docs are not relevant when** the product has no real operator — a portfolio site, a personal tool, a static page, anything where there is no external user.

If `context/mvp.md` does not exist, ask:

```
Does this project have end users who need documentation
on how to use it — or is it a personal project,
portfolio, or internal tool?
```

### Present only the modes that make sense

If user docs are not relevant:

```
This looks like [reasoning]. User documentation does not
apply here, but you can ask for it directly any time.

What I can generate:
- PR description / changelog — for a specific feature
- Developer docs — README + linked docs/ folder

Which do you need?
```

If user docs are relevant:

```
What kind of documentation do you need?
- PR description / changelog — for a specific feature
- Developer docs — README + linked docs/ folder
- User docs — how to use the product
```

Wait for the developer's choice before proceeding.

---

## Mode: PR

For a single feature, scoped tightly. Use after a feature is built and ready to merge.

### Step PR-1 — Identify the feature

Ask if not obvious:

```
Which feature is this PR for?
```

### Step PR-2 — Read the relevant dev-log

Read only `context/dev-log/[feature-concern].md` for this feature — the most recent entry only. Do not read other dev-logs.

If no dev-log exists for this feature:

```
I don't see a dev-log entry for this feature.
The PR description will be limited to what I can
infer from the conversation. Run /remember save
after future features to capture more detail.
```

Continue with what is available.

### Step PR-3 — Write the PR description

This goes into a GitHub PR form — it is one block of text, not a file in the repo.

```markdown
## What This Does
[One to two sentences — what changed and why, in plain terms]

## Changes
- [Specific file or area changed]
- [Specific file or area changed]

## Why
[The reasoning, pulled from decisions made during the
session — not invented, only what was captured]

## Testing
[How this was verified, if captured in the dev-log.
If not captured: "Not yet verified — needs manual testing"]
```

### Step PR-4 — Write the changelog entry

Ask where to save it:

```
Save changelog entry to docs/changelog.md or CHANGELOG.md?
```

Write one entry, plain language, one sentence:

```markdown
## [Date] — [Feature Name]
[One sentence for someone scanning a list of changes]
```

---

## Mode: Developer Docs

For documentation aimed at another developer joining, extending, or maintaining the project.

Production developer documentation is never one page. It is a `docs/` folder with focused files, each with a single job, linked from `README.md`. A developer landing on the repo reads the README in 30 seconds and follows the link to exactly what they need.

### Step DEV-1 — Gather source material

Read in this order:
- The project context file — stack, commands, rules
- `context/architecture.md` — technical decisions and reasoning
- `context/mvp.md` — what the product is, if it exists
- `context/dev-log/` — scan all files for what has been built

Note anything unclear or missing as a gap. Do not invent.

### Step DEV-2 — Check what already exists

Check whether `README.md` and a `docs/` folder already exist.

**If neither exists:** you are creating from scratch. Generate the full structure.

**If README.md exists:** propose additions or updates to it, not a replacement. Show the developer what would change before touching anything.

**If `docs/` folder exists:** generate only the files that are missing or need updating. Do not regenerate files that are already accurate.

### Step DEV-3 — Generate the docs/ structure

Produce the following files. Each is short, focused, and linked from README.

**`README.md`** — the front door. Never more than one screen of content.

```markdown
# [Project Name]

[One paragraph — what this is, who it's for, what problem it solves]

## Quick Start

\`\`\`bash
[install and run commands from the project context file]
\`\`\`

## Documentation

- [Architecture](docs/architecture.md) — how the system is built and why
- [Getting Started](docs/getting-started.md) — full setup guide
- [Contributing](docs/contributing.md) — conventions and PR process
- [Changelog](docs/changelog.md) — what changed and when
```

**`docs/getting-started.md`** — full setup from zero.

```markdown
# Getting Started

## Prerequisites
[What needs to be installed before this project]

## Installation
[Step by step — clone, install dependencies, environment setup]

## Running the project
[Dev, build, test commands — pulled from project context file]

## Common issues
[Anything captured in dev-logs as a recurring problem]
```

**`docs/architecture.md`** — technical decisions and reasoning.

```markdown
# Architecture

## Overview
[How the system is structured — pulled from context/architecture.md]

## Stack
[Every layer with the reason it was chosen for this project]

## Project Structure
[Folder layout and what lives where]

## Key Decisions
[The decisions that shaped the codebase — from context/architecture.md]

## What Was Not Chosen
[Alternatives considered and why they were rejected]
```

**`docs/contributing.md`** — how to contribute.

```markdown
# Contributing

## Conventions
[From context/architecture.md's Conventions section]

## Making changes
[Branch naming, commit style, PR process if defined]

## Running tests
[Test command from project context file]
```

**`docs/changelog.md`** — running list of what changed.

```markdown
# Changelog

## [Date] — [Feature]
[One sentence summary]
```

### Step DEV-4 — Flag gaps honestly

Before finalising, list anything that could not be filled from the available context:

```
Generated docs/ structure. The following sections could
not be fully populated from existing context:

- [Section]: [what is missing and why]
- [Section]: [what is missing and why]

These are marked as gaps in the files. Fill them in
manually or run /remember save after future sessions
to capture more detail.
```

### Step DEV-5 — Confirm before writing anything

Show the list of files that will be created or updated. Wait for confirmation.

```
Ready to write:
- README.md [created / updated]
- docs/getting-started.md [created]
- docs/architecture.md [created]
- docs/contributing.md [created]
- docs/changelog.md [created]

Write these files?
```

Only after confirmation do any files get written.

---

## Mode: User Docs

For documentation aimed at someone using the finished product, not building it.

### Step USER-1 — Gather source material

Read `context/mvp.md` — product description, user, features that shipped. Read dev-logs only to confirm what is actually built and working.

Do not include anything from `context/architecture.md`. A user does not need to know what database was chosen.

### Step USER-2 — Write docs/user-guide.md

```markdown
# [Product Name] — User Guide

[One or two sentences — what this does and who it's for.
Plain language, no jargon]

## Getting Started
[How a user begins — sign up, install, open the app]

## Features

### [Feature Name]
[What it does and how to use it, in plain language]

### [Feature Name]
[What it does and how to use it, in plain language]

## Getting Help
[Where to go for support, if applicable]
```

If a feature is listed in `context/mvp.md` but not confirmed as shipped in the dev-logs — do not document it as available. Mark it as coming soon or omit it.

### Step USER-3 — Update README.md

Add a link to the user guide from `README.md` if it is not already there. Show the proposed addition before writing it.

### Step USER-4 — Confirm before writing

Show what will be written. Wait for confirmation before touching any file.

---

## What This Skill Does Not Do

**It does not run on empty projects.** If no project context exists, it stops immediately and tells the developer what to do first.

**It does not produce one big file.** Developer documentation is always a `docs/` folder with linked files. A single 300-line markdown file is not documentation — it is a document that will become outdated and ignored.

**It does not invent.** Every line in the output comes from what was captured in context files and dev-logs. Gaps are flagged, not filled.

**It does not overwrite existing accurate docs.** If `README.md` already exists and is accurate, it proposes additions — not a replacement.

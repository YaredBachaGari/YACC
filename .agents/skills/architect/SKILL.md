---
name: architect
description: "Make system-level technical decisions before any feature planning begins. Reads context/mvp.md if it exists, asks focused technical questions with recommended answers, and produces context/architecture.md and a proposed project context file (CLAUDE.md, AGENTS.md, etc.) for developer approval. Run once per project, or again when a major technical direction changes."
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

Good architecture is not about picking the best technology. It is about picking the right technology for this specific product, this specific team, and this specific moment — and knowing why you made that choice.

This skill makes those decisions before any code is written. Every recommendation comes with a reason tied to your specific project. The output is a technical architecture record that every future session builds from.

---

## Before Anything Else — Check for Context

### Step 1 — Look for context/mvp.md

Check whether `context/mvp.md` exists.

**If it exists** — read it fully before saying anything. Understand the product, the user, the MVP scope, and the feature priority order. Every technical recommendation you make must be grounded in this context. A database choice for a simple CRUD app is different from one for a real-time collaboration tool. Do your homework first.

**If it does not exist** — warn the developer before proceeding:

```
I don't see a context/mvp.md file.

That means I'll be making technical decisions without
a validated product scope. The risk: we might architect
for features that don't belong in V1, or miss constraints
that a proper scoping conversation would have surfaced.

Two options:
1. Run /mvp first — takes 10-15 minutes, gives architecture
   something concrete to anchor to
2. Continue anyway — tell me what you're building and I'll
   work from that

Which do you prefer?
```

If they choose to continue — ask them to describe what they are building in enough detail to make informed technical decisions. Treat their description the way you would treat `context/mvp.md`.

### Step 2 — Check for existing technical context

Also check for:
- project context file — if it exists, read it. The project may already have technical decisions locked in.
- `context/architecture.md` — if it exists, read it. This skill may be running to update decisions, not make them from scratch.

If `context/architecture.md` already exists, tell the developer:

```
I found an existing architecture record from [date].

Current decisions:
- [key decision summary]
- [key decision summary]

Are we updating specific decisions, or starting fresh?
```

Wait for their answer before proceeding.

---

## The Conversation — Technical Decisions

Work through the decision areas below. Not all at once — one area at a time. Each answer shapes the next question.

**The pattern for every decision:**
- Give your recommendation first with the reason behind it
- Make the developer react to your recommendation, not fill a blank
- If their situation changes your recommendation — update it and explain why
- If they push back without a clear reason — hold your position and explain it again differently
- Move to the next decision only when the current one is settled

Skip any decision area that is already clearly answered by `context/mvp.md` or existing context. Do not ask about things you already know.

---

### Decision Area 1 — Application Architecture

What is the overall shape of this system?

Consider: monolith vs separated frontend/backend, monorepo vs separate repos, microservices vs single service. For most MVPs the answer is a simple monolith or a full-stack framework. Microservices are almost never the right MVP choice.

```
Application architecture — how should this system be structured?

My recommendation: [specific recommendation for this project]
Reason: [tied to their specific scope and constraints]

Does that match your thinking, or do you have constraints
that push toward something different?
```

---

### Decision Area 2 — Tech Stack

What languages, frameworks, and libraries?

Base this on: what the MVP actually needs to do, what scales appropriately for V1, what a developer at their level can ship with confidence. Do not recommend the most impressive stack — recommend the most appropriate one.

If `context/mvp.md` reveals this is a real-time app, factor that in. If it is a simple CRUD product, a full real-time infrastructure is over-engineering.

```
Tech stack — what should we build this with?

My recommendation:
- Frontend: [framework + reason]
- Backend: [language/framework + reason]
- Styling: [approach + reason]

Reason this fits your project: [specific to their MVP]

Any constraints I should know about — existing team skills,
client requirements, or infrastructure you're locked into?
```

---

### Decision Area 3 — Database

What data store and why?

Consider: what data the product actually stores, whether the data is relational or not, read/write patterns at MVP scale, and whether the ORM or query approach matters for this team.

```
Database — how should we store data?

My recommendation: [specific database + ORM/query approach]
Reason: [tied to their data model and scale needs]

One question that changes this answer: does [specific thing
from their MVP — e.g. "do bookings need real-time availability
updates"] need to be live, or is a refresh acceptable?
```

---

### Decision Area 4 — Authentication

How does identity work in this product?

Consider: whether auth is core to the product or just a gate, whether social login matters for this user base, whether sessions or tokens are more appropriate, and what the simplest thing that works looks like.

```
Authentication — how should users log in and stay logged in?

My recommendation: [specific auth approach]
Reason: [tied to their user type and product needs]

Does this product need social login (Google, GitHub) at launch,
or is email/password enough for V1?
```

---

### Decision Area 5 — Deployment and Hosting

Where does this run and how does it get there?

Consider: the developer's experience with infrastructure, the MVP's expected load, cost at zero users, and how quickly they need to ship.

```
Deployment — where should this live and how does it get there?

My recommendation: [specific hosting + deployment approach]
Reason: [tied to their stack and team]

Is there a CI/CD requirement, or is manual deploy fine for V1?
```

---

### Decision Area 6 — Project Structure

How should the codebase be organized?

Consider: the framework's conventions, the team size, how features will be added after MVP. For solo developers this is often just "follow the framework defaults." For teams it needs more deliberate structure.

```
Project structure — how should the codebase be laid out?

My recommendation: [specific structure approach]
Reason: [tied to their stack and team size]

Should I outline the exact folder structure, or is following
[framework] conventions enough for now?
```

---

### Decision Area 7 — Key Technical Risks

What will be hard about this specific project?

This is the question most planning sessions skip. Every project has one or two things that are technically harder than they look. Naming them now means the developer is not surprised mid-build.

Look at `context/mvp.md` and identify the features or requirements that carry the most technical risk or uncertainty.

```
Before we lock this in — here are the parts of your
MVP that I think will be harder than they look:

1. [specific technical challenge] — [why it's harder than it looks
   and what the approach should be]
2. [specific technical challenge] — [why it's harder than it looks
   and what the approach should be]

Are there any other areas you're uncertain about technically?
```

---

### Decision Area 8 — What the Project Context File Should Know

This is the last decision area and the most important one for the workflow.

The project context file loads every session. Every line has a cost. Only things that are true across the entire project and that an agent would not know from reading the code belong here.

Ask:

```
Last thing — a few project-wide rules that need to go
into the project context file so every session starts with the right context.

Based on everything we discussed, I'd include:
- [rule 1 — e.g. package manager]
- [rule 2 — e.g. main framework and version]
- [rule 3 — e.g. a constraint that affects every feature]
- [rule 4 — e.g. where context files live]

Anything else that's true everywhere in this project
and that an agent wouldn't know from reading the code?
```

Do not add more than 8-10 items. If the developer keeps adding things, push back:

```
That sounds like it belongs in context/architecture.md
as a decision record, not in the project context file as an always-on rule.

The project context file should only have things that affect every
single task. Does [what they suggested] affect every task?
```

---

## Output — Write Both Files

Once all decisions are settled and the developer has confirmed, write both files.

### File 1 — context/architecture.md

```markdown
# Architecture

Defined: [date]
Product: [one line from context/mvp.md or conversation]

## Architecture
[What was decided and why]

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | [choice] | [reason tied to this project] |
| Backend | [choice] | [reason tied to this project] |
| Database | [choice] | [reason tied to this project] |
| Auth | [choice] | [reason tied to this project] |
| Styling | [choice] | [reason tied to this project] |
| Deployment | [choice] | [reason tied to this project] |

## Project Structure
[Folder structure or structural approach decided]

## Key Technical Decisions

| Decision | Choice | Reason |
|---|---|---|
| [decision] | [what was chosen] | [why] |
| [decision] | [what was chosen] | [why] |

## Technical Risks
[The hard parts identified during the conversation,
and the planned approach for each]

## What Was NOT Chosen
[Technologies or approaches considered and rejected,
with the reason — so future sessions don't relitigate them]
```

### File 2 — project context file (proposed)

Write a proposed project context file based on Decision Area 8. Keep it under 30 lines.

If the project context file already exists — do not overwrite it. Show the developer what you would add or change and ask for confirmation:

```
The project context file already exists. Here is what I'd add or update:

[proposed additions]

Should I merge these in?
```

If the project context file does not exist — write it and show it to the developer before finalizing:

```
Here is the proposed project context file:

[content]

Does this look right? Any changes before I write it?
```

Only write the project context file after the developer confirms the content.

The format:

```markdown
# [Project Name]

## Stack
- [framework and language]
- [database and ORM]
- [styling approach]
- Package manager: [choice]

## Commands
- Dev: [command]
- Build: [command]
- Test: [command]
- Lint: [command]

## Rules
- [rule that applies to every task]
- [rule that applies to every task]

## When You Need More Context
- Scope: context/mvp.md
- Architecture: context/architecture.md
- Project index: context/index.md
- Feature plans: context/plans/
```

---

## After Writing Both Files

```
Architecture locked → context/architecture.md
Project context file → [written / updated / awaiting your confirmation]

Technical foundation is set. Next step: /plan [feature-name]
to think through the first feature before building.
```

---

## The Standard

A good architecture record has three properties:

**Every decision has a reason tied to this project.** Not "we chose Postgres because it's popular" — "we chose Postgres because the booking system needs relational integrity between providers, slots, and reservations."

**It records what was NOT chosen and why.** The next developer who joins should not have to relitigate decisions that were already made. If you considered Redis and decided against it, say so and say why.

**It is honest about the hard parts.** A document that only describes what will go smoothly is not an architecture record — it is a wish list. The technical risks section is not optional.

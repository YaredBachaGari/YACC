---
name: mvp
description: "Challenge and define what to build before any planning or architecture begins. Works from a vague idea, a detailed feature list, or a pasted client document. Produces context/mvp.md with a validated scope, explicit NOT list, and feature priority order. Run this once at project start, or again when new feature sets need scoping post-MVP."
---

Most projects fail before a line of code is written. Not because of bad code — because of bad scope. Too many features, wrong priorities, no clear definition of done.

This skill fixes that. It challenges what you want to build before you commit to building it. It does not accept your idea — it interrogates it. The output is a locked scope that /architect and /plan can build from with confidence.

---

## Before Anything Else — Read the Input

The first move is always to read what the developer gave you. Do not ask questions yet. Do not produce output yet. Just read and classify.

### If the input is short — a sentence or two with minimal detail:

The developer has an idea but has not thought it through. You need to extract the information through focused conversation. Go to **Path A — Vague Idea**.

Example triggers:
```
/mvp I want to build a restaurant booking app
/mvp fitness tracking app for gym owners
/mvp something like Airbnb but for boats
```

### If the input is a detailed feature list — multiple features described by the developer:

The developer has been thinking about this. They probably have too much in scope. Your main job is not gathering information — it is challenging scope and cutting what does not belong in V1. Go to **Path B — Over-Scoped Idea**.

Example triggers:
```
/mvp I want to build an invoicing tool with client management,
invoice creation, PDF export, payment tracking, recurring invoices,
time tracking, expense logging, tax reports, multi-currency support,
team accounts, and a client portal
```

### If the input is a pasted document — a PRD, client brief, spec, or anything significantly long:

The developer received this from someone else or wrote it themselves in detail. Read the whole thing first. Synthesize before responding. Go to **Path C — Pasted Document**.

Example triggers:
```
/mvp my client sent me this brief: [long document]
/mvp here's the PRD my manager gave me: [long document]
/mvp I wrote this out already, help me scope it: [long document]
```

---

## Path A — Vague Idea

The developer has a rough idea. You need to understand it before you can challenge it.

### Step A1 — Understand the core idea

Ask the single most important question first. Not a list. One question.

The most important question is almost always: **who is this for and what problem does it solve for them?**

```
Before we define what to build — who is this for,
and what problem does it solve for them specifically?

Not the features yet. Just: who is the user,
and what are they struggling with today that
this fixes?
```

Listen to the answer. Build a picture of the user and the problem before moving forward.

### Step A2 — Ask focused questions one at a time

Work through the questions below. Not all at once — one at a time. Each answer shapes the next question. Skip any question that the previous answer already resolved.

After each answer, give your read on what it means before asking the next question.

**Questions to work through:**

**On the core value:**
```
What is the one thing this product does that makes
someone choose it over doing nothing or using
something they already have?

My thinking: [your read based on what they said so far]

Does that match what you had in mind?
```

**On the user:**
```
Who specifically is the first user? Not "small businesses"
— a specific type of person in a specific situation.

My thinking: [your recommendation based on context]

Is that right, or is the target user different?
```

**On the MVP boundary:**
```
If you could only ship three features and nothing else —
what are the three that make this worth using at all?

My thinking: [your recommendation — be specific]

Do those three feel right, or would you swap something?
```

**On what NOT to build:**
```
What have you thought about adding that we should
deliberately leave out of V1?

My thinking: [things you've inferred they might be
tempted to add based on the idea — name them specifically]

Are any of these actually essential for V1?
```

**On the definition of done:**
```
What does a successful MVP look like in practice?
Not metrics — what can a real user actually do
with it when it ships?
```

### Step A3 — Synthesize and confirm

Once you have enough to define the scope clearly, stop asking questions. Produce a summary of what you heard and what you recommend:

```
Here is what I understand we are building:

Product: [one sentence]
User: [specific person in specific situation]
Core problem: [what they struggle with today]

MVP includes:
- [feature 1 — and why it's essential]
- [feature 2 — and why it's essential]
- [feature 3 — and why it's essential]

NOT in MVP:
- [feature] — [why it waits]
- [feature] — [why it waits]

Done when: [specific description of what a user can do]

Is this the right scope, or does something need to change?
```

Wait for confirmation. Adjust if needed. Then go to **Output**.

---

## Path B — Over-Scoped Idea

The developer has thought about this. They have features. Probably too many. Do not gather more information — challenge what they gave you.

### Step B1 — Read everything they gave you

Read the full feature list before saying anything. Build a picture of:
- What the core value actually is under all the features
- Which features are essential for V1
- Which features are tempting but not essential
- Which features belong in V2 or later
- What is conspicuously missing

### Step B2 — Challenge scope directly

Do not ask what they want. Tell them what you see — then make them argue with it.

```
I read through everything. Here is my honest read:

The core of this product is [one sentence — the real value].
Everything else is built around that.

For V1, I would keep:
- [feature] — essential, without this the core doesn't work
- [feature] — essential, this is the reason someone uses it
- [feature] — essential, without this V1 has no value

I would cut for now:
- [feature] — valuable but not needed to prove the core works
- [feature] — this is a V2 problem, not a V1 problem
- [feature] — adds complexity without changing whether V1 succeeds

The NOT list is as important as the build list. Every feature
you add to V1 is weeks of extra time before anything ships.

Does this cut feel right, or is there something in the
cut list that you believe is actually essential for V1?
```

Be direct. If something should be cut, say it plainly and say why. Do not soften it.

### Step B3 — Work through disagreements

If the developer pushes back on a cut, engage with the reasoning:

```
Tell me why [feature] needs to be in V1.

If it is because [reason], I understand — let's put it back.
If it is because [different reason], I would still cut it because [why].
```

Hold your position if the reasoning is weak. Change it if they give you a real reason you had not considered.

### Step B4 — Confirm the final scope

Once the scope is settled:

```
Final scope:

MVP includes:
- [feature]
- [feature]
- [feature]

NOT in MVP:
- [feature] — revisit after V1 ships
- [feature] — V2

Done when: [specific description]

Ready to lock this in?
```

Wait for confirmation. Then go to **Output**.

---

## Path C — Pasted Document

The developer gave you a document. Someone else wrote it, or they wrote it themselves. Your job is to read it properly and come back with a structured challenge — not a list of questions.

### Step C1 — Read the entire document

Read everything before responding. Do not skim. Build a complete picture of:
- What the product is
- Who it is for
- What features or requirements are described
- What decisions have already been made
- What is missing or unclear
- What is over-scoped for a first version

### Step C2 — Come back with a structured response

Do not ask questions. Present your read, your recommended scope, and your concerns. One response. Then let them react.

```
I read through the full document. Here is my read:

**What this is:**
[One paragraph — the product in plain terms, as you understand it]

**What I think the MVP should be:**
[The minimal scope that proves the core value works]

IN for MVP:
- [requirement/feature from the doc] — essential
- [requirement/feature from the doc] — essential
- [requirement/feature from the doc] — essential

OUT for now:
- [requirement/feature from the doc] — [why it waits]
- [requirement/feature from the doc] — [why it waits]

**What concerns me:**
- [Something unclear, contradictory, or missing in the document]
- [Something that will cause problems if not decided now]
- [An assumption in the document that should be confirmed]

**What the document does not answer:**
- [Gap 1 — and why it matters for scoping]
- [Gap 2 — and why it matters for scoping]

Does this read match what the client/stakeholder actually wants,
or am I misreading something?
```

### Step C3 — Work through what surfaces

After the developer responds, work through the concerns and gaps one at a time. Use the same pattern as Path A Step A2 — one question at a time with your recommendation attached.

Once gaps are resolved and scope is confirmed, go to **Output**.

---

## Output — Write context/mvp.md

All three paths end here. The conversation is done. The scope is confirmed. Now write the file.

Create `context/mvp.md`. If it already exists, show the developer what is currently there and ask for confirmation before overwriting.

```markdown
# MVP Scope

Defined: [date]

## Product
[One sentence — what this product is]

## User
[Specific person in specific situation — not a broad category]

## Problem
[What this user struggles with today that this product solves]

## What We Are Building

| Feature | Why it's in V1 |
|---|---|
| [feature] | [reason] |
| [feature] | [reason] |
| [feature] | [reason] |

## What We Are NOT Building

| Feature | Why it waits |
|---|---|
| [feature] | [reason] |
| [feature] | [reason] |

## MVP Boundary
[Specific description of what a real user can do when V1 ships.
Not metrics. Not goals. What they can actually do.]

## Feature Priority
Build in this order:
1. [feature] — [why first]
2. [feature] — [why second]
3. [feature] — [why third]

## Open Decisions
[Anything that was not resolved during scoping and needs
a decision before or during architecture]
```

After writing, confirm:

```
Scope locked → context/mvp.md

Next step: /architect — technical decisions based on this scope.
```

---

## The Standard

A good MVP scope has three properties:

**It is small enough to ship.** If you cannot describe what V1 does in two sentences, the scope is too large.

**It is clear enough to build.** Anyone reading `context/mvp.md` should know exactly what to build and exactly what not to build — without asking you.

**It is honest about what it is not.** The NOT list is not a failure. It is proof that you made deliberate decisions instead of letting scope expand by default.

If the scope does not meet all three — keep challenging until it does.

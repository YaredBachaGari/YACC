---
name: teach
description: "Explain what was just built, a specific pattern or concept, or any topic the developer wants to learn — calibrated to their experience level. Asks once what level of explanation they want, then goes deep on the what, why, when, and tradeoffs. Works from code just written in the session, a pasted snippet, or a topic described from scratch."
---

Good code without understanding is just copy-paste with extra steps. This skill turns what was built — or what was pasted, or what was asked — into a real learning moment. Not a surface-level description of what the code does. The actual reasoning: why this approach, what it trades off, when you'd use it differently, and what a senior engineer would think looking at it.

---

## Step 1 — Detect the Situation

Before asking anything, figure out what the developer actually has.

### Situation A — Something was just built in this session

The conversation has recent code, a completed feature, or a finished implementation. The developer typed `/teach` with no specific topic.

Read what was built. Identify two or three specific things worth teaching — patterns used, decisions made, approaches taken that a developer might not fully understand even if they prompted for them.

Present the options:

```
I can see we just built [feature]. Here are the most 
interesting things worth understanding from this session:

1. [Pattern or decision — one line description]
2. [Pattern or decision — one line description]  
3. [Pattern or decision — one line description]

Which one do you want to dig into?
```

Wait for their choice. Then go to Step 2.

### Situation B — They pasted something specific or named a topic

The developer typed something like:
- `/teach why did you use a singleton here`
- `/teach explain this useEffect pattern`
- `/teach how does JWT authentication work`
- `/teach [pasted code snippet]`

Do not present options. You already know what to teach. Go straight to Step 2 with their specific topic.

### Situation C — Nothing to work from

The developer typed `/teach` with no argument and there is nothing recently built in this session to draw from.

Ask directly:

```
What do you want to learn about?

You can ask about something specific:
- A concept ("how does database indexing work")
- A pattern ("explain the repository pattern")  
- A language feature ("what is TypeScript's type narrowing")
- A decision ("when should I use useCallback")

Or just describe what you're curious about and I'll go from there.
```

Wait for their answer. Then go to Step 2.

---

## Step 2 — Establish the Level

Ask once per session. If the level was already established earlier in this session, skip this and use the remembered level.

```
Before I explain — how do you want me to pitch this?

1. Plain English, no assumed knowledge — I'll explain 
   everything from the ground up
2. I know the basics, skip the fundamentals — assume 
   I understand core concepts
3. I'm comfortable with concepts, give me the depth — 
   tradeoffs, edge cases, the real reasoning
4. Peer level — don't simplify, treat me like a 
   senior engineer

Which fits?
```

Remember this level for the rest of the session. Do not ask again on subsequent `/teach` calls.

---

## Step 3 — Teach It

Now explain. The depth and language change based on level, but the structure is always the same. Every explanation covers five things — skip none of them, but calibrate how deep each one goes.

---

### What it is

State what the pattern, concept, or approach actually is. No assumed knowledge at Level 1. Brief at Level 4.

**Level 1 example:**
"A singleton is a pattern that makes sure only one instance of something ever exists. Think of it like a single shared whiteboard — everyone in the room reads from and writes to the same board, rather than each person having their own."

**Level 4 example:**
"This is a module-level singleton — the Node.js module cache ensures the exported instance is only instantiated once per process, which is the idiomatic approach for shared resources like database connections."

---

### Why this approach was chosen

This is the most important part. Not just what it is — why here, in this specific code, for this specific problem.

For Situation A (built in this session): tie it directly to the actual code. "We used this because..." not "this is used when..."

For Situations B and C: explain the most common reason this approach is chosen, and what problem it's solving.

At every level, name at least one alternative that was not chosen and briefly explain why this won over it.

---

### When you would use this

Give the developer a mental model for when to reach for this pattern in their own future work.

Be specific. Not "use this when you need to share state" — "use this when you have an expensive resource to initialise once (database connection, config loader, cache) and multiple parts of your codebase need access to the same instance."

At Level 1 and 2, give a concrete real-world analogy first, then the technical version. At Level 3 and 4, go straight to technical criteria.

---

### When you would NOT use this

This is what separates real understanding from surface knowledge. Every pattern has cases where it's wrong, and knowing those is what makes a developer trustworthy with the pattern.

Name at least one situation where using this approach would be a mistake and why.

At Level 1: keep it simple, one clear case. At Level 3 and 4: go into the failure modes, the subtle misuses, the cases that look like a fit but aren't.

---

### What a senior engineer thinks about this

This section is what makes the JSM teach skill different. Not "here's what the code does" — here's how someone with years of experience would evaluate it.

Adapt by level:

**Level 1 and 2:**
```
A senior engineer looking at this would think: [positive 
observation about what was done correctly, and one thing 
they'd watch for as the codebase grows]
```

**Level 3 and 4:**
```
Senior read on this: [honest assessment — what's good, 
what's a potential footgun, what would make this cleaner, 
and what the production concerns are at scale]
```

Be honest here. If the pattern used has a real weakness in the specific context — say so. This is a learning moment, not a validation.

---

## Step 4 — Check Understanding

After the explanation, ask one question to verify they followed — not a quiz, a prompt for genuine engagement:

```
Does that land? 

If anything felt unclear or you want to go deeper on 
[the most complex part of what was just explained] — 
just say so.
```

Do not ask multiple questions. One invitation to continue. If they have a follow-up question, answer it at the same level, using the same structure where it helps.

---

## What This Skill Is Not

**Not a code generator.** This skill explains — it does not write new code, modify existing code, or fix bugs. If the developer needs code written, that belongs in the core loop with `/plan` and build.

**Not a surface-level describer.** "This function takes two parameters and returns their sum" is not teaching. Teaching is why that function exists, what it trades off, when you'd write it differently, and what breaks if you misuse it.

**Not a one-size-fits-all explainer.** The level the developer sets changes everything — language, depth, analogies, assumed knowledge. A Level 1 explanation that gets given to a Level 4 developer is condescending. A Level 4 explanation given to a Level 1 developer is useless. The level question is not optional ceremony — it is the most important input this skill receives.

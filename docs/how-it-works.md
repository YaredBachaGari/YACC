# How YACC works

What HQ does behind the office: where agents work, how they talk, what reaches GitHub, and what HQ saves. New here? Start with the [getting-started guide](getting-started.md).

- [The team](#the-team)
- [Workspaces and sessions](#workspaces-and-sessions)
- [Messages between agents](#messages-between-agents)
- [GitHub and reviews](#github-and-reviews)
- [Sandboxes and network access](#sandboxes-and-network-access)
- [Terminals, links and ports](#terminals-links-and-ports)
- [Action items](#action-items)
- [Your stack](#your-stack)
- [MCP servers](#mcp-servers)
- [App variables and keys](#app-variables-and-keys)
- [Settings you can change any time](#settings-you-can-change-any-time)
- [What HQ saves, and where](#what-hq-saves-and-where)
- [Models](#models)
- [The office](#the-office)
- [Windows](#windows)
- [Keyboard shortcuts](#keyboard-shortcuts)

## The team

- **The lead** plans and assigns. It creates boards (for example one per phase), splits the work into tasks and gives each task to a free worker. It never writes app code.
- **Workers** build. One task means one branch and one pull request. A worker edits only the files its task lists and asks the lead if it needs more.
- Each agent runs on a **model**: Claude (Claude Code), OpenAI (Codex), Gemini (Gemini CLI) or DeepSeek (Claude Code pointed at DeepSeek's API). It runs in a **Sandbox** (the default) or in **Local** mode. Set both per agent in Settings → Team, or a default per role in Settings → Roles. See [Models](#models).

New teams get names from The Office: Michael leads, then Dwight, Jim, Pam and so on. Rename them any time.

## Workspaces and sessions

- **Its own copy of the repo.** Each agent gets a full clone at `~/.yacc/<project>/<agent>/`. Your own working folder is never touched.
- **Its instructions.** HQ writes `.yacc-role.md` into that folder: the agent's role (the ROLE.md text from Settings → Team), the team, the rules and its tools. HQ also adds its hooks and MCP config there, and keeps all of these out of git. If the folder has its own `ROLE.md`, HQ includes it and never overwrites it.
- **Its session.** On macOS and Linux each agent runs in a tmux session called `hq-<project>-<agent>`, so agents keep working if you close HQ or the browser. You can watch one from any terminal with `tmux attach -t hq-<project>-<agent>`, or open its drawer in HQ.

## Messages between agents

Agents talk to each other and to HQ through an MCP server called `hq`, which HQ runs for them.

- The lead uses it to create boards and tasks and to assign them. Any agent can send a message.
- A message is delivered right away if the agent is idle, or when it finishes its current step if it's busy.
- You can message any agent from the **Messages** tab in its drawer.

## GitHub and reviews

HQ reads your PRs, checks and review comments with your `gh` login, about every 20 seconds.

- It matches a PR to its task by the `[TASK-ID]` at the start of the title.
- New review comments are sent to the PR's author to fix.
- When a PR passes review, the lead is told it's ready to merge.
- When a PR is merged, its task is marked done.
- If a PR has merge conflicts with `main`, the author is told to fix them.

**HQ never merges.** You merge on GitHub.

Pick the review tool in Settings → Workflow: CodeRabbit, Greptile, Copilot, you, or your own.

## Sandboxes and network access

Each agent in Sandbox mode runs in its own [Docker Sandbox](https://docs.docker.com/ai/sandboxes/), a small VM with its own copy of the repo. It can't reach the rest of your machine.

- **Network policy.** You choose one when you install Docker Sandboxes. **Balanced** is recommended: AI services, package registries and GitHub are allowed, everything else is blocked. HQ never changes it; it only adds the one rule that lets sandboxes reach HQ.
- **When an agent needs a website** (a tool's docs or an API), it asks with the `request_access` tool instead of working around the block. Its card turns red and its drawer shows **Allow for this agent / Allow for everyone / Deny**.
- **Blocked requests** the agent didn't ask about are listed too: the agent's card shows "N blocked", and its drawer lists them with **Allow / Dismiss**.
- **Allowing a website** adds a rule for that sandbox only. Your base policy is never touched, and HQ only removes rules it added.
- **CPU and memory** are set in Settings → Sandbox. A sandbox gets its size when it's created, so after changing it press **Recreate sandbox**. Stop and Start keeps the old size. Recreating keeps the agent's folder and code but clears anything installed inside the sandbox.

## Terminals, links and ports

- **Resize any panel.** Drag a panel's left edge to make it wider (HQ remembers the width in this browser; double-click the edge to reset), or press the square button to fill the screen. Terminals resize with it, so full-screen tools that need more rows fit.
- **Shell tab.** A shell inside the agent's sandbox (or its folder in Local mode), beside the agent.
- **Terminal** (top bar). Your own shell on this machine, not in a sandbox: in your repo, an agent's folder, or any folder you type. Be careful in an agent's folder while it's working: it's the same copy of the repo the agent is editing.
- **Links** in any terminal open in a new tab when you click them, including long URLs that wrap onto the next line. If your browser blocks the new tab, HQ copies the link instead.
- **Opening the browser.** Tools in a sandbox that open a web page (for example a CLI sign-in) open it in your browser, if that website is allowed for the sandbox. If it isn't, the tool prints the link: click it in the terminal.
- **Ports.** When a program in the Shell tab prints a `localhost:<port>` address, HQ offers to **Forward port**: then `localhost:<port>` on your machine reaches the sandbox. CLI sign-ins that redirect your browser back to `localhost` need this. You can also forward any port, and stop forwarding, in the agent's **Sandbox** tab. The program inside the sandbox must listen on all addresses (`0.0.0.0`), not only `127.0.0.1`.

## Action items

**Action items** in the top bar is everything waiting on you:

- requests from agents (made with the `ask_user` tool): create a database, add a key, change a dashboard setting. Each one has exact steps and names the variable, never the secret value;
- agents waiting for an answer in their terminal;
- websites agents asked to reach, and ones their sandbox blocked;
- pull requests ready to merge.

Mark a request **Done** (with an optional note) or **Dismiss** it, and HQ tells the agent so it can continue. Action items stay on your machine and are never committed.

## Your stack

Optional. In Settings → Stack (or during the welcome), pick what the project uses: frameworks, plus tools for auth, payments, database, analytics and security. You can also add your own under "Other".

- Agents see the stack in their instructions.
- Each tool's official agent skills are installed into the agents' folders (`.claude/skills`, `.agents/skills`), kept out of git.
- One click allows every tool's docs and API websites for all sandboxes.

Skip it and nothing changes.

## MCP servers

Give agents extra tools (Supabase, Stripe, Figma, your own…) in **Settings → MCP**:

1. **Add server:** a URL and an optional API key, or a command for a local server. Tools from your stack fill in their URL for you.
2. **Sign in** if the server asks. Sign-ins and keys stay with Docker Sandboxes and never enter a sandbox.
3. **Tick the agents** that should get it. A running agent gets the tools right away, without a restart.

Unticking a server takes effect when that agent's sandbox is recreated, because Docker Sandboxes can't detach a server from one sandbox.

**Supabase tip:** add `?project_ref=<id>` to the URL (Supabase → Project Settings → General) so the agent can only reach that project. Use a development project, not production.

## App variables and keys

- **App variables** (Settings → Sandbox → App variables) become environment variables in the agent's session and its Shell tab. They're not a `.env` file in the project. Agents are told the names, never the values. Restart the agent after changing them.
- **Service keys** (Settings → Sandbox) go to Docker Sandboxes' secret store. A sandbox's proxy adds the key to matching requests, so the key itself never enters the VM.

HQ never stores key values and never reads your env files.

## Settings you can change any time

| Setting | Where | Applies |
| --- | --- | --- |
| Office name (the sign on the wall) | Settings → Project | Right away, for everyone on the project |
| Office theme: Modern, Studio, Lab, Loft or Night shift | Settings → Project | Right away, for everyone on the project |
| Agent profile: look or picture, colour, bio | Settings → Team → More | Right away; the bio reaches the agent the next time it starts |
| Your look as CEO | Settings → Team → Your look in the office | Right away |
| Font: Pixel, Clean or Mono | Settings → Project | Right away, in this browser only. The office itself stays pixel. |
| Review tool | Settings → Workflow | Right away |
| Agents, roles, CLI, mode | Settings → Team | Next time the agent starts |
| CPU and memory | Settings → Sandbox | After **Recreate sandbox** |
| MCP servers per agent | Settings → MCP | Right away for new servers |

## What HQ saves, and where

| File | What | Commit it? |
| --- | --- | --- |
| `.yacc/config.yml` (in your repo) | CEO, headcount limit, roles, team, workflow, stack, office name and theme, profiles | Yes, so your team shares it |
| `.yacc/avatars/` (in your repo) | Pictures uploaded for agents and you (small PNGs) | Yes, so teammates see the same faces |
| `.yacc/roles/<role>.md` (in your repo) | Each role's instructions | Yes |
| `.yacc/plan.json` (in your repo) | Boards and tasks | Yes |
| `docs/plan.md` (in your repo) | A readable copy of the plan, if **Settings → Project → Export plan** is on | Yes |
| `~/.yacc/<project>/` | Agents' folders, app variables, action items and HQ's own records | No, it's outside your repo, on your machine only |

**Remove a project:** delete each agent in Settings → Team (this removes its sandbox and, if you choose, its folder), then delete `~/.yacc/<project>`.

## Models

Each agent runs on one model, in the program made for it:

| Model | Program | Sign in with | In a sandbox |
| --- | --- | --- | --- |
| Claude | Claude Code | Your Claude subscription, or an Anthropic API key | Subscription: sign in in the agent's terminal the first time. Key: `sbx secret set anthropic` |
| OpenAI | Codex | Your ChatGPT subscription, or an OpenAI API key | `sbx secret set openai --oauth` (subscription) or `sbx secret set openai` (key) |
| Gemini | Gemini CLI | An API key from Google AI Studio, or Sign in with Google (Local mode only) | `sbx secret set google` |
| DeepSeek | Claude Code, pointed at DeepSeek's API | API key only | YACC adds DeepSeek to Docker Sandboxes' model providers, then `sbx secret set deepseek` |

**Settings → Models** sets how YACC signs in to each provider, and shows what each still needs, with a **Run in terminal** button where YACC can do it for you. The Setup checklist shows the same steps, only for the models your team uses.

- **Keys never go in `config.yml`.** For sandboxes they live in Docker's secret store, and its proxy adds them to requests, so a key never enters a sandbox. In Local mode, the program reads the key from the environment YACC was started from (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `PERPLEXITY_API_KEY`). Set it in your shell profile, then restart YACC. YACC passes it to that agent's session through an owner-only file, never on the command line.
- **Model names.** Leave the model empty for the program's default, or pick one: `opus`, `sonnet` or `haiku` for Claude; `gpt-5.5` or `gpt-5.4-mini` for Codex; `pro`, `flash` or a Gemini model id for Gemini; `deepseek-v4-pro` (the default) or `deepseek-v4-flash` for DeepSeek. Any name the program accepts works.
- **DeepSeek in a sandbox** uses Docker Sandboxes' model selection, which sbx still marks experimental. The setup step turns it on and adds a `deepseek` provider (`https://api.deepseek.com/anthropic/v1`, Anthropic format), keeping any providers you already have. In Local mode, Claude Code talks to `https://api.deepseek.com/anthropic` directly, as DeepSeek documents.
- **Gemini** gets its role as a context file next to the project's own `GEMINI.md`, the team's MCP server, and hooks so the office shows when it works and finishes. The first time it starts, Gemini CLI may ask you to trust the folder and allow YACC's hooks: allow both. YACC writes these into `.gemini/settings.json` in the agent's own copy (git-excluded); a repo that commits that file can't run Gemini agents.

### Usage and budgets

Claude Code, Codex and Gemini CLI report how many tokens they use, over OpenTelemetry, to YACC on your machine (Claude Code and Gemini as metrics, Codex as log events; never your prompts). YACC writes these settings into each agent's own folder, next to its hooks. If your project already sends Claude Code's or Gemini's telemetry somewhere (its committed settings set an OTLP exporter), YACC leaves that alone and that agent's usage isn't counted.

- **Where you see it:** today's cost on each agent's card; today, this week and this month in the agent's Task tab; the whole team in **Settings → Models → Usage and budgets**.
- **Cost:** Claude Code reports its own cost, which YACC uses for Claude models. For everything else (DeepSeek, Gemini, OpenAI) YACC estimates from a table of API prices, shown with ≈. Your own prices go in `config.yml` under `prices:`. On a subscription, cost is what the same work would cost on the API, not what you pay.
- **Kept on this machine** in `~/.yacc/<project>/usage.json` (the last two months), never in the repo.

**Budgets** are a dollar amount a day, week or month (local time, weeks from Monday), for the whole team and for any agent, set in the same table or in `config.yml`. At 80% Activity warns you once. At 100% YACC **pauses** the agent (or, for the team budget, everyone): it stops handing it new messages and tasks (a turn already running finishes) and opens an action item. **Keep going** lets it continue for the rest of the period; **Stay paused** leaves it until the period ends or you raise the budget.

### Routing and fallback

**Routing rules** send each kind of work to a model: `research → Gemini (pro)`, `review → Claude (opus)`. The lead is told the kinds and sets one on each task it creates (`create_task kind`). When an agent starts a task of that kind, YACC restarts it on that model, keeping its folder, its sandbox (same program) and its task; a task without a rule puts it back on its own model. A busy agent keeps its model, and a model that isn't set up yet is skipped (Activity says so).

**Fallback** is the order of models to switch to when one stops at its **usage limit** (or a billing problem). YACC knows from Claude Code's `StopFailure` hook (Claude Code 2.1.78 or later) and from each program's own limit message on screen ("Claude usage limit reached…", "You've hit your usage limit…", "exhausted your daily quota…"). It then moves the agent to the first fallback from another provider that isn't at a limit and is set up, and tells it to carry on with its task (its earlier conversation is gone, so it checks its notes and git status). It stays on the fallback until you choose **Use own model** in its drawer. With no fallback that can run, you get an action item ("Try again" tells the agent to continue).

Switching to another program (say Claude Code to Codex) recreates the agent's sandbox, since a sandbox is made for one program; the agent's folder is on your machine, so its work stays. The setup checklist includes the models routing and fallback can switch to.

### The adapter contract

A program can join the team when YACC can: give it the role (instructions), connect it to the team's MCP server over HTTP, hear when a turn starts and stops (hooks, and at the end of a turn take `{"decision":"block","reason":…}` to carry on with new messages), and launch it in a Docker Sandbox and on your machine. If it can report its token use over OpenTelemetry (OTLP/HTTP, JSON or protobuf, to `/otlp/<agent>/<token>/v1/metrics` or `/v1/logs`), YACC counts it. `server/adapters.ts` has one adapter per model; the catalog of providers, sign-in modes and model names is `src/data/models.ts`.

### Research with Perplexity

**Settings → Models → Research** adds Perplexity's own MCP server with your API key (stored by Docker Sandboxes), then lets you tick which roles get it. Every agent with a ticked role gets `perplexity_search`, `perplexity_ask` and `perplexity_research`, and is told in its role to use them for anything current and to keep the sources. Running sandboxes get it right away. Local-mode agents need `PERPLEXITY_API_KEY` where YACC starts. Any other MCP server can be given to a role the same way, in Settings → Roles → Tools.

## The office

The **modern office** (the default) is drawn from your settings:

- **Your office** is the glass room at the top left. Click it to open Briefings; a red badge counts unread ones.
- **The lead** sits next to you, by the bookshelf.
- **Desks.** Every other agent has a numbered desk on the open floor. The floor shows as many desks as your headcount limit allows, so a free desk is room for a hire. Pick a desk for an agent in Settings → Team; picking a taken desk swaps the two. In `config.yml` an agent's desk is `desk: 3` (counted from 1). Leave it out and HQ gives the lowest free desk.
- **States.** The laptop logo and the dot on the name tag show what the agent is doing: green working (hands typing), orange waiting on you (a hand up and a "!"), blue in review, a tick when a review passed, grey idle (with a mug). An empty chair means the session isn't running.
- **Messages** fly between desks as a paper plane.
- **The whiteboard** in the meeting area shows the active board's stages (or To do / Doing / Review / Done) with a sticky per task in its owner's colour. Click it to open Plans.

**Themes.** **Settings → Project → Office theme** repaints the office: Modern (warm wood, the default), Studio (terracotta, lots of plants), Lab (white desks, tiled floor), Loft (brick walls, dark wood) or Night shift (dark, with the city lit up outside). Templates pick one (Content Studio starts as Studio, R&D Lab as Lab), and the wall sign is the office name next to it. The theme is saved as `project.theme` in `config.yml`, so everyone on the project sees the same office.

**Profiles.** Each agent has a look: HQ picks one from its id, and you can change it in **Settings → Team → More → Profile**: one of twelve built-in looks, or skin, hair, hair style and glasses one by one, or a picture you upload. A picture is cropped to a square and shrunk to 128 px in your browser, saved as a PNG in `.yacc/avatars/`, and drawn round in place of the face, in the office and in the panels. The profile also holds the agent's colour (its shirt) and a short bio, shown in its drawer. The bio goes into the agent's role file under "About you", and teammates see it in `list_workers`. You get a look too: click your face in **Settings → Team**.

Drag to pan, scroll to zoom, double-click to fit. **Settings → Project → Office style** switches to the classic pixel office, where agents walk to the PR belt; the choice is saved in this browser. With reduced motion turned on in your system, the office stops its animations and only refreshes when something changes state.

## Windows

Windows 11 support is experimental. Run HQ in PowerShell or Windows Terminal, not in WSL.

- There's no tmux, so HQ runs the agents itself. **Agents stop when HQ stops.** Their sandboxes and folders are kept; press **Start** to run them again.
- Use the terminal in the agent's drawer; there's no `tmux attach`.
- In Local mode, the agent's env file isn't loaded. Use Sandbox mode for app variables.
- A sandboxed agent's clone uses LF line endings, whatever your git's `core.autocrlf` says, because the sandbox runs Linux. A clone from an older HQ keeps its CRLF files until they're checked out again: git handles them correctly, but if a script won't run, use `rm <file> && git checkout <file>` in the Shell tab. HQ doesn't change a folder you picked for an agent yourself: if git shows every file as changed inside the sandbox, run `git config core.autocrlf input` in that folder.

## Keyboard shortcuts

| Key | Does |
| --- | --- |
| `1`–`9` | Open that agent |
| `Esc` | Close panels |
| `+` / `-` | Zoom in / out |
| `D` | Toggle the debug panel |

Drag to move around the office; scroll to zoom.

## Roles, the org and settings files

Every team has a human **CEO** and one **lead** agent. The CEO briefs the lead; the lead plans, assigns, reviews and reports back. Every other agent has a **role** you define.

A role is a title, a set of permissions and instructions:

| Permission | Team MCP tools it unlocks |
| --- | --- |
| `plan` | `create_board`, `create_task`, `update_task` |
| `assign` | `assign_task` |
| `work` | `get_my_task`, `set_my_status` |
| `hire` | `hire_agent`, `dismiss_agent` |
| `review`, `approve` | none yet; they gain tools with the workflow engine |

Every agent also has `list_workers`, `get_status`, `list_tasks`, `send_message`, `ask_user` and `request_access`. So any agent can message any other, and any agent can ask the CEO directly.

**Hiring.** An agent with `hire` (the lead, by default) adds agents without asking, when no role covers the work or extra work arrives. Three rules bound it: the CEO's headcount limit (`limits.maxAgents`) is never passed; a role created by a hire can take tasks and nothing more; and only agents that were hired can be dismissed by an agent. Agents the CEO added are the CEO's to remove. Each hire and dismissal is shown in Activity with its reason.

**Settings files.** Settings live in `.yacc/config.yml`, and each role's instructions in `.yacc/roles/<role>.md`. The Settings screens write these files, and edits you make by hand are read while HQ runs (Activity says so, or says why an edit was not applied). An old `config.json` is converted on first start and kept as `config.json.bak`.

```yaml
ceo: { name: Abuti }
limits: { maxAgents: 5 }
roles:
  lead: { title: Producer, can: [plan, assign, review, hire], instructions: roles/lead.md }
  writer: { title: Writer, can: [work], instructions: roles/writer.md, cli: claude, model: sonnet, tools: [perplexity] }
team:
  - { id: maya, name: Maya, role: lead }
  - { id: ada, name: Ada, role: writer }     # reportsTo defaults to the lead
  - { id: gus, name: Gus, role: writer, cli: gemini, model: pro }
  - { id: dee, name: Dee, role: writer, cli: deepseek, model: deepseek-v4-flash }
providers:                                   # how YACC signs in; keys never go here
  anthropic: { auth: subscription }
  google: { auth: api-key }
routing:
  rules:                                     # tasks of this kind run on this model
    - { kind: research, cli: gemini, model: pro }
  fallback:                                  # in order, when a model hits its usage limit
    - { cli: codex }
    - { cli: deepseek }
prices:                                      # optional: your own API prices per million tokens
  my-model: { input: 1, output: 4 }
```

Budgets: `limits: { maxAgents: 5, budget: { usd: 50, period: month } }` for the team, `budget: { usd: 5, period: day }` on an agent.

Profiles and the theme:

```yaml
project: { name: Askwell, theme: loft }      # modern, studio, lab, loft or night
ceo: { name: Abuti, avatar: { skin: 4, hair: 0, style: 3, glasses: true } }
team:
  - id: ada
    name: Ada
    role: writer
    color: "#29adff"
    avatar: { image: avatars/ada-1f2e3d4c.png }   # an uploaded picture, under .yacc/
    bio: Writes short, plain scripts for older viewers.
```

`skin` is 0–5, `hair` 0–7, `style` 0–4 (short, long, bun, curly, buzz). Parts you leave out come from the agent's id. Values that don't fit are dropped when the file is read, and a picture path must be under `avatars/`.

`cli` is the agent's model: `claude`, `codex`, `gemini` or `deepseek`. A role's `cli` and `model` are the defaults for new agents with that role, hires included; its `tools` are MCP servers every agent with the role gets. `providers` takes `subscription` or `api-key` for `anthropic`, `openai` and `google`; DeepSeek and Perplexity are API key only.

Boards and tasks stay in `.yacc/plan.json`: they are data, not settings. Secrets never go in either file.

## How work moves: stages and gates

Every task goes through the workflow's **stages** in order (`workflow.stages` in `config.yml`, or Settings → Workflow). Each stage names the role that does it and a **gate**: what must happen before the work moves on.

| Gate | What happens when the owner calls `complete_stage` |
| --- | --- |
| `none` | The work moves to the next stage at once. |
| `review` | A teammate whose role has `review` checks it (the stage's `reviewer` role, if set). They call `approve_work` or `request_changes`. |
| `approval` | The same, with a role that has `approve`. |
| `ceo` | It comes to you as an action item: **Approve**, or **Send back** with what to change. |
| `pull-request` | The owner opens a PR; review and merge on GitHub finish it. Last stage only, and only when finished work is pull requests. |

When a stage is finished, HQ hands the work to someone with the next stage's role, preferring whoever did the last stage, then agents that are running and free, and tells them what the last person said. When nobody has that role, the work waits unassigned and the lead is told to assign it or hire. A review never goes to the person who did the work; when nobody can review, it comes to you. When the last stage is finished, the work is done and the lead is told.

```yaml
workflow:
  item: Piece            # what the board and agents call one unit of work
  deliverable: files     # or pull-request (needs a GitHub remote)
  stages:
    - { name: Research, owner: researcher }
    - { name: Script, owner: writer, gate: review, reviewer: editor }
    - { name: Approve, owner: editor, gate: ceo }
```

With `deliverable: files`, HQ doesn't use GitHub at all: no PR polling, no GitHub setup checks, no PRs button. A project with a GitHub remote starts with the coding flow (one Build stage ending in a pull request); one without starts with a Do stage that the lead reviews.

## Shared files, memory, briefings and autonomy

**Shared files.** Each agent works in its own folder, and a sandboxed agent can see nothing else. `shared/` in your repo is how work passes between them: an agent calls `share_files` with paths in its folder and HQ copies them there (no links out of the folder, no `..`, at most 50 MB a call). When work is handed to an agent, HQ copies the shared folder into `shared/` in that agent's folder (kept out of its git); `get_shared_files` fetches the latest. You see the list in Briefings.

**Project memory.** `.yacc/memory/brief.md`, `decisions.md` and `lessons.md` in your repo. Every agent gets the brief and the newest decisions and lessons in its role file at start, so a new hire starts with the context. Agents add dated lines with `add_to_memory`; the lead (any role with `plan`) rewrites the brief with `update_brief`; you edit all three in Settings → Memory.

**Briefings.** The lead reports with `report_to_ceo`: a summary, where the outputs are, and questions. Reports appear under Briefings in the top bar; your reply goes to the lead as a message. Notices about things the team did on its own appear there too.

**Autonomy** (`autonomy` in `config.yml`, Settings → Team): for hiring and for dismissing, choose `auto` (just do it), `notify` (do it and tell me in Briefings; the default) or `ask` (wait for my approval in Action items). The headcount limit applies in every case. Website access always asks.

## Templates and the role library

A **template** is a whole setup for one purpose: the roles (and their instructions), the starting team, the workflow, autonomy, the headcount limit, the office name and a starting brief. The welcome screen starts from one; after that, everything is ordinary settings.

| Template | Starts with | Work moves |
| --- | --- | --- |
| Software Team | a lead, a developer | Build, ending in a pull request (a review by the lead if there is no GitHub remote) |
| Content Studio | a producer, a researcher, a writer, an editor | Research → Script (the editor reviews) → Final edit (you approve) |
| R&D Lab | a principal, a researcher, an experimenter, an analyst | Survey → Run → Analyse (the principal reviews) → Report (you approve) |
| Start with a lead | a lead | Do (the lead reviews) |

**Save your own** in Settings → Project: on this machine (`~/.yacc/templates/<name>/`, offered for every new project) or in this project (`.yacc/templates/<name>/`, commit it to share). A template folder is `template.yml` plus `roles/<id>.md` and `brief.md`; you can write one by hand. Temporary hires, secrets, sandboxes and tasks are never saved.

The **role library** is a set of ready-made roles: Developer, QA, Designer, Technical writer, Researcher, Writer, Editor, Fact checker, Analyst, Experimenter and Marketer. Add them in Settings → Roles. The lead can see them with `list_roles` and hire into one by its title, with no instructions to write. Library roles can take tasks, and some can review; none can plan, hire or approve.

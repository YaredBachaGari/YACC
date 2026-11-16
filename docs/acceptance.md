# Definitions of done: the audit

Each phase of the plan ended with a "done when". This page says how each one is checked now, and what isn't. Most checks run in CI on every pull request; the end-to-end ones are in [`scripts/acceptance-test.mjs`](../scripts/acceptance-test.mjs), which installs the packed package the way someone outside the project would and drives HQ through its own interfaces: the browser's commands (WebSocket), the HTTP routes, and the Team MCP that agents call, with their token.

**Stand-ins.** CI has no Claude, Gemini or GitHub accounts, so the acceptance test puts stand-in `claude`, `gemini` and `gh` programs on `PATH`. HQ starts them, writes their files and reads their output exactly as it does the real ones; the test then makes the calls the agents would make. What this can't show is a real model doing the work well. That needs accounts and is checked by hand.

| Phase | Done when | Checked by | Result |
| --- | --- | --- | --- |
| 0 | The renamed fork plans a task, a worker opens a PR, and CI is green. | Acceptance step 10; `workflow-test` (the coding flow); CI on every PR | ✅ with stand-ins |
| 1 | A three-role, non-coding team starts from a config file, and the coding team shows no behaviour change. | `roles-test` (YAML settings, legacy config); acceptance steps 2–3 and 10; `workflow-test` | ✅ |
| 2 | One piece moves brief, research, script, edit, human approval with no GitHub account, and the PR flow still passes its tests. | Acceptance step 5; `workflow-test`, `teamwork-test` | ✅ |
| 3 | A first run of Content Studio reaches a running team through the wizard alone. | Browser run on the installed package (below); acceptance steps 2–3 | ✅ after a fix (below) |
| 4 | One team runs agents on two runtimes with different models, and usage is visible per agent. | Acceptance steps 3 and 6; `models-test`, `usage-test` | ✅ with stand-ins |
| 5 | A template built only through the UI exports and re-imports cleanly. | Acceptance step 7; `hardening-test` (round trip) | ✅ |
| 6 | A researcher and a writer use different tools and both cite the same shared brief. | Acceptance step 4; `toolkits-test` | ✅ |
| 7 | Someone outside the project installs it and runs a shared template unaided. | The whole acceptance test, in CI on Ubuntu and on a bare `node:22-bookworm-slim` container | ✅ from the tarball; from npm once released (below) |

## What each check does

**Phase 0.** A Software Team on a repo whose `origin` is on GitHub. The lead creates a board and a task over the Team MCP and assigns it; the developer is told to open a PR titled `[<task>] …`, commits on a branch in its own clone, and runs `gh pr create`. HQ's PR sync sees the PR, links it to the task (in review), follows the approval, and marks the task done when the PR is merged. HQ never merges. CI (`.github/workflows/ci.yml`) builds and tests on Linux, macOS and Windows on every pull request.

**Phase 1.** `roles-test` loads teams from `config.yml` (and migrates the old `config.json`). The acceptance test's newsletter team has four roles, none of them coding. The coding team still ends each task in a pull request, and the developer's role file still says branch and pull request (`workflow-test`: "the coding flow is unchanged").

**Phase 2.** On a repo with no GitHub remote: the lead plans an issue; the researcher shares its notes (`shared/research/…` in the repo) and completes Research; the writer gets the Draft; the editor sends it back once, then approves; the editor completes Final; you approve it in Action items; it's done. No pull requests, no GitHub.

**Phase 3.** On the installed package, with no Docker Sandboxes on the machine: open HQ in a browser, pick **Content Studio**, **Create team**, close the setup checklist, **Start team**. All four agents run, in Local mode, within a second or two, without opening Settings (checked with Playwright on this branch).

*Found and fixed by this audit:* on a machine without sandboxes, the wizard used to create every agent in sandbox mode, so starting failed until each agent was switched to Local in Settings → Team. The wizard now starts agents in Local mode when sandboxes aren't ready and Local mode is, and the setup checklist has a **Switch all to Local** button for teams made earlier.

**Phase 4.** The researcher runs on Gemini CLI with Gemini 3 Flash, the writer on Claude Code with Opus, in the same team. Each program's token reports (OpenTelemetry, as the real programs send them) show under its own agent and model in the usage view: 12,800 and 4,500 tokens, each with its estimated cost.

**Phase 5.** Through the same commands the Settings screens send: add a Fact checker role, add a Fact check stage, give the role a toolkit, save as a template. Export it, preview it (the new stage and role are there), install it, export it again: the two files match. `hardening-test` also checks a full round trip of roles, stages, team, toolkits, skills and schedules.

**Phase 6.** The researcher's and the writer's role files: the writer's lists the documents and writing toolkits and the newsletter-format skill; the researcher's doesn't. Both carry the same brief.

**Phase 7.** In a temporary home folder: `npm install` the packed tarball; start HQ on a fresh repo; install the Newsletter desk from the gallery's file (preview first); finish the welcome with it; run it end to end as above; the audit log has the install, the assignments, the reviews, your approval, the config changes and the retrospective; the project switcher lists the project and opens a second one, starting its HQ. The same test runs on a bare Linux container with no compilers.

## Not covered automatically

- **Real models.** Whether a real Claude Code or Gemini CLI does good work isn't something CI can check. Run a team by hand before a release.
- **Sandboxes.** Docker Sandboxes need KVM and a Docker account; CI runs agents in Local mode. The sandbox setup checks are unit-tested; running agents in real sandboxes is checked by hand.
- **npm.** Until the first release is published (push a `v0.12.0` tag; the Release workflow needs the `NPM_TOKEN` secret, see [Releasing](releasing.md)), "install it" means the tarball, not `npx yacc-hq`. The Release workflow runs this same acceptance test on the tarball before it publishes.
- **The online gallery.** CI installs the gallery template from its file. Reading the gallery over https is tested with a stand-in fetch (`hardening-test`); the live index on GitHub is read once this branch is on `main`.

## Running it yourself

```bash
pnpm build && mkdir -p pack && npm pack --ignore-scripts --pack-destination pack
node scripts/acceptance-test.mjs pack/yacc-hq-*.tgz
```

It needs Node 20+, git and tmux, and takes about two minutes.

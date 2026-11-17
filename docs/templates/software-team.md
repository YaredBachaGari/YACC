# Software Team

A lead plans the work into small tasks, each with the files it may touch; developers take one each, work on their own branch, and open a pull request. Reviews happen on GitHub, and you merge.

**Needs:** a git repo with a GitHub remote (`gh repo create … --source . --push`), the GitHub CLI signed in (`gh auth login`), and, for sandboxes, `sbx secret set github --command "gh auth token"`. Without a remote the team still works, but each task ends as files the lead reviews instead of a pull request.

## Start

1. In your repo: `npx yacc-hq`. On the welcome screen pick **Software Team**.
2. Keep Michael (lead) and Dwight (developer), or add developers. Pick a model for each and a review tool (CodeRabbit, Greptile, Copilot, or you).
3. Optional: pick your stack (framework, database, auth…). Agents get those tools' skills and are told what the project uses.
4. Finish the setup checklist, then **Start team**.

## First task

Add a short `plan.md` to the repo, then message Michael:

> Read plan.md. Create a board for Phase 1, plan its tasks with the files each touches, and assign them.

Watch tasks land on the plan wall and pull requests roll through the review gate. When you merge on GitHub, the task is marked done. HQ never merges.

## Make it yours

- **Roles:** the role library has QA, designer and technical writer; hire them in Settings → Team, or let Michael hire (Settings → Team sets the headcount limit and whether hiring waits for you).
- **Toolkits:** QA gets web testing (Playwright), a designer gets frontend design, a technical writer gets documents.
- **Schedules:** a weekly progress report is included, switched off. Turn it on in Settings → Schedules.

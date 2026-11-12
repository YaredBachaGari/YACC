## Implementation plan: Phase C — GitHub PR and review loop

### What we're building
HQ reads the project's PRs from GitHub through your `gh` login (read-only), matches each PR to its task and agent, and works out its review state for the configured tool. Real PRs drive the PR board, belt and gate. When a review leaves comments, HQ immediately tells the PR's agent to fix them. When a PR passes or is merged, HQ updates the task and tells the lead. HQ never merges; the PR drawer links out to GitHub.

### Decisions
- **Polling:** one GraphQL query every ~20s, plus a refresh when an agent reports a PR (`set_my_status in-review`) or finishes a turn.
- **PR → task:** `[TASK-ID]` in the title, otherwise a task id in the branch name. **PR → agent:** the task's owner, otherwise the branch prefix (`alice/…`).
- **Bot review state** (CodeRabbit `coderabbitai`, Greptile, Copilot): reviewing = the bot's status/check is pending; changes requested = unresolved, non-outdated threads started by the bot; passed = the bot's check succeeded with none of its threads unresolved; rate limited / skipped = a warning, not passed.
- **Human review:** GitHub's review decision, or the latest approving / changes-requested review.
- **Automations:** changes requested → the author is told to fix the comments; passed → the lead is told it's ready to merge; merged → the task is done and the lead is told; merge conflict → the author is told to rebase.
- **Read-only:** "Open on GitHub" link; if the workflow says the lead merges, the lead runs `gh pr merge` itself.
- **Repo:** taken from the repo's `origin` remote. Real-world data from jsmastery-pro/askwell confirmed: CodeRabbit posts COMMENTED reviews and a `CodeRabbit` commit status ("Review completed", "Review rate limited").

### How to build it
1. `server/github.ts`: GraphQL query (open PRs + latest merged) and parser → `PullRequest` (with URL and branch).
2. Review mapping per tool, checked against real Askwell responses.
3. Poller: diff against the last result, emit `pr.updated`, update tasks, run automations through the inbox.
4. UI: real PR rows, "Open on GitHub", review notes; closed PRs leave the board.
5. Live test on Askwell with a docs-only PR (no app code changes).

- **Done when:** a real Askwell PR goes desk → gate → back to the agent with comments → fixed → passed → merged by you → task done, with no relaying.

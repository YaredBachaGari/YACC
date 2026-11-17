# Changelog

## 0.12.0

The first release on npm: `npx yacc-hq`.

- **Audit log:** every assignment, review, approval, access grant, key change, hire, budget hold, schedule run, template install and config change, with who did it (you, an agent, a schedule, or a hand edit of `config.yml`) and, for config, what changed. Settings → Audit log, with filters and a CSV download. Kept in `~/.yacc/<project>/audit/`, one file a month.
- **Several projects:** the project name in the top bar switches between every repo you've run HQ in. A stopped project's HQ starts in the background when you open it; add another repo by its folder.
- **Sharing templates:** export any template as one `.yacc-template.json` file; install from a file, a link or the gallery, always after a preview of what it adds. Schedules come switched off and nothing is overwritten. A public gallery in `templates/` starts with Newsletter desk, Market research and Website builder.
- **Retrospectives:** when a board is done, the lead is asked what to change in the roles' instructions and proposes edits; you see the before and after and accept or reject each one. Settings → Workflow turns it off or asks for one now.
- The lead can close a board (`update_board`).
- Docs: a getting-started guide per template, sharing templates, releasing; an acceptance test that installs the package and runs a shared template the way a new user would.

## 0.11.0

Phase 6: toolkits (skills and MCP servers by role), team skills, who may message whom, and schedules.

## 0.10.0

Org chart and workflow editors.

## 0.9.0

Agent profiles (faces, bios) and office themes.

## 0.8.0

Usage and budgets per agent, model routing by kind of work, and fallback at usage limits.

## 0.7.0

Gemini CLI and DeepSeek agents, sign-in per provider, Perplexity research.

## 0.6.0

The modern office with assigned desks.

## 0.5.0

Templates (Software Team, Content Studio, R&D Lab, Start with a lead), the setup wizard and the role library.

## 0.4.0

Shared files, project memory, briefings and autonomy settings.

## 0.3.0

Workflow stages with review and CEO gates, and handoffs.

## 0.2.0

Roles, the org chart and YAML settings (`.yacc/config.yml`).

## 0.1.0

Forked from jsm-hq and renamed YACC.

## Implementation plan: Phase B — Team MCP and the plan

### What we're building
HQ hosts an MCP server that every agent connects to. The lead uses it to create tasks, assign them and check status. Every agent can message any other agent, and workers fetch their own task details. HQ delivers each assignment and message: if the recipient is idle, HQ types it into their terminal; if the recipient is busy, HQ queues it and hands it over through their Stop hook when their turn ends. The plan (boards and tasks) lives in HQ and shows live on the plan wall, in the Boards drawer and in the Messages tab. You stop being the messenger.

### Decisions
- **Delivery:** HQ types into the terminal when the agent is idle. When it's busy, HQ uses a Stop hook that blocks with a reason, which makes Claude carry on with the message. This part gets proven first.
- **Assignment:** the worker gets "Pull main, start P3-T02. Call get_my_task for details." The full task stays in HQ.
- **MCP transport:** Streamable HTTP at `/mcp`. Each agent's `.mcp.json` carries its own identity and the agent token. Claude Code's prompt to approve project MCP servers is pre-approved in the agent's `settings.local.json`.
- **Permissions:** only the lead can create, assign and edit tasks. Workers can read their own task, update its status (`in-progress` / `blocked` / `in-review`), and send messages.
- **Task fields:** add `description`, `files` (the only files this task may edit) and `doneWhen`, following the workflow rules in `initial-idea.md`.

### Tools
| Tool | Who | Does |
| --- | --- | --- |
| `list_workers` | all | team, roles, who's free |
| `get_status` | all | each agent's state and current task |
| `list_tasks` | all | tasks on a board, filterable by status or owner |
| `create_task` / `update_task` | lead | add or edit tasks and boards |
| `assign_task` | lead | sets the owner and delivers "start X" to the worker |
| `get_my_task` | workers | the full spec of the task they're on |
| `set_my_status` | workers | in-progress / blocked (with reason) / in-review |
| `send_message` | all | delivered to the other agent; shown as an envelope in the office |

### Assumptions
- Claude Code's Stop hook honours `{"decision":"block","reason":…}`. If it doesn't, busy agents just wait for idle typing.
- The agent's state after a Stop hook ("idle") is a reliable signal that it's safe to type.
- Typing uses tmux `send-keys -l`, then Enter. Long messages are flattened to one line.

### How to build it
1. **Prove the Stop-hook delivery** in a scratch session: queue a message while the agent is busy, and check that it continues with it.
2. Add the new `Task` fields, plan persistence, and `create_task` / `update_task` events.
3. Build the MCP server (`@modelcontextprotocol/sdk`): agent identity from the token plus agent id, lead-only checks, and the tools above.
4. Agent files: `.mcp.json`, MCP approval in `settings.local.json`, the Stop hook printing HQ's response, and ROLE.md rules that explain the tools.
5. Delivery queue: a per-agent inbox. Type when idle, hand over via the Stop hook when busy, and log every delivery to Messages and Activity.
6. UI: assigning from the Boards drawer goes through the same delivery path; a "Message agent" box in the Messages tab lets you message any agent; the office shows the real envelopes.
7. Test live: the lead and Bob in a scratch repo. Give the lead a goal, and it should create tasks and assign Bob, Bob should start, and Bob should message the lead when done.

- **Done when:** you give John one instruction ("Break this into 3 tasks and assign them"), tasks appear on the plan wall, Bob starts on his own, and you can watch messages fly between desks.

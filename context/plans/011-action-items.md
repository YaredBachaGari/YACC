## Implementation plan: Action items

### What we're building
One list of everything waiting on you. Agents ask you to do things outside their sandbox (create a database, add a key to an env file, set something in Vercel), and today those requests get lost in their messages. **Action items** collects them, and also shows the other things already waiting on you.

### Decisions
- **Agents add items with a Team MCP tool:** `ask_user(title, details?, waiting?)`.
  - `details`: the steps (what to create, which env var name, where).
  - `waiting`: true if the agent can't continue without it.
  - Every agent's rules say: when you need the user to do something outside your sandbox, call `ask_user` with clear steps; never put secret values in it.
- **An item has:** id, from (agent), task (its current task, if any), title, details, waiting, status (open / done / dismissed), your note, and the created and closed times.
- **You close an item:**
  - **Done**, with an optional note: HQ messages the agent "The user did: <title>. Note: …", and it continues.
  - **Dismiss**: HQ tells the agent to continue without it.
- **Stored on your Mac** in `~/.jsmhq/<project>/action-items.json`, so it survives restarts and is never committed.
- **Also waiting on you** (read-only, each with an Open link), shown in the same list:
  - agents asking a question in their terminal (red "Needs input");
  - access requests;
  - requests the sandbox blocked;
  - PRs that passed review and are ready to merge.
- **Where it shows:**
  - an **Action items · N** button in the top bar, counting everything waiting on you, which opens a drawer;
  - a count on each agent's card for its open items.

### How to build it
1. Types, storage, `ask_user` tool, Done/Dismiss commands that message the agent, the rule in every agent's role.
2. Drawer: "From agents" (open items, grouped by agent, with Done/Dismiss and a note), "Also waiting on you", and "Closed" (last 20).
3. Top bar button with the count; count on agent cards; activity line when an item is added.
4. Demo data for `pnpm dev`.
5. Live test: a real agent calls `ask_user` when it needs a key, the item appears, Done with a note → the agent gets the message and continues.

- **Done when:** an agent's request to you shows up in Action items without you reading its messages, and closing it lets the agent continue on its own.

### Not in this plan
- Buttons that perform the action for you (e.g. open the env file from an item).
- Reminders or notifications outside the HQ page.

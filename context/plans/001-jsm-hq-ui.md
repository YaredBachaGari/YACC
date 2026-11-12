## Implementation plan: JSM HQ UI (pixel office, configurable, mock data)

### What we're building
A local web app that shows a configurable team of AI coding agents working in a **2D pixel-art office**. The team, workflow, boards and sandbox settings all come from configuration rather than being fixed in code. The whole interface is built now: the office, the HUD, the drawers and the settings screens. All data comes from a mock data source that follows the same interface the real local HQ server will use later. The real server is a later phase. Its key assumption is now confirmed: a sandbox can reach HQ on the host once `sbx policy allow network` permits it, so a custom team MCP server will work.

### Terms we agreed on
- **Team:** 1 lead plus any number of agents with roles you name yourself. Each agent has a role name, model, skills, `ROLE.md` text and sandbox settings.
- **Lead:** the only role HQ treats specially. It plans and assigns work through the team MCP and writes no code.
- **Board:** a kanban board within the one project. A project has several boards (for example per phase or per area), each task belongs to exactly one board, and the lead can create boards. Boards replace the spec's "phases".
- **Workflow:** the fixed stages Build → Review → Merge → Deploy. Each stage can be switched off and given a tool (Review: CodeRabbit, Greptile, Copilot, Human, or a custom command; Deploy: InstaCloud, Vercel, custom, or none). HQ only reads what each stage reports.
- **Sandbox settings:** per agent, the policy level (Open / Balanced / Locked Down), allowed and blocked domains, proxy and secrets. HQ shows secret **names only**; the values stay in Docker's store. HQ always adds the rule that lets the sandbox reach HQ itself.
- **Team MCP:** the MCP server HQ hosts. It carries agent-to-agent messages and the lead's commands (`list_workers`, `get_status`, `assign_task`, `send_message`). Every agent's traffic passes through HQ.

### Decisions
- **2D pixel art, not 3D.** It's simpler to build, and it suits an office that grows with the team better than a fixed 3D scene.
- **Build the UI first, mock data only.** The main backend risk (sandbox → host) is cleared, so the screens can be designed around a backend we know will work.
- **One project with several boards.** This is the smallest change to the data model.
- **PixiJS v8, driven directly from code (no `@pixi/react`).** The scene mounts once and reacts to changes in the zustand store, so React doesn't re-render the office. Pixi gives us per-sprite clicking, camera control, grouping and glow effects.
- **Sprites drawn in code.** They're defined as character grids and turned into textures at startup, so the repo can be open source, and recoloring per agent and state is automatic. No external assets.
- **Lead + custom roles.** Adding QA, Designer and similar roles needs no code.
- **Fixed workflow stages, with a tool chosen for each.** This keeps to "no plugin system". The office only draws a review gate if Review is on, and a server room if Deploy uses environments.
- **Room modules on a grid.** A layout function places the lead corner with the plan wall, one desk per agent in rows, the review area, a server room (one rack per environment) and a lounge. It's meant to look right from 2 to about 12 agents.

### Assumptions (not yet confirmed)
- The stack stays as in the spec, minus the 3D libraries, plus PixiJS: Vite, React 18, TypeScript `strict`, Tailwind, zustand, `@xterm/xterm`, framer-motion, pnpm.
- Settings save only into the mock for now. The real server will later write them to a project config file plus `sbx` commands.
- Agent-to-agent messages show up as speech bubbles in the office, plus a "Messages" tab in the Agent drawer and entries in the activity feed.
- The mock includes two sample datasets: Askwell with 3 agents, and a 7-agent team to test the layout.
- The "Open on GitHub" button and real terminals stay disabled or faked.
- Desktop only, at least 1280px wide.

### How to build it
1. **Rewrite `context/001-ui-build-context.md`** (was `docs/jsmhq-context.md`) to match this plan: 2D, configurable, boards, workflow, sandbox settings, team MCP. It's the source of truth for the build.
2. **Set up the project:** Vite, React and TypeScript, Tailwind, zustand, PixiJS v8, xterm and framer-motion with pnpm, plus the colors, fonts and pixel palette.
3. **Define the data layer:** types for the config (`ProjectConfig`, `AgentConfig`, `WorkflowConfig`, `SandboxSettings`, `Board`) and the live data (`Agent`, `Task`, `PullRequest`, `Environment`, `AgentMessage`, `ActivityEvent`). Extend `OfficeDataSource` with config commands: add, update and remove an agent; update the workflow; update sandbox settings; set a secret name; create a board; assign a task; send terminal input; set speed. Then build the mock source with both sample datasets, a timeline that loops and scales with the team, and fake terminal scripts. The zustand store is fed only through the data source.
4. **Build the pixel engine:** turn character grids into cached textures, recolor per agent and state, add pixel-font text, and a camera with drag-to-pan and whole-number zoom levels.
5. **Write the layout generator:** config in, room modules out, plus the tile map, a walkable grid and anchor points (desks, plan wall, gate, racks, coffee).
6. **Build the scene:** floor and walls, desks with screens, robot agents colored by state (the lead wears a crown), the plan wall, the review gate with its tool label and the rabbit, the PR parcel conveyor, server racks, cables, and hover and click on every object.
7. **Add agent behavior:** pathfinding, idle wandering and coffee runs, walking to the plan wall when a task is assigned, and message bubbles for team MCP messages.
8. **Build the HUD:**
   - Top bar with project, sandbox count, board picker, speed and debug.
   - Team panel (scrolls for large teams).
   - Activity feed.
   - Drawers:
     - Agent drawer, with Terminal, Task, Sandbox and Messages tabs.
     - Boards drawer (kanban per board).
     - PR drawer.
     - Environment drawer.
9. **Build the settings screens:**
   - Team editor: add or remove agents and set role, model, skills and `ROLE.md`.
   - Workflow: switch stages on or off and pick their tools.
   - Sandbox: policy level, allowed and blocked domains, proxy and secret names.
   - Boards and project.
10. **Finish:** debug panel (raw snapshot and recent events), keyboard shortcuts (1–9 jump to an agent, Esc, D), reduced motion, and checks that the office still looks right with 2, 3 and 7 agents.

### Done when
- [ ] The office builds itself from config. 2, 3 and 7 agents each get a sensible layout, and adding an agent in settings adds a desk right away.
- [ ] The timeline loops: agent states change, cards move between columns, PR parcels go through the gate and on to deploy, and the rabbit hops when a review passes.
- [ ] Switching off Review or Deploy hides the gate or server room. The tool names on the gate and racks come from the workflow config.
- [ ] Each object opens the right drawer, and the camera moves to it.
- [ ] The terminal shows streaming fake output and accepts typing.
- [ ] Team MCP messages appear as bubbles, in the Messages tab and in the activity feed.
- [ ] Every settings screen edits the mock, and the change shows up live.
- [ ] Runs at 60fps, no console errors, no network requests.

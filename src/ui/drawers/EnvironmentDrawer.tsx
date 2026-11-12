import { deployToolLabel, useOffice } from "../../store/office";
import { ui } from "../../store/ui";
import { ago, Portrait, SectionTitle, useNow } from "../kit";
import { DrawerHeader } from "./Drawer";

const STATUS_COLOR = { live: "#00e436", deploying: "#3ee0d0", sleeping: "#83769c" } as const;

export function EnvironmentDrawer({ name }: { name: string }) {
  const snap = useOffice((s) => s.snap);
  const now = useNow(1000);
  if (!snap) return null;
  const env = snap.environments.find((e) => e.name === name);
  const agent = env?.agentId ? snap.config.team.find((a) => a.id === env.agentId) : null;
  const tool = deployToolLabel[snap.config.workflow.deploy.tool];

  return (
    <>
      <DrawerHeader>
        <b className="text-[18px]">Environment: {name}</b>
        {env && (
          <span className={`chip chip-dot ${env.status === "deploying" ? "blink" : ""}`} style={{ ["--c" as string]: STATUS_COLOR[env.status] }}>
            {env.status}
          </span>
        )}
      </DrawerHeader>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        {!env ? (
          <p className="text-muted">This environment no longer exists.</p>
        ) : (
          <>
            <div className="panel mb-4 px-3 py-2 text-[14px]">
              <div className="font-term text-[19px]">{env.url}</div>
              <div className="mt-1 text-muted">
                {tool} · last deploy {ago(env.lastDeployAt, now)} ago
              </div>
            </div>
            <SectionTitle>Used by</SectionTitle>
            {agent ? (
              <button className="panel mb-4 flex w-full items-center gap-3 px-3 py-2 text-left" onClick={() => ui.openAgent(agent.id)}>
                <Portrait color={agent.color} lead={agent.isLead} size={32} />
                <div>
                  <b>{agent.name}</b>
                  <div className="text-[13px] text-muted">Its own copy of the app and database, so agents never share state.</div>
                </div>
              </button>
            ) : (
              <p className="mb-4 text-[15px]">Production. Every merged PR deploys here.</p>
            )}
          </>
        )}
        <SectionTitle>All environments</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {snap.environments.map((e) => (
            <button key={e.name} className="btn text-[13px]" aria-pressed={e.name === name} onClick={() => ui.openEnv(e.name)}>
              {e.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import type { Briefing } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { ui } from "../../store/ui";
import { ago, Dot, SectionTitle, useNow } from "../kit";
import { DrawerHeader } from "./Drawer";

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** What the CEO reads: the lead's reports, notices about what the team did on its own, and the shared files. */
export function BriefingsDrawer() {
  const snap = useOffice((s) => s.snap);
  const now = useNow(10_000);
  const [showAllFiles, setShowAllFiles] = useState(false);
  // Opening the drawer counts as reading them; new ones arriving while it is open stay marked until next time.
  useEffect(() => {
    officeActions.markBriefingsRead();
  }, []);
  if (!snap) return null;
  const briefings = snap.briefings ?? [];
  const files = snap.sharedFiles ?? [];
  const agent = (id: string) => snap.config.team.find((a) => a.id === id);
  return (
    <>
      <DrawerHeader>
        <b className="text-[18px]">Briefings</b>
        <span className="text-[13px] text-muted">For {snap.config.ceo.name}</span>
      </DrawerHeader>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        {briefings.length === 0 ? (
          <p className="mb-4 text-[13px] text-muted">Nothing yet. When the lead finishes a request, its report shows up here, with where the outputs are and any questions for you.</p>
        ) : (
          <ul className="mb-5 flex flex-col gap-2">
            {briefings.map((b) => (
              <BriefingCard key={b.id} b={b} from={agent(b.fromId)} now={now} />
            ))}
          </ul>
        )}
        <SectionTitle>Shared files · {files.length}</SectionTitle>
        <p className="mb-2 text-[12px] text-muted">
          In <code>shared/</code> in your repo. Agents add to it with share_files; each one gets a copy when work is handed to it.
        </p>
        {files.length === 0 ? (
          <p className="text-[13px] text-muted">None yet.</p>
        ) : (
          <ul className="flex flex-col border-[3px] border-ink bg-white text-[13px]">
            {(showAllFiles ? files : files.slice(0, 15)).map((f) => (
              <li key={f.path} className="flex gap-2 border-b border-cream-3 px-2 py-1 last:border-b-0">
                <code className="min-w-0 flex-1 truncate" title={f.path}>
                  {f.path}
                </code>
                <span className="text-muted">{agent(f.by)?.name ?? ""}</span>
                <span className="w-[60px] text-right text-muted">{size(f.bytes)}</span>
                <span className="w-[54px] text-right text-muted">{ago(f.at, now)}</span>
              </li>
            ))}
          </ul>
        )}
        {files.length > 15 && (
          <button className="mt-1 text-[12px] underline" onClick={() => setShowAllFiles(!showAllFiles)}>
            {showAllFiles ? "Show fewer" : `Show all ${files.length}`}
          </button>
        )}
      </div>
    </>
  );
}

function BriefingCard({ b, from, now }: { b: Briefing; from?: { id: string; name: string; color: string; role: string }; now: number }) {
  const [reply, setReply] = useState("");
  const notice = b.kind === "notice";
  return (
    <li className={`border-[3px] border-ink px-3 py-2 ${notice ? "bg-cream-2" : "bg-white shadow-[0_3px_0_rgba(36,26,46,0.35)]"} ${!b.read ? "outline outline-[3px] outline-blue" : ""}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[12px] text-muted">
        {from && <Dot color={from.color} size={8} />}
        <button className="underline" onClick={() => from && ui.openAgent(from.id, "messages")}>
          {from ? `${from.name} (${from.role})` : "HQ"}
        </button>
        <span>· {notice ? "notice" : "report"}</span>
        <span>· {ago(b.at, now)} ago</span>
      </div>
      <div className={`whitespace-pre-wrap ${notice ? "text-[13px]" : "text-[14px]"}`}>{b.summary}</div>
      {b.deliverables.length > 0 && (
        <div className="mt-2">
          <b className="text-[12px]">Outputs</b>
          <ul className="ml-4 list-disc text-[13px]">
            {b.deliverables.map((d) => (
              <li key={d}>
                <code>{d}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {b.questions.length > 0 && (
        <div className="mt-2">
          <b className="text-[12px]">Questions for you</b>
          <ol className="ml-4 list-decimal text-[13px]">
            {b.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </div>
      )}
      {!notice &&
        (b.reply ? (
          <div className="mt-2 border-l-[3px] border-ink pl-2 text-[13px]">
            <b>You replied:</b> {b.reply}
          </div>
        ) : (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) officeActions.replyBriefing(b.id, reply.trim());
            }}
          >
            <input className="field min-w-0 flex-1 text-[13px]" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={b.questions.length ? "Answer the questions, or give the next instruction" : "Reply or give the next instruction"} />
            <button className="btn px-2 text-[12px]" type="submit" disabled={!reply.trim()}>
              Reply
            </button>
          </form>
        ))}
    </li>
  );
}

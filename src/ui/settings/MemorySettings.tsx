import { officeActions, useOffice } from "../../store/office";
import { Field, SectionTitle } from "../kit";
import { CommitInput } from "./controls";

/** The project memory every agent starts with. Saved to .yacc/memory/ in the repo. */
export function MemorySettings() {
  const memory = useOffice((s) => s.snap?.memory);
  const live = useOffice((s) => s.live);
  if (!memory)
    return <p className="text-[14px] text-muted">{live ? "Loading…" : "Project memory is kept by real HQ, not the demo."}</p>;
  const area = "field h-[180px] resize-y font-term text-[17px] leading-tight";
  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>Project memory</SectionTitle>
        <p className="mb-3 text-[14px] text-muted">
          What every agent should know. Each agent gets the brief and the latest decisions and lessons when it starts, so a new hire starts with the context. Saved in <code>.yacc/memory/</code>; commit it to share it.
        </p>
        <Field label="Brief" hint="Goals, audience, constraints, what done looks like. You or the lead (update_brief) write it.">
          <CommitInput multiline className={area} value={memory.brief} placeholder="We make 2-minute videos that help older adults spot scams…" onCommit={(v) => officeActions.updateMemory({ brief: v })} />
        </Field>
      </section>
      <Field label="Decisions" hint="Agents add one dated line each with add_to_memory. Edit freely; agents see the 15 newest.">
        <CommitInput multiline className={area} value={memory.decisions} onCommit={(v) => officeActions.updateMemory({ decisions: v })} />
      </Field>
      <Field label="Lessons" hint="What worked and what didn't. Agents see the 10 newest.">
        <CommitInput multiline className={area} value={memory.lessons} onCommit={(v) => officeActions.updateMemory({ lessons: v })} />
      </Field>
    </div>
  );
}

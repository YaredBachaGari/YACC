import { useEffect, useState } from "react";
import { ANY_ROLE, GATE_LABEL, GATES, type DeliverableKind, type GateKind, type StageConfig } from "../../data/types";
import { roleSlug } from "../../data/roles";
import { officeActions, useOffice } from "../../store/office";
import { Field, SectionTitle } from "../kit";
import { CommitInput } from "./controls";

/** The workflow's stages: who does each, and what must happen before work moves on. Saved to config.yml. */
export function StagesSection() {
  const wf = useOffice((s) => s.snap?.config.workflow);
  const roles = useOffice((s) => s.snap?.config.roles) ?? [];
  const github = useOffice((s) => !!s.snap?.config.project.repo.includes("/"));
  // Edited as a draft and saved whole, so a half-made list is never written.
  const [draft, setDraft] = useState<StageConfig[]>(wf?.stages ?? []);
  const saved = JSON.stringify(wf?.stages ?? []);
  useEffect(() => setDraft(JSON.parse(saved)), [saved]);
  if (!wf) return null;
  const dirty = JSON.stringify(draft) !== saved;
  const set = (i: number, patch: Partial<StageConfig>) => setDraft(draft.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...draft];
    const [it] = next.splice(i, 1);
    next.splice(i + by, 0, it);
    setDraft(next);
  };
  const workers = roles.filter((r) => r.can.includes("work"));
  const checkers = (gate: GateKind) => roles.filter((r) => r.can.includes(gate === "approval" ? "approve" : "review"));

  return (
    <section className="border-[3px] border-ink bg-white p-3">
      <SectionTitle>How work moves</SectionTitle>
      <p className="mb-3 text-[13px] text-muted">
        Every {wf.item.toLowerCase()} goes through these stages in order. When a stage is finished, HQ hands the work to the next stage's role, or to whoever must check it first. Saved to <code>.yacc/config.yml</code>.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="A unit of work is called" hint="Shown on the board and to agents: Task, Piece, Experiment…">
          <CommitInput className="field" value={wf.item} maxLength={30} onCommit={(v) => v.trim() && officeActions.updateWorkflow({ item: v.trim() })} />
        </Field>
        <Field label="Finished work is" hint={wf.deliverable === "files" ? "Files in the agents' folders. GitHub is not used." : "A pull request on GitHub, reviewed and merged there."}>
          <select className="field" value={wf.deliverable} onChange={(e) => officeActions.updateWorkflow({ deliverable: e.target.value as DeliverableKind })}>
            <option value="files">Files</option>
            <option value="pull-request" disabled={!github}>
              Pull requests (GitHub){github ? "" : ": needs a GitHub remote"}
            </option>
          </select>
        </Field>
      </div>
      <ol className="flex flex-col gap-2">
        {draft.map((st, i) => (
          <li key={i} className="grid grid-cols-[24px_1fr_1fr_1.3fr_auto] items-end gap-2 border-2 border-ink bg-cream p-2">
            <span className="pb-2 font-term text-[18px]">{i + 1}</span>
            <Field label="Stage">
              <input className="field" value={st.name} maxLength={30} onChange={(e) => set(i, { name: e.target.value, id: roleSlug(e.target.value) })} />
            </Field>
            <Field label="Done by">
              <select className="field" value={st.owner} onChange={(e) => set(i, { owner: e.target.value })}>
                <option value={ANY_ROLE}>Anyone who takes tasks</option>
                {workers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Before it moves on">
              <div className="flex gap-1">
                <select className="field" value={st.gate} onChange={(e) => set(i, { gate: e.target.value as GateKind, reviewer: undefined })}>
                  {GATES.filter((g) => g !== "pull-request" || (wf.deliverable === "pull-request" && i === draft.length - 1)).map((g) => (
                    <option key={g} value={g}>
                      {GATE_LABEL[g]}
                    </option>
                  ))}
                </select>
                {(st.gate === "review" || st.gate === "approval") && (
                  <select className="field" value={st.reviewer ?? ""} onChange={(e) => set(i, { reviewer: e.target.value || undefined })} aria-label={`Who checks ${st.name}`}>
                    <option value="">Any {st.gate === "review" ? "reviewer" : "approver"}</option>
                    {checkers(st.gate).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </Field>
            <div className="flex gap-1 pb-0.5">
              <button className="btn px-1.5 text-[12px]" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${st.name} up`}>
                ↑
              </button>
              <button className="btn px-1.5 text-[12px]" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${st.name} down`}>
                ↓
              </button>
              <button className="btn px-1.5 text-[12px] text-red" disabled={draft.length === 1} onClick={() => setDraft(draft.filter((_, j) => j !== i))} aria-label={`Remove ${st.name}`}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex items-center gap-2">
        <button className="btn px-2 text-[13px]" disabled={draft.length >= 12} onClick={() => setDraft([...draft, { id: `stage-${draft.length + 1}`, name: `Stage ${draft.length + 1}`, owner: ANY_ROLE, gate: "none" }])}>
          + Stage
        </button>
        <span className="flex-1" />
        {dirty && (
          <>
            <button className="btn px-2 text-[13px]" onClick={() => setDraft(JSON.parse(saved))}>
              Undo changes
            </button>
            <button className="btn px-3 text-[13px]" style={{ background: "#ffec27" }} disabled={draft.some((s) => !s.name.trim())} onClick={() => officeActions.updateWorkflow({ stages: draft })}>
              Save stages
            </button>
          </>
        )}
      </div>
      <p className="mt-2 text-[12px] text-muted">Work in a stage you remove moves to the first stage. Agents learn the new stages the next time they start.</p>
    </section>
  );
}

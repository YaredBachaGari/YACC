// The audit log (plan step 7.1): who did what. Read from this machine; filter, search, download.

import { useCallback, useEffect, useState } from "react";
import { AUDIT_KINDS, actorName, auditCsv, type AuditEntry, type AuditKind } from "../../data/audit";
import { officeActions, useOffice } from "../../store/office";
import { Field, SectionTitle } from "../kit";

const PAGE = 100;

export function AuditSettings() {
  const cfg = useOffice((s) => s.snap?.config);
  const [kind, setKind] = useState<AuditKind | "">("");
  const [actor, setActor] = useState("");
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const query = useCallback(
    async (before?: string) => {
      setLoading(true);
      try {
        const r = await officeActions.readAudit({ kind: kind || undefined, actor: actor || undefined, text: text.trim() || undefined, before, limit: PAGE });
        setEntries((old) => (before ? [...old, ...r.entries] : r.entries));
        setMore(r.more);
      } finally {
        setLoading(false);
      }
    },
    [kind, actor, text],
  );
  useEffect(() => {
    const t = setTimeout(() => void query(), text ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, text]);
  if (!cfg) return null;
  const download = () => {
    const blob = new Blob([auditCsv(entries, cfg)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `yacc-audit-${cfg.project.id}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const label = (k: AuditKind) => AUDIT_KINDS.find((x) => x.id === k)?.label ?? k;
  return (
    <div className="flex flex-col gap-4">
      <section>
        <SectionTitle>Audit log</SectionTitle>
        <p className="m-0 text-[13px] text-muted">
          Who did what: assignments, reviews and your approvals, website access, hires and removals, keys set or removed (never their values), budgets, schedules, templates and every settings change, with what changed. Kept on this computer only, in <code>~/.yacc/{cfg.project.id}/audit/</code>, one file per month.
        </p>
      </section>
      <div className="grid grid-cols-[180px_200px_1fr_auto] items-end gap-2.5">
        <Field label="Kind">
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as AuditKind | "")}>
            <option value="">Everything</option>
            {AUDIT_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Who">
          <select className="field" value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">Anyone</option>
            <option value="you">{cfg.ceo.name} (you)</option>
            <option value="hq">HQ</option>
            <option value="config.yml">config.yml, edited by hand</option>
            {cfg.team.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search">
          <input className="field" value={text} placeholder="A task, an agent, a domain…" onChange={(e) => setText(e.target.value)} />
        </Field>
        <button className="btn px-2 text-[13px]" disabled={!entries.length} onClick={download} title="The entries shown, as a spreadsheet">
          Download CSV
        </button>
      </div>
      <table className="w-full border-collapse border-[3px] border-ink bg-white text-[13px]" aria-label="Audit entries">
        <thead>
          <tr className="bg-cream-2 text-left">
            <th className="w-[150px] px-2 py-1">When</th>
            <th className="w-[150px] px-2 py-1">Who</th>
            <th className="w-[120px] px-2 py-1">Kind</th>
            <th className="px-2 py-1">What</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={`${e.at}-${i}`} className="border-t-2 border-dashed border-cream-3 align-top">
              <td className="px-2 py-1 font-term text-[15px]" title={e.at}>
                {new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </td>
              <td className="px-2 py-1">{actorName(e.actor, cfg)}</td>
              <td className="px-2 py-1">
                <span className="chip">{label(e.kind)}</span>
              </td>
              <td className="break-words px-2 py-1">{e.summary}</td>
            </tr>
          ))}
          {!entries.length && (
            <tr>
              <td colSpan={4} className="px-2 py-3 text-muted">
                {loading ? "Loading…" : "Nothing recorded yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {more && (
        <button className="btn self-start px-2 text-[13px]" disabled={loading} onClick={() => void query(entries[entries.length - 1]?.at)}>
          Older entries
        </button>
      )}
    </div>
  );
}

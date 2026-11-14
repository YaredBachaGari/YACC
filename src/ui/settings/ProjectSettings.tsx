import { useState } from "react";
import { DEFAULT_OFFICE_NAME, OFFICE_NAME_MAX } from "../../data/names";
import { FONT_STYLES, savedFont, setFont, type FontStyle } from "../../theme/fonts";
import { officeActions, useOffice } from "../../store/office";
import { ui, useUi, type OfficeStyle } from "../../store/ui";
import { Field, SectionTitle } from "../kit";
import { CommitInput, Toggle } from "./controls";

function OfficeStylePicker() {
  const style = useUi((s) => s.officeStyle);
  return (
    <section className="border-[3px] border-ink bg-white p-3">
      <SectionTitle>Office style</SectionTitle>
      <Field label="How the office is drawn" hint="Saved in this browser only.">
        <select className="field w-[320px]" value={style} onChange={(e) => ui.setOfficeStyle(e.target.value as OfficeStyle)}>
          <option value="modern">Modern: everyone at their own desk</option>
          <option value="classic">Classic: pixel office with walking robots and the PR belt</option>
        </select>
      </Field>
    </section>
  );
}

function FontPicker() {
  const [font, setCurrent] = useState(savedFont);
  return (
    <section className="border-[3px] border-ink bg-white p-3">
      <SectionTitle>Font</SectionTitle>
      <Field label="Font style" hint="For panels, drawers, settings and agent terminals. The classic office stays pixel. Saved in this browser only.">
        <select
          className="field w-[320px]"
          value={font}
          onChange={(e) => {
            const f = e.target.value as FontStyle;
            setFont(f);
            setCurrent(f);
          }}
        >
          {FONT_STYLES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} · {f.hint}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}

export function ProjectSettings() {
  const project = useOffice((s) => s.snap?.config.project);
  if (!project) return null;
  return (
    <div className="flex flex-col gap-5">
      <SaveTemplate />
      <OfficeStylePicker />
      <FontPicker />
      <section className="grid grid-cols-2 gap-3 border-[3px] border-ink bg-white p-3">
        <div className="col-span-2">
          <SectionTitle>Project</SectionTitle>
        </div>
        <Field label="Name">
          <CommitInput className="field" value={project.name} onCommit={(v) => v.trim() && officeActions.updateProject({ name: v.trim() })} />
        </Field>
        <Field label="Office name" hint={`The sign on the office wall. Up to ${OFFICE_NAME_MAX} characters; letters and numbers read best.`}>
          <CommitInput
            className="field"
            maxLength={OFFICE_NAME_MAX}
            value={project.officeName ?? ""}
            placeholder={DEFAULT_OFFICE_NAME}
            onCommit={(v) => officeActions.updateProject({ officeName: v.trim() })}
          />
        </Field>
        <Field label="GitHub repo" hint="owner/name. HQ only reads PRs, checks and comments.">
          <CommitInput className="field font-term text-[17px]" value={project.repo} onCommit={(v) => v.trim() && officeActions.updateProject({ repo: v.trim() })} />
        </Field>
        <Field label="Local path">
          <CommitInput className="field font-term text-[17px]" value={project.path} onCommit={(v) => v.trim() && officeActions.updateProject({ path: v.trim() })} />
        </Field>
        <Field label="HQ port" hint="Sandboxes reach HQ at host.docker.internal on this port.">
          <CommitInput
            className="field font-term text-[17px]"
            value={String(project.hqPort)}
            onCommit={(v) => {
              const n = Number(v);
              if (Number.isInteger(n) && n > 1023 && n < 65536) officeActions.updateProject({ hqPort: n });
            }}
          />
        </Field>
      </section>
      <section>
        <SectionTitle>Plan</SectionTitle>
        <Toggle checked={!!project.exportPlan} onChange={(v) => officeActions.updateProject({ exportPlan: v })} label="Export plan to docs/plan.md" />
        <p className="mt-1 text-[13px] text-muted">
          HQ keeps the plan in .yacc/plan.json. With this on, it also writes a readable copy to docs/plan.md every time the plan changes, so you can commit it or read it on GitHub. Edits to that file are overwritten.
        </p>
      </section>
      <section className="text-[13px] text-muted">
        <SectionTitle>Security</SectionTitle>
        <ul className="list-disc pl-5">
          <li>HQ binds 127.0.0.1 only.</li>
          <li>A random token is created on every start. The browser, hooks and the Team MCP must send it.</li>
          <li>HQ never reads .env files. Sandboxes get keys from Docker's secret store.</li>
        </ul>
      </section>
    </div>
  );
}

/** Save this setup (roles, team, workflow, autonomy, brief) as a template for new projects. */
function SaveTemplate() {
  const live = useOffice((s) => s.live);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [where, setWhere] = useState<"project" | "user">("user");
  const [saved, setSaved] = useState(false);
  return (
    <section className="border-[3px] border-ink bg-white p-3">
      <SectionTitle>Save as a template</SectionTitle>
      <p className="mb-2 text-[13px] text-muted">
        Saves the roles, the team (not temporary hires), the workflow, autonomy and the brief, so a new project can start from them. No secrets, sandboxes or tasks are saved.
      </p>
      <div className="grid grid-cols-[1fr_1.4fr_200px_auto] items-end gap-2">
        <Field label="Name">
          <input className="field" value={name} maxLength={60} placeholder="My studio" onChange={(e) => (setName(e.target.value), setSaved(false))} />
        </Field>
        <Field label="Description">
          <input className="field" value={description} maxLength={300} placeholder="What this team is for" onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Where">
          <select className="field" value={where} onChange={(e) => setWhere(e.target.value as "project" | "user")}>
            <option value="user">On this machine</option>
            <option value="project">In this project</option>
          </select>
        </Field>
        <button
          className="btn"
          disabled={!live || !name.trim()}
          onClick={() => {
            officeActions.saveTemplate(name.trim(), where, description.trim());
            setSaved(true);
          }}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      <p className="mt-1 text-[12px] text-muted">
        {where === "user" ? "In ~/.yacc/templates/: offered when you set up any project on this machine." : "In .yacc/templates/ in this repo: commit it to share it with your team."}
      </p>
    </section>
  );
}

// Templates (plan step 7.3): the ones you have, sharing one as a file, and installing one from a
// file, a link or the gallery, always after a preview of what it adds.

import { useEffect, useState } from "react";
import { BUNDLE_EXTENSION, bundleFileName, type GalleryEntry, type TemplatePreview } from "../../data/templateBundle";
import { BUILT_IN_TEMPLATES, type Template } from "../../data/templates";
import { officeActions, useOffice } from "../../store/office";
import { ui } from "../../store/ui";
import { SectionTitle } from "../kit";

const SOURCE: Record<Template["source"], string> = { "built-in": "Built in", project: "This project", user: "Yours" };

export function TemplatesSettings() {
  const templates = useOffice((s) => s.snap?.templates) ?? BUILT_IN_TEMPLATES;
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const download = async (t: Template) => {
    const b = await officeActions.exportTemplate(t.id);
    if ("error" in b) return setError(b.error);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }));
    a.download = bundleFileName(t.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>Templates · {templates.length}</SectionTitle>
        <p className="mb-3 text-[13px] text-muted">
          A template is a team to start from: roles, people, workflow, toolkits, skills and schedules. Share one as a single <code>{BUNDLE_EXTENSION}</code> file, or install one someone shared. Save your current setup as a template in{" "}
          <button className="underline" onClick={() => ui.openSettings("project")}>
            Settings → Project
          </button>
          .
        </p>
        {error && (
          <p role="alert" className="mb-2 text-[13px] text-red">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-start gap-2 border-[3px] border-ink bg-white p-2.5" data-template={t.id}>
              <div className="min-w-0 flex-1">
                <b className="text-[15px]">{t.name}</b> <span className="chip text-[10px]">{SOURCE[t.source]}</span>
                <div className="text-[13px] text-muted">{t.description}</div>
              </div>
              <button className="btn px-2 text-[12px]" onClick={() => void download(t)} title="Download it as one file to share">
                Export
              </button>
              {t.source !== "built-in" &&
                (removing === t.id ? (
                  <span className="flex items-center gap-1 text-[12px]">
                    Delete it?
                    <button
                      className="btn px-1.5 text-[12px] text-red"
                      onClick={async () => {
                        const r = await officeActions.deleteTemplate(t.id);
                        setError(r.error ?? "");
                        setRemoving(null);
                      }}
                    >
                      Delete
                    </button>
                    <button className="btn px-1.5 text-[12px]" onClick={() => setRemoving(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button className="btn px-2 text-[12px] text-red" onClick={() => setRemoving(t.id)}>
                    Delete
                  </button>
                ))}
            </div>
          ))}
        </div>
      </section>
      <section>
        <SectionTitle>Install a template</SectionTitle>
        <TemplateImport />
      </section>
    </div>
  );
}

type Source = { kind: "file"; bundle: unknown; label: string } | { kind: "url"; url: string; label: string };

/** Pick a template from a file, a link or the gallery; see what it adds; install it. */
export function TemplateImport({ onInstalled }: { onInstalled?: (id: string) => void }) {
  const live = useOffice((s) => s.live);
  const [tab, setTab] = useState<"gallery" | "file" | "url">("gallery");
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [gallery, setGallery] = useState<GalleryEntry[] | null>(null);
  const [galleryError, setGalleryError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    if (tab !== "gallery" || gallery) return;
    void officeActions.readGallery().then((r) => {
      setGallery(r.templates ?? []);
      setGalleryError(r.error ?? "");
    });
  }, [tab, gallery]);

  const look = async (src: Source) => {
    setSource(src);
    setPreview(null);
    setError("");
    setDone("");
    setBusy(true);
    const r = await officeActions.previewTemplate(src.kind === "file" ? { bundle: src.bundle } : { url: src.url });
    setBusy(false);
    if (r.error) setError(r.error);
    else setPreview(r.preview ?? null);
  };
  const install = async (where: "project" | "user") => {
    if (!source) return;
    setBusy(true);
    const r = await officeActions.importTemplate(source.kind === "file" ? { bundle: source.bundle } : { url: source.url }, where);
    setBusy(false);
    if (r.error || !r.id) return setError(r.error ?? "It wasn't installed.");
    setDone(`Installed "${r.name}" ${where === "project" ? "in this project" : "for you on this machine"}.`);
    setPreview(null);
    setSource(null);
    onInstalled?.(r.id);
  };
  const readFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      await look({ kind: "file", bundle: JSON.parse(await f.text()) as unknown, label: f.name });
    } catch {
      setError(`${f.name} isn't a template file (it isn't JSON).`);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-[3px] border-ink bg-cream p-3" aria-label="Install a template">
      <div className="flex gap-1.5" role="tablist">
        {(["gallery", "file", "url"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} className="btn px-2 text-[13px]" onClick={() => setTab(t)}>
            {t === "gallery" ? "Gallery" : t === "file" ? "From a file" : "From a link"}
          </button>
        ))}
      </div>
      {tab === "gallery" && (
        <div className="flex flex-col gap-1.5">
          {!gallery && <span className="text-[13px] text-muted">Loading the gallery…</span>}
          {galleryError && <span className="text-[13px] text-red">The gallery couldn't be read: {galleryError}</span>}
          {gallery?.map((g) => (
            <div key={g.url} className="flex items-start gap-2 border-2 border-ink bg-white px-2 py-1.5" data-gallery={g.id}>
              <div className="min-w-0 flex-1">
                <b className="text-[14px]">{g.name}</b>
                {g.tags?.map((t) => (
                  <span key={t} className="chip ml-1 text-[10px]">
                    {t}
                  </span>
                ))}
                <div className="text-[12px] text-muted">{g.description}</div>
              </div>
              <button className="btn px-2 text-[12px]" disabled={busy} onClick={() => void look({ kind: "url", url: g.url, label: g.name })}>
                Preview
              </button>
            </div>
          ))}
          {gallery && !gallery.length && !galleryError && <span className="text-[13px] text-muted">The gallery is empty.</span>}
        </div>
      )}
      {tab === "file" && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="file" accept=".json,application/json" onChange={(e) => void readFile(e.target.files?.[0])} aria-label="Template file" />
          <span className="text-muted">A {BUNDLE_EXTENSION} file someone shared with you.</span>
        </label>
      )}
      {tab === "url" && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void look({ kind: "url", url: url.trim(), label: url.trim() });
          }}
        >
          <input className="field min-w-0 flex-1" value={url} placeholder="https://github.com/…/team.yacc-template.json" aria-label="Template link" onChange={(e) => setUrl(e.target.value)} />
          <button className="btn px-2 text-[13px]" type="submit" disabled={!url.trim() || busy || !live} title={live ? undefined : "The demo can't fetch links"}>
            Preview
          </button>
        </form>
      )}
      {busy && <span className="text-[13px] text-muted">Checking…</span>}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-red">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="m-0 text-[13px]" style={{ color: "#00873a" }}>
          {done}
        </p>
      )}
      {preview && source && <PreviewCard preview={preview} from={source.label} busy={busy} onInstall={install} onCancel={() => (setPreview(null), setSource(null))} />}
    </div>
  );
}

function PreviewCard({ preview: p, from, busy, onInstall, onCancel }: { preview: TemplatePreview; from: string; busy: boolean; onInstall: (where: "project" | "user") => void; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-1.5 border-[3px] border-ink bg-white p-3 text-[13px]" aria-label={`Preview of ${p.name}`}>
      <div>
        <b className="text-[16px]">{p.name}</b> <span className="text-muted">from {from}</span>
      </div>
      <div className="text-muted">{p.description}</div>
      <div>
        <b>Team:</b> {p.team.map((a) => `${a.name} (${a.role})`).join(", ")}
      </div>
      <div>
        <b>Roles:</b> {p.roles.map((r) => `${r.title}${r.can.length ? ` [${r.can.join(", ")}]` : ""}`).join("; ")}
      </div>
      <div>
        <b>Work:</b> {p.stages.join(" → ")} · one unit is a {p.item.toLowerCase()} · {p.deliverable === "pull-request" ? "pull requests" : "files"}
      </div>
      {p.toolkits.length > 0 && (
        <div>
          <b>Toolkits:</b> {p.toolkits.join(", ")}
        </div>
      )}
      {p.skills.length > 0 && (
        <div>
          <b>Skills:</b> {p.skills.join(", ")}
        </div>
      )}
      {p.schedules.length > 0 && (
        <div>
          <b>Schedules (off):</b> {p.schedules.join("; ")}
        </div>
      )}
      {p.notes.length > 0 && (
        <ul className="m-0 list-disc pl-5 text-[12px]">
          {p.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex flex-wrap gap-2">
        <button className="btn px-2 text-[13px]" style={{ background: "#ffec27" }} disabled={busy} onClick={() => onInstall("user")}>
          Install for me
        </button>
        <button className="btn px-2 text-[13px]" disabled={busy} onClick={() => onInstall("project")} title="In .yacc/templates/: commit it to share it with your team">
          Install in this project
        </button>
        <button className="btn px-2 text-[13px]" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

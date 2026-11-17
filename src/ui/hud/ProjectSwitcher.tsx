// The project switcher (plan step 7.2): every repo you've run YACC in on this computer. Opening
// one goes to its HQ, starting it first if it isn't running. Add a project by its folder.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectEntry } from "../../data/projects";
import { officeActions, useOffice } from "../../store/office";

export function ProjectSwitcher() {
  const project = useOffice((s) => s.snap?.config.project);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ProjectEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [path, setPath] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: 16, top: 64 });

  useEffect(() => {
    if (!open) return;
    setError("");
    void officeActions.listProjects().then((r) => {
      setList(r.projects ?? []);
      if (r.error) setError(r.error);
    });
    const r = box.current?.getBoundingClientRect();
    if (r)
      setAt({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 452)),
        top: r.bottom + 14,
      });
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!project) return null;

  const go = async (ref: { slug?: string; root?: string }, label: string) => {
    setBusy(label);
    setError("");
    const r = await officeActions.openProject(ref);
    setBusy(null);
    if (r.error || !r.url) return setError(r.error ?? "It didn't open.");
    window.location.href = r.url;
  };
  const forget = async (slug: string) => {
    const r = await officeActions.forgetProject(slug);
    if (r.error) setError(r.error);
    else setList(r.projects ?? []);
  };

  return (
    <div ref={box} className="relative min-w-0">
      <button
        className="flex min-w-0 max-w-[340px] items-baseline gap-1.5 text-[16px] text-muted"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Switch project"
      >
        <span aria-hidden>—</span>
        <em className="min-w-0 truncate font-semibold not-italic text-ink">{project.name}</em>
        <span className="hidden min-w-0 truncate font-term text-[17px] 2xl:inline">{project.repo}</span>
        <span aria-hidden className="text-ink">
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="panel fixed z-50 flex w-[440px] flex-col gap-2 p-3" style={at} role="dialog" aria-label="Projects">
            <b className="text-[15px]">Projects on this computer</b>
            {!list && <span className="text-[13px] text-muted">Looking…</span>}
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {list?.map((p) => (
                <li
                  key={p.slug}
                  className={`flex items-center gap-2 border-2 border-ink px-2 py-1 ${p.current ? "bg-[#fff6d6]" : "bg-white"}`}
                  data-project={p.slug}
                >
                  <i
                    className="inline-block h-2.5 w-2.5 shrink-0 border-2 border-ink"
                    style={{ background: p.running ? "#00e436" : "#c2c3c7" }}
                    title={p.running ? "Running" : "Stopped"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{p.name}</div>
                    <div className="truncate font-term text-[14px] text-muted" title={p.root}>
                      {p.missing ? "folder missing · " : ""}
                      {p.root}
                    </div>
                  </div>
                  {p.current ? (
                    <span className="text-[12px] text-muted">You're here</span>
                  ) : (
                    <>
                      <button className="btn px-2 text-[12px]" disabled={!!busy || p.missing} onClick={() => void go({ slug: p.slug }, p.slug)}>
                        {busy === p.slug ? (p.running ? "Opening…" : "Starting…") : p.running ? "Open" : "Start & open"}
                      </button>
                      {!p.running && (
                        <button className="text-[12px] text-red underline" onClick={() => void forget(p.slug)} title="Take it off this list (its files stay)">
                          Remove
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (path.trim()) void go({ root: path.trim() }, "new");
              }}
            >
              <input
                className="field min-w-0 flex-1 font-term text-[15px]"
                value={path}
                placeholder="~/projects/another-repo"
                aria-label="Folder of another project"
                onChange={(e) => setPath(e.target.value)}
              />
              <button className="btn px-2 text-[12px]" type="submit" disabled={!path.trim() || !!busy}>
                {busy === "new" ? "Starting…" : "Add & open"}
              </button>
            </form>
            <span className="text-[11px] text-muted">
              A project is a git repository. Each runs its own HQ; a stopped one starts in the background when you open it.
            </span>
            {error && (
              <p role="alert" className="m-0 text-[12px] text-red">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

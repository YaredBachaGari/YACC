// Schedules (plan step 6.5): work that starts on its own, on a clock or when something happens.

import { useState } from "react";
import { channelsOf } from "../../data/messaging";
import { DAYS, EVENTS, MAX_SCHEDULES, REPEATS, describeWhat, describeWhen, type RepeatEvery, type Schedule, type ScheduleEvent } from "../../data/schedules";
import type { HqConfig } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { ago, Field, SectionTitle, useNow } from "../kit";
import { Toggle } from "./controls";

const blank = (): Schedule => ({ id: "", name: "", enabled: true, every: "weekday", at: "09:00", action: "message", to: "lead", text: "" });

export function SchedulesSettings() {
  const cfg = useOffice((s) => s.snap?.config);
  const statuses = useOffice((s) => s.snap?.schedules) ?? [];
  const now = useNow(30_000);
  const [editing, setEditing] = useState<{ index: number; draft: Schedule } | null>(null);
  if (!cfg) return null;
  const list = cfg.schedules ?? [];
  const save = (next: Schedule[]) => officeActions.updateSchedules(next);
  const status = (id: string) => statuses.find((x) => x.id === id);
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <SectionTitle>Schedules · {list.length}</SectionTitle>
          <span className="flex-1" />
          <button className="btn px-2 text-[13px]" disabled={!!editing || list.length >= MAX_SCHEDULES} onClick={() => setEditing({ index: -1, draft: blank() })}>
            + Schedule
          </button>
        </div>
        <p className="mb-3 text-[13px] text-muted">
          Work that starts on its own: a weekly report, a daily content run, a follow-up whenever a piece is done. Each one sends a message or adds a task. Times are this computer's; a time missed while HQ was closed runs once when it's back. Saved in <code>.yacc/config.yml</code>.
        </p>
        {editing && (
          <ScheduleEditor
            cfg={cfg}
            draft={editing.draft}
            onCancel={() => setEditing(null)}
            onSave={(s) => {
              save(editing.index < 0 ? [...list, s] : list.map((x, i) => (i === editing.index ? s : x)));
              setEditing(null);
            }}
          />
        )}
        <div className="flex flex-col gap-2">
          {list.map((s, i) => {
            const st = status(s.id);
            return (
              <div key={s.id} className={`flex flex-col gap-1 border-[3px] border-ink p-2.5 ${s.enabled ? "bg-white" : "bg-cream"}`} data-schedule={s.id}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <b className="text-[15px]">{s.name}</b>
                    <div className="text-[13px]">
                      {describeWhen(s)} → {describeWhat(s, cfg)}
                    </div>
                    <div className="text-[12px] text-muted">
                      {s.enabled && st?.nextRun ? `Next: ${when(st.nextRun)}. ` : ""}
                      {st?.lastRun ? `Last ran ${ago(st.lastRun, now)}: ${st.lastResult ?? ""}` : "Hasn't run yet."}
                    </div>
                  </div>
                  <Toggle checked={s.enabled} label={s.enabled ? "On" : "Off"} onChange={(on) => save(list.map((x, j) => (j === i ? { ...x, enabled: on } : x)))} />
                  <button className="btn px-2 text-[12px]" onClick={() => officeActions.runSchedule(s.id)} title="Run it now, whatever its time">
                    Run now
                  </button>
                  <button className="btn px-2 text-[12px]" disabled={!!editing} onClick={() => setEditing({ index: i, draft: structuredClone(s) })}>
                    Edit
                  </button>
                  <button className="btn px-2 text-[12px] text-red" onClick={() => save(list.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          {!list.length && !editing && <p className="m-0 text-[13px] text-muted">No schedules yet.</p>}
        </div>
      </section>
    </div>
  );
}

function ScheduleEditor({ cfg, draft: initial, onSave, onCancel }: { cfg: HqConfig; draft: Schedule; onSave: (s: Schedule) => void; onCancel: () => void }) {
  const [d, setD] = useState<Schedule>(initial);
  const set = (patch: Partial<Schedule>) => setD((x) => ({ ...x, ...patch }));
  const clock = !d.on;
  const vars = ["date", ...(d.on ? (EVENTS.find((e) => e.id === d.on)?.vars ?? []) : [])].map((v) => `{${v}}`).join(" ");
  const workers = cfg.team.filter((a) => !a.isLead);
  const ready = d.name.trim() && (d.action === "message" ? d.text.trim() : d.title?.trim());
  return (
    <div className="mb-3 flex flex-col gap-3 border-[3px] border-ink bg-cream p-3" aria-label={initial.id ? `Edit ${initial.name}` : "New schedule"}>
      <div className="grid grid-cols-[1fr_200px] gap-3">
        <Field label="Name">
          <input className="field" value={d.name} maxLength={60} placeholder="Weekly report" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Starts">
          <select className="field" value={clock ? "clock" : "event"} onChange={(e) => (e.target.value === "clock" ? set({ on: undefined, every: d.every ?? "weekday", at: d.at ?? "09:00" }) : set({ on: "task-done", every: undefined }))}>
            <option value="clock">On a clock</option>
            <option value="event">When something happens</option>
          </select>
        </Field>
      </div>
      {clock ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="How often">
            <select className="field" value={d.every} onChange={(e) => set({ every: e.target.value as RepeatEvery, day: e.target.value === "week" ? 1 : e.target.value === "month" ? 1 : undefined })}>
              {REPEATS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          {d.every === "week" && (
            <Field label="On">
              <select className="field" value={d.day ?? 1} onChange={(e) => set({ day: Number(e.target.value) })}>
                {DAYS.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {d.every === "month" && (
            <Field label="On day">
              <select className="field" value={d.day ?? 1} onChange={(e) => set({ day: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={d.every === "hour" ? "Minutes past" : "At"} hint={d.every === "hour" ? "Only the minutes count." : "This computer's time."}>
            <input className="field" type="time" value={d.at ?? "09:00"} onChange={(e) => set({ at: e.target.value || "09:00" })} />
          </Field>
        </div>
      ) : (
        <Field label="When">
          <select className="field" value={d.on} onChange={(e) => set({ on: e.target.value as ScheduleEvent })}>
            {EVENTS.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-[200px_1fr] gap-3">
        <Field label="Then">
          <select className="field" value={d.action} onChange={(e) => set(e.target.value === "task" ? { action: "task", to: undefined, title: d.title ?? "" } : { action: "message", to: "lead" })}>
            <option value="message">Send a message</option>
            <option value="task">Add a task</option>
          </select>
        </Field>
        {d.action === "message" ? (
          <Field label="To">
            <select className="field" value={d.to ?? "lead"} onChange={(e) => set({ to: e.target.value })}>
              <option value="lead">The lead</option>
              {workers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role})
                </option>
              ))}
              {channelsOf(cfg).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} ({c.roleId ? `everyone who's a ${c.name}` : "everyone"})
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="For">
            <select className="field" value={d.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })}>
              <option value="">The lead assigns it</option>
              {cfg.roles
                .filter((r) => r.can.includes("work"))
                .map((r) => (
                  <option key={r.id} value={`role:${r.id}`}>
                    Someone with the {r.title} role
                  </option>
                ))}
              {workers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role})
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {d.action === "task" && (
        <Field label="Task title">
          <input className="field" value={d.title ?? ""} maxLength={120} placeholder="Weekly report for {date}" onChange={(e) => set({ title: e.target.value })} />
        </Field>
      )}
      <Field label={d.action === "message" ? "Message" : "Task description"} hint={`Filled in when it runs: ${vars}.`}>
        <textarea
          className="field h-[80px] resize-y"
          maxLength={2000}
          value={d.text}
          placeholder={d.action === "message" ? "Compile this week's progress into a report_to_ceo briefing: what's done, what's next, any blockers." : "What to do and what done looks like."}
          onChange={(e) => set({ text: e.target.value })}
        />
      </Field>
      <div className="flex gap-2">
        <button className="btn px-3 text-[13px]" style={{ background: "#ffec27" }} disabled={!ready} onClick={() => onSave({ ...d, name: d.name.trim() })}>
          {initial.id ? "Save schedule" : "Add schedule"}
        </button>
        <button className="btn px-2 text-[13px]" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

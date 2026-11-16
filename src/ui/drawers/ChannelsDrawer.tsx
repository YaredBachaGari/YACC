// Channels (plan step 6.4): #team and one per role. Read what's been posted and post as yourself.

import { useState } from "react";
import { channelMembers, channelsOf, TEAM_CHANNEL } from "../../data/messaging";
import { HUMAN_ID } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { ui } from "../../store/ui";
import { ago, Dot, Portrait, useNow } from "../kit";
import { DrawerHeader } from "./Drawer";

export function ChannelsDrawer({ channel }: { channel?: string }) {
  const snap = useOffice((s) => s.snap);
  const now = useNow(10_000);
  const [draft, setDraft] = useState("");
  if (!snap) return null;
  const channels = channelsOf(snap.config);
  const current = channels.find((c) => c.id === channel) ?? channels[0];
  const members = channelMembers(snap.config, current.id).flatMap((id) => snap.config.team.find((a) => a.id === id) ?? []);
  const posts = snap.messages.filter((m) => m.toId === current.id);
  const count = (id: string) => snap.messages.filter((m) => m.toId === id).length;
  const who = (id: string) => (id === HUMAN_ID ? { name: "You", color: "#ffec27" } : id === "hq" ? { name: "HQ", color: "#3ee0d0" } : snap.config.team.find((a) => a.id === id));
  const send = () => {
    if (!draft.trim()) return;
    officeActions.sendMessage(current.id, draft.trim());
    setDraft("");
  };
  return (
    <>
      <DrawerHeader>
        <b className="text-[18px]">Channels</b>
        <span className="text-[13px] text-muted">Posts reach everyone in the channel</span>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1">
        <nav className="scroll-thin flex w-[150px] shrink-0 flex-col gap-1 overflow-y-auto border-r-[3px] border-ink bg-cream-2 p-2" aria-label="Channels">
          {channels.map((c) => (
            <button key={c.id} className="btn block px-2 py-0.5 text-left text-[13px]" aria-pressed={c.id === current.id} onClick={() => ui.openChannels(c.id)}>
              <span className="font-term text-[15px]">{c.id}</span>
              {count(c.id) > 0 && <span className="text-muted"> · {count(c.id)}</span>}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b-2 border-dashed border-cream-3 px-3 py-1.5">
            <span className="mr-1 text-[13px] text-muted">{current.id === TEAM_CHANNEL ? "Everyone" : current.name} · {members.length}</span>
            {members.slice(0, 10).map((a) => (
              <span key={a.id} title={a.name}>
                <Portrait color={a.color} lead={a.isLead} size={20} who={a} forceFace />
              </span>
            ))}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
            {posts.length === 0 && <p className="text-[14px] text-muted">Nothing posted in {current.id} yet.</p>}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {posts.map((m) => {
                const from = who(m.fromId);
                return (
                  <li key={m.id} className="border-2 border-ink bg-white px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 text-[13px] text-muted">
                      {from && <Dot color={from.color} size={8} />}
                      {from?.name ?? m.fromId}
                      <span className="ml-auto font-term text-[15px]">{ago(m.at, now)}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-[15px]">{m.text}</div>
                  </li>
                );
              })}
            </ul>
          </div>
          <form
            className="flex gap-2 border-t-[3px] border-ink bg-cream p-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input className="field" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Post to ${current.id}…`} aria-label={`Post to ${current.id}`} />
            <button className="btn" type="submit" disabled={!draft.trim() || !members.length}>
              Post
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

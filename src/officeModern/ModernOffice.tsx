import { useEffect, useRef } from "react";
import { useOffice } from "../store/office";
import { ui, useUi } from "../store/ui";
import { drawCeoOffice, drawDesks, drawLeadArea, drawLounge, drawMeeting, drawMessages, drawShell, setTheme, type Frame } from "./draw";
import { themeOf } from "./themes";
import { photoFor } from "../store/photos";
import { inside, modernLayout, type ModernLayout, type Rect } from "./layout";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;

/** The modern office: drawn on one canvas, redrawn about 30 times a second. Reads the stores; writes only UI state. */
export function ModernOffice() {
  const host = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = host.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const g = canvas.getContext("2d")!;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let layout: ModernLayout | null = null;
    let cam = { x: 0, y: 0, zoom: 1 };
    let target: typeof cam | null = null;
    let userMoved = false;
    let hover: string | null = null;
    let raf = 0;
    let last = 0;
    const start = performance.now();

    // Room around the office for the HUD: team panel, top bar, open drawer.
    const viewport = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const left = w > 900 ? 312 : 16;
      const right = useUi.getState().drawer ? Math.min(552, w * 0.45) : 16;
      return { x: left, y: 74, w: Math.max(200, w - left - right), h: Math.max(200, h - 74 - 16) };
    };
    const fit = () => {
      if (!layout) return cam;
      const v = viewport();
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(v.w / layout.w, v.h / layout.h)));
      return { zoom, x: layout.w / 2 - (v.x + v.w / 2) / zoom, y: layout.h / 2 - (v.y + v.h / 2) / zoom };
    };
    const centreOn = (r: Rect, zoom: number) => {
      const v = viewport();
      target = { zoom, x: r.x + r.w / 2 - (v.x + v.w / 2) / zoom, y: r.y + r.h / 2 - (v.y + v.h / 2) / zoom };
      userMoved = true;
    };
    const toWorld = (sx: number, sy: number) => ({ x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y });

    const relayout = () => {
      const snap = useOffice.getState().snap;
      if (!snap) return;
      const next = modernLayout(snap.config);
      const sizeChanged = !layout || next.w !== layout.w || next.h !== layout.h;
      layout = next;
      if (sizeChanged && !userMoved) cam = fit();
    };

    const hitAt = (sx: number, sy: number): string | null => {
      if (!layout) return null;
      const p = toWorld(sx, sy);
      const snap = useOffice.getState().snap;
      for (const d of layout.desks) if (d.agentId && inside(d.rect, p.x, p.y)) return `agent:${d.agentId}`;
      const lead = snap?.config.team.find((a) => a.isLead);
      if (lead && inside(layout.lead, p.x, p.y)) return `agent:${lead.id}`;
      if (inside(layout.ceo, p.x, p.y)) return "ceo";
      const wb = layout.whiteboard;
      if (inside({ x: wb.x - 8, y: wb.y - 8, w: wb.w + 16, h: wb.h + 16 }, p.x, p.y)) return "plan";
      return null;
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      // ~30 fps is plenty; with reduced motion, a few frames a second for state changes.
      if (now - last < (reducedMotion ? 400 : 33)) return;
      last = now;
      const snap = useOffice.getState().snap;
      if (!snap) return;
      if (!layout || layout.key !== modernLayout(snap.config).key) relayout();
      if (!layout) return;
      if (target) {
        const k = reducedMotion ? 1 : 0.18;
        cam = { x: cam.x + (target.x - cam.x) * k, y: cam.y + (target.y - cam.y) * k, zoom: cam.zoom + (target.zoom - cam.zoom) * k };
        if (Math.abs(target.zoom - cam.zoom) < 0.002 && Math.abs(target.x - cam.x) < 0.5 && Math.abs(target.y - cam.y) < 0.5) {
          cam = target;
          target = null;
        }
      }
      const theme = themeOf(snap.config.project.theme);
      setTheme(theme);
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = theme.outside;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * dpr * cam.zoom, -cam.y * dpr * cam.zoom);
      const f: Frame = { t: (now - start) / 1000, snap, hover, reducedMotion, photo: (a) => photoFor(a) };
      const L = layout;
      // outside the building
      g.fillStyle = theme.outside;
      g.fillRect(-2000, -2000, L.w + 4000, L.h + 4000);
      g.fillStyle = "rgba(43,36,51,0.18)";
      g.beginPath();
      g.roundRect(6, 10, L.w, L.h, 20);
      g.fill();
      g.save();
      g.beginPath();
      g.roundRect(0, 0, L.w, L.h, 20);
      g.clip();
      drawShell(g, L, snap.config.project.officeName || snap.config.project.name || "YACC", f.t);
      drawCeoOffice(g, L, f);
      drawLeadArea(g, L, f);
      drawMeeting(g, L, f);
      drawLounge(g, L);
      drawDesks(g, L, f);
      const lead = snap.config.team.find((a) => a.isLead);
      drawMessages(g, L, f, (id) => {
        if (lead && id === lead.id) return { x: L.leadDesk.cx, y: L.leadDesk.deskY - 70 };
        const d = L.desks.find((x) => x.agentId === id);
        return d ? { x: d.cx, y: d.deskY - 70 } : null;
      });
      g.restore();
    };
    raf = requestAnimationFrame(draw);

    // ------------------------------------------------------------ input
    let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          target = null;
          userMoved = true;
          cam = { ...cam, x: drag.cx - dx / cam.zoom, y: drag.cy - dy / cam.zoom };
        }
        return;
      }
      const r = canvas.getBoundingClientRect();
      hover = hitAt(e.clientX - r.left, e.clientY - r.top);
      canvas.style.cursor = hover ? "pointer" : "grab";
    };
    const onUp = (e: PointerEvent) => {
      const wasDrag = drag?.moved;
      drag = null;
      if (wasDrag) return;
      const r = canvas.getBoundingClientRect();
      const hit = hitAt(e.clientX - r.left, e.clientY - r.top);
      if (!hit) return;
      if (hit.startsWith("agent:")) ui.openAgent(hit.slice(6));
      else if (hit === "ceo") ui.openBriefings();
      else if (hit === "plan") ui.openBoards();
    };
    const zoomAt = (factor: number, sx: number, sy: number) => {
      const before = toWorld(sx, sy);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
      cam = { zoom, x: before.x - sx / zoom, y: before.y - sy / zoom };
      target = null;
      userMoved = true;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    const onDbl = () => {
      userMoved = false;
      target = fit();
    };
    const onLeave = () => (hover = null);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDbl);
    const ro = new ResizeObserver(() => {
      if (!userMoved) cam = fit();
    });
    ro.observe(el);

    // Focus and zoom requests from the HUD (team panel, top bar).
    const unsub = useUi.subscribe((s, prev) => {
      if (!layout) return;
      if (s.drawer !== prev.drawer && !userMoved) target = fit();
      if (s.zoomRequest && s.zoomRequest !== prev.zoomRequest) {
        const v = viewport();
        zoomAt(s.zoomRequest.delta > 0 ? 1.25 : 0.8, v.x + v.w / 2, v.y + v.h / 2);
      }
      if (s.focus && s.focus !== prev.focus) {
        const f = s.focus.target;
        const near = Math.max(cam.zoom, Math.min(1.3, fit().zoom * 1.8));
        if (f.kind === "home") {
          userMoved = false;
          target = fit();
        } else if (f.kind === "agent") {
          const snap = useOffice.getState().snap;
          const isLead = snap?.config.team.find((a) => a.id === f.id)?.isLead;
          const d = layout.desks.find((x) => x.agentId === f.id);
          if (isLead) centreOn(layout.lead, near);
          else if (d) centreOn(d.rect, near);
        } else if (f.kind === "plan") centreOn(layout.meeting, near);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
    };
  }, []);

  return (
    <div ref={host} className="fixed inset-0" role="img" aria-label="The office: everyone at their desk. Click someone to open their panel; drag to move, scroll to zoom, double-click to fit.">
      <canvas ref={canvasRef} className="block h-full w-full" style={{ cursor: "grab", touchAction: "none" }} />
    </div>
  );
}

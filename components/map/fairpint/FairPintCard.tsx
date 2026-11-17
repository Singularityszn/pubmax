"use client";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./fairPint.css";

export type FairPintCounts = { phase: "loading" } | { phase: "failed" } | { phase: "ready"; count: number };
export default function FairPintCard({ start, area, counts, drawCounts, located, locationOff, offline, onInput, onCommit, onLocation, onRetry, onDraw, onClose, drawUnavailable = false, error = "", pending = false }: {
  drawUnavailable?: boolean; error?: string; pending?: boolean;
  start: number; area: string; counts: (pence: number) => FairPintCounts; drawCounts: (pence: number) => FairPintCounts;
  located: boolean; locationOff: boolean; offline: boolean;
  onInput: (pence: number) => void; onCommit: (pence: number) => void; onLocation: () => void;
  onRetry: () => void; onDraw: (pence: number) => void; onClose: () => void;
}) {
  const [pence, setPence] = useState(start);
  const [announcement, setAnnouncement] = useState("");
  const held = useRef(start);
  const dirty = useRef(false);
  const count = counts(pence), draw = drawCounts(pence);
  const figure = `£${(pence / 100).toFixed(2)}`;
  const geography = located ? "within 800 m" : "in view";
  const line = offline ? "You're offline. Prices on screen may be old." : count.phase === "failed" || draw.phase === "failed" ? "Could not load prices. Try again." : count.phase === "loading" ? "Loading prices…" : count.count === 0
    ? `No pubs ${geography} list a pint at ${figure} or less.${located ? " Raise it." : " Move the map or raise it."}`
    : `${count.count} pubs ${geography} list a pint at ${figure} or less.`;
  const reason = draw.phase === "loading" ? `Checking prices in ${area}…` : draw.phase === "ready" && draw.count < 3 ? `Fewer than 3 pubs in ${area} list a pint at ${figure} or less.` : "";
  const input = (value: number) => { dirty.current = true; setPence(value); onInput(value); };
  const release = () => {
    if (!dirty.current) return;
    dirty.current = false; held.current = pence; onCommit(pence); setAnnouncement(line);
  };
  return <aside className="fairPintCard" aria-label="Your fair pint">
    <h2>What&apos;s a fair pint to you?</h2>
    <output className="fairPintFigure" aria-live="off">{figure}</output>
    <input className="fairPintRange" type="range" aria-label="Fair pint price" min={300} max={800} step={10} value={pence}
      aria-valuetext={`${figure}, ${count.phase === "ready" ? `${count.count} pubs ${located ? "within 800 metres" : "in view"}` : "loading prices"}`}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onInput={(event) => input(event.currentTarget.valueAsNumber)} onPointerUp={release} onKeyUp={release}
      onPointerCancel={() => { dirty.current = false; setPence(held.current); onInput(held.current); }}
      onBlur={() => { if (dirty.current) { dirty.current = false; setPence(held.current); onInput(held.current); } }}
      onKeyDown={(event) => { if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); input(Math.min(800, Math.max(300, pence + (event.key === "PageUp" ? 50 : -50)))); } }} />
    <p className="fairPintCount" aria-hidden="true">{line}</p>
    <span className="sr-only" aria-live="polite">{announcement}</span>
    {count.phase === "failed" || draw.phase === "failed" ? <Button variant="ghost" onClick={onRetry}>Retry</Button> : null}
    <Button variant="ghost" onClick={onLocation}>{locationOff ? "Location is off" : "Use my location"}</Button>
    {error ? <p role="alert">{error}</p> : null}{pending ? <p role="status">Drawing your night…</p> : null}
    <Button aria-busy={pending} onClick={() => onDraw(pence)} disabled={drawUnavailable || offline || draw.phase !== "ready" || draw.count < 3}>Draw my night in {area}</Button>
    {reason ? <p className="fairPintReason">{reason}</p> : null}
    <Button className="fairPintClose" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></Button>
  </aside>;
}

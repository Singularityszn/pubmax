"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import FairPintFrame, { FAIR_PINT_LOADING_LINE } from "./FairPintFrame";

export type FairPintCounts = { phase: "loading" } | { phase: "failed" } | { phase: "ready"; count: number };
export default function FairPintCard({
  start,
  area,
  counts,
  drawCounts,
  located,
  locationOff,
  offline,
  onInput,
  onCommit,
  onLocation,
  onRetry,
  onDraw,
  onClose,
  drawUnavailable = false,
  error = "",
  pending = false,
}: {
  drawUnavailable?: boolean;
  error?: string;
  pending?: boolean;
  start: number;
  area: string;
  counts: (pence: number) => FairPintCounts;
  drawCounts: (pence: number) => FairPintCounts;
  located: boolean;
  locationOff: boolean;
  offline: boolean;
  onInput: (pence: number) => void;
  onCommit: (pence: number) => void;
  onLocation: () => void;
  onRetry: () => void;
  onDraw: (pence: number) => void;
  onClose: () => void;
}) {
  const [pence, setPence] = useState(start);
  const [announcement, setAnnouncement] = useState("");
  const slider = useRef<HTMLInputElement>(null);
  const currentPence = useRef(start);
  const nativeRelease = useRef(() => {});
  const held = useRef(start);
  useEffect(() => {
    const node = slider.current;
    const change = () => nativeRelease.current();
    node?.addEventListener("change", change);
    return () => node?.removeEventListener("change", change);
  }, []);
  const dirty = useRef(false);
  const count = counts(pence),
    draw = drawCounts(pence);
  const figure = `£${(pence / 100).toFixed(2)}`;
  const geography = located ? "within 800 m" : "in view";
  const describeCount = (current: FairPintCounts, amount: string) =>
    offline
      ? "You're offline. Prices on screen may be old."
      : current.phase === "failed" || draw.phase === "failed"
        ? "Could not load prices. Try again."
        : current.phase === "loading"
          ? FAIR_PINT_LOADING_LINE
          : current.count === 0
            ? `No pubs ${geography} list a pint at ${amount} or less.${located ? " Raise it." : " Move the map or raise it."}`
            : `${current.count} pubs ${geography} list a pint at ${amount} or less.`;
  const line = describeCount(count, figure);
  const reason =
    draw.phase === "loading"
      ? `Checking prices in ${area}…`
      : draw.phase === "ready" && draw.count < 3
        ? `Fewer than 3 pubs in ${area} list a pint at ${figure} or less.`
        : "";
  const input = (value: number) => {
    currentPence.current = value;
    dirty.current = true;
    setPence(value);
    onInput(value);
  };
  const release = () => {
    if (!dirty.current) return;
    const value = currentPence.current;
    dirty.current = false;
    held.current = value;
    onCommit(value);
    setAnnouncement(describeCount(counts(value), `£${(value / 100).toFixed(2)}`));
  };
  useLayoutEffect(() => {
    nativeRelease.current = release;
  });
  useLayoutEffect(() => {
    const early = document.querySelector<HTMLElement>("[data-fair-prelude]");
    if (early) early.hidden = true;
  }, []);
  return (
    <FairPintFrame
      area={area}
      figure={figure}
      countLine={line}
      announcement={announcement}
      reason={reason}
      failed={count.phase === "failed" || draw.phase === "failed"}
      locationOff={locationOff}
      error={error}
      pending={pending}
      drawDisabled={drawUnavailable || offline || draw.phase !== "ready" || draw.count < 3}
      onRetry={onRetry}
      onLocation={onLocation}
      onDraw={() => onDraw(pence)}
      onClose={onClose}
      slider={{
        ref: slider,
        value: pence,
        "aria-valuetext": `${figure}, ${offline ? "you are offline" : count.phase === "failed" || draw.phase === "failed" ? "could not load prices" : count.phase === "ready" ? `${count.count} pubs ${located ? "within 800 metres" : "in view"}` : "loading prices"}`,
        onPointerDown: (event) => event.currentTarget.setPointerCapture(event.pointerId),
        onInput: (event) => input(event.currentTarget.valueAsNumber),
        onPointerUp: release,
        onKeyUp: release,
        onPointerCancel: () => {
          dirty.current = false;
          currentPence.current = held.current;
          setPence(held.current);
          onInput(held.current);
        },
        onBlur: () => {
          if (dirty.current) {
            dirty.current = false;
            currentPence.current = held.current;
            setPence(held.current);
            onInput(held.current);
          }
        },
        onKeyDown: (event) => {
          if (event.key === "PageUp" || event.key === "PageDown") {
            event.preventDefault();
            input(Math.min(800, Math.max(300, pence + (event.key === "PageUp" ? 50 : -50))));
          }
        },
      }}
    />
  );
}

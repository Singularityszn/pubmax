"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatPence } from "@/lib/formatGbp";
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
  loadFailed = false,
  error = "",
  pending = false,
  focusOnMount = false,
  standDown = false,
}: {
  focusOnMount?: boolean;
  standDown?: boolean;
  drawUnavailable?: boolean;
  loadFailed?: boolean;
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
  const figure = formatPence(pence);
  const geography = located ? "within 800 m" : "in view";
  const describeCount = (current: FairPintCounts, amount: string) =>
    offline
      ? "You're offline. Prices on screen may be old."
      : current.phase === "failed"
        ? "Could not load prices. Try again."
        : current.phase === "loading"
          ? FAIR_PINT_LOADING_LINE
          : current.count === 0
            ? `No pubs ${geography} list a pint at ${amount} or less.${located ? " Raise it." : " Move the map or raise it."}`
            : `${current.count} ${current.count === 1 ? "pub" : "pubs"} ${geography} ${current.count === 1 ? "lists" : "list"} a pint at ${amount} or less.`;
  const line = describeCount(count, figure);
  const reason =
    draw.phase === "loading"
      ? `Checking prices in ${area}…`
      : draw.phase === "failed"
        ? `Could not load prices in ${area}.`
        : draw.count < 3
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
    setAnnouncement(describeCount(counts(value), formatPence(value)));
  };
  useLayoutEffect(() => {
    nativeRelease.current = release;
  });
  useLayoutEffect(() => {
    const early = document.querySelector<HTMLElement>("[data-fair-prelude]");
    if (early) early.hidden = true;
  }, []);
  useLayoutEffect(() => { if (focusOnMount) slider.current?.focus({ preventScroll: true }); }, [focusOnMount]);
  // A card speaks its first answer once it lands. A change of geography is
  // spoken once its count has an answer, and so is the count that a retry
  // brings back after a spoken failure.
  const spoken = useRef({ located: false, failed: false, heard: false });
  useEffect(() => {
    if (count.phase === "loading") return;
    const failed = count.phase === "failed" || draw.phase === "failed";
    const changed = spoken.current.located !== located;
    const recovered = spoken.current.failed && !failed;
    const first = !spoken.current.heard;
    spoken.current = { located, failed, heard: true };
    if (first || changed || recovered) setAnnouncement(line);
  }, [located, count.phase, draw.phase, line]);
  return (
    <FairPintFrame
      standDown={standDown}
      area={area}
      pence={pence}
      priceStatus={offline ? "you are offline" : count.phase === "failed" ? "could not load prices" : count.phase === "ready" ? `${count.count} ${count.count === 1 ? "pub" : "pubs"} ${located ? "within 800 metres" : "in view"}` : "loading prices"}
      countLine={line}
      announcement={announcement}
      reason={reason}
      failed={loadFailed || count.phase === "failed" || draw.phase === "failed"}
      located={located}
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

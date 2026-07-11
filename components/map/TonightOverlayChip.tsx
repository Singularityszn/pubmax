"use client";

import { MoonStar, X } from "lucide-react";

import "./tonightOverlayChip.css";

type Props = {
  count: number;
  active: boolean;
  onToggle: () => void;
  onDismiss: () => void;
};

/** Compact pill under the London status banner — toggle tonight opportunity pins. */
export default function TonightOverlayChip({
  count,
  active,
  onToggle,
  onDismiss,
}: Props) {
  if (count <= 0) return null;

  return (
    <div className="tonightOverlayChip" role="region" aria-label="Tonight nearby">
      <button
        type="button"
        className={active ? "tonightOverlayChipToggle isActive" : "tonightOverlayChipToggle"}
        onClick={onToggle}
        aria-pressed={active}
      >
        <MoonStar size={14} aria-hidden="true" />
        <span>
          {active ? "Tonight on map" : "Show tonight"} · {count}
        </span>
      </button>
      <button
        type="button"
        className="tonightOverlayChipDismiss"
        aria-label="Dismiss tonight overlay"
        onClick={onDismiss}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  applyMode,
  currentMode,
  MODE_STORAGE_KEY,
  resolveMode,
  type ViewMode,
} from "@/lib/viewMode";

import "./viewModeSwitch.css";

// The Lock-In / Ledger mode switch — a compact, two-state control that lives in
// the nav (see SiteNav's actions cluster). It composes the existing Legacy Mode
// mechanism rather than forking a flag: choosing Ledger writes html[data-mode]
// AND drives html[data-legacy] (LegacyToggle's own attribute/key), so the whole
// heritage view — larger type, higher contrast, hidden chaos, no motion — comes
// for free from the token-override layer already in globals.css.
//
// Persistence + no-flash shape mirrors ThemeToggle / LegacyToggle exactly:
// useSyncExternalStore reads the DOM attribute the pre-hydration script set (so
// the label is correct on first paint), a MutationObserver + storage listener
// keep it live, and a mount effect re-asserts the attribute React 19 hydration
// can strip. This is never a dark pattern: both states are visible at once and
// tapping either one flips instantly and reversibly.

function subscribe(onChange: () => void): () => void {
  const el = document.documentElement;
  const mo = new MutationObserver(onChange);
  // Watch both attributes this control owns / composes, so an external Legacy
  // toggle (or another tab) keeps the switch honest.
  mo.observe(el, { attributes: true, attributeFilter: ["data-mode", "data-legacy"] });
  window.addEventListener("storage", onChange);
  return () => {
    mo.disconnect();
    window.removeEventListener("storage", onChange);
  };
}

function useViewMode(): ViewMode {
  return useSyncExternalStore(subscribe, currentMode, () => "lock-in");
}

const MODES: { id: ViewMode; label: string; hint: string }[] = [
  {
    id: "lock-in",
    label: "Lock-In",
    hint: "Tonight — the live, chaos-forward view",
  },
  {
    id: "ledger",
    label: "Ledger",
    hint: "Heritage — larger text, calmer, the venue logbook",
  },
];

export default function ViewModeSwitch(): React.JSX.Element {
  const mode = useViewMode();

  // React 19 hydration can drop the attribute the no-flash script set on <html>
  // (same issue ThemeToggle / LegacyToggle document); re-assert from storage on
  // mount. DOM write only (not setState) so it doesn't trip
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    const stored = resolveMode(
      localStorage.getItem(MODE_STORAGE_KEY),
      localStorage.getItem("pubmax-legacy"),
    );
    applyMode(stored);
  }, []);

  return (
    <div
      className="viewModeSwitch"
      role="radiogroup"
      aria-label="View mode: Lock-In or Ledger"
    >
      {MODES.map((m) => {
        const isActive = m.id === mode;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={isActive ? "viewModeOption isActive" : "viewModeOption"}
            title={m.hint}
            onClick={() => applyMode(m.id)}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Type } from "lucide-react";

// Legacy Mode (issue #28): a global, persisted accessibility toggle for
// older + low-vision users — larger base type, higher contrast token
// overrides, stronger focus rings, and forced reduced motion. Mirrors
// ThemeToggle's persistence pattern exactly (same storage-key / no-flash /
// useSyncExternalStore shape) so the two controls behave identically, but is
// its own boolean rather than a light/dark enum: html[data-legacy="1"] is the
// single hook every override in globals.css keys off.

const STORAGE_KEY = "pubmax-legacy";

function storedLegacy(): boolean | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "1") return true;
  if (v === "0") return false;
  return null;
}

function domLegacy(): boolean {
  if (typeof document === "undefined") return false;
  // Prefer the attribute the no-flash script set; fall back to storage so the
  // icon stays correct even if hydration dropped the attribute.
  const attr = document.documentElement.dataset.legacy;
  if (attr === "1") return true;
  if (attr === undefined) {
    const stored = storedLegacy();
    if (stored !== null) return stored;
  }
  return false;
}

// Same subscribe shape as ThemeToggle's: a MutationObserver on <html> keeps
// this in sync when toggled here or in another tab.
function subscribe(onChange: () => void): () => void {
  const el = document.documentElement;
  const mo = new MutationObserver(onChange);
  mo.observe(el, { attributes: true, attributeFilter: ["data-legacy"] });
  window.addEventListener("storage", onChange);
  return () => {
    mo.disconnect();
    window.removeEventListener("storage", onChange);
  };
}

function useLegacy(): boolean {
  return useSyncExternalStore(subscribe, domLegacy, () => false);
}

export default function LegacyToggle({ floating = false }: { floating?: boolean }) {
  const legacy = useLegacy();

  // React 19 hydration can strip the attribute the no-flash script set on
  // <html> (same issue ThemeToggle documents), so re-assert it on mount. DOM
  // write only, not setState, so it doesn't trip react-hooks/set-state-in-effect.
  useEffect(() => {
    const stored = storedLegacy();
    if (stored) {
      document.documentElement.dataset.legacy = "1";
    } else if (stored === false) {
      delete document.documentElement.dataset.legacy;
    }
  }, []);

  function toggle() {
    const next = !domLegacy();
    if (next) {
      document.documentElement.dataset.legacy = "1";
    } else {
      delete document.documentElement.dataset.legacy;
    }
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={floating ? "legacyToggle floating" : "legacyToggle"}
      aria-label="Legacy Mode: larger text, higher contrast, reduced motion"
      aria-pressed={legacy}
      title="Legacy Mode: larger text, higher contrast, reduced motion"
    >
      <Type size={18} />
    </button>
  );
}

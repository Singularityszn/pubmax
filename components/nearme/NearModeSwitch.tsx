"use client";

import { NEAR_MODES, type NearMode } from "@/lib/nearDesk";

import "./nearModeSwitch.css";

const LABELS: Record<NearMode, string> = {
  pint: "Pint",
  desk: "Desk",
};

export default function NearModeSwitch({
  value,
  onChange,
}: {
  value: NearMode;
  onChange: (mode: NearMode) => void;
}) {
  return (
    <div className="nearModeSwitch">
      <div
        className="nearModeSwitchList"
        role="tablist"
        aria-label="Near mode"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const current = tabs.indexOf(event.target as HTMLButtonElement);
          if (current < 0) return;
          const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          event.preventDefault();
          tabs[nextIndex]?.focus();
          tabs[nextIndex]?.click();
        }}
      >
        {NEAR_MODES.map((mode) => {
          const selected = mode === value;
          return (
            <button
              key={mode}
              type="button"
              role="tab"
              className="nearModeSwitchTab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(mode)}
            >
              {LABELS[mode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

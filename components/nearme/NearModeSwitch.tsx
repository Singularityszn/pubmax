"use client";

import { ReadyButton } from "@/components/ui/ready-button";

import { NEAR_MODES, type NearMode } from "@/lib/nearDesk";

import "./nearModeSwitch.css";

// The label says what the mode finds. "Desk" named the code's word for the
// mode, and a reader could not tell it meant a cafe, library or coworking
// space to sit and work in (UX sprint, 15 Oct 2026).
const LABELS: Record<NearMode, string> = {
  pint: "Pints",
  desk: "Work spots",
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
      {/* A radiogroup, not a tablist: a tab owes an associated tabpanel, and
          the answer below is rendered by NearMeNow, which this wave may not
          edit. Two exclusive choices with roving focus is what a radiogroup
          already means. */}
      <div
        className="nearModeSwitchList"
        role="radiogroup"
        aria-label="What to find"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
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
            <ReadyButton
              key={mode}
              type="button"
              role="radio"
              className="nearModeSwitchTab"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(mode)}
            >
              {LABELS[mode]}
            </ReadyButton>
          );
        })}
      </div>
    </div>
  );
}

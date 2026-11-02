"use client";

// Night falls (wild idea 09). The app already turns dark at 21:30 London time
// for a reader with no stored theme choice; this makes that switch a moment,
// once a night in this browser: warm lamp glows bloom one after another
// across the screen, a small toast says what changed, and it all fades in
// about two and a half seconds.
//
// It plays when the night rule turns an open page dark (ThemeAttribute's
// minute tick sets html[data-night-theme]) or on the first page load later
// that night. `?nightfall=now` plays it on demand for the captain's
// screenshots (`?nightfall=slow` at a quarter speed) and, on a light page,
// turns the page dark for the rest of its life WITHOUT storing a theme
// choice. Loaded only while the wild switch is on (NightFallGate.tsx), so no
// route pays for it otherwise.
//
// The overlay takes no pointer events and sits on the night-card layer, under
// the sheets and modals. Reduced motion: no blooms, only the toast.

import { Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ICON_SIZE } from "@/lib/iconScale";
import { safeLocalStorage } from "@/lib/safeStorage";
import { prefersReducedMotion } from "@/lib/wildMode";

import {
  NIGHT_FALL_MS,
  NIGHT_FALL_PARAM,
  NIGHT_FALL_STORAGE_KEY,
  NIGHT_FALL_TOAST,
  nightFallDue,
  nightFallLamps,
  type NightFallLamp,
} from "./nightFallPlan";
import "./nightFall.css";

/** `slow` is 1, or 4 for `?nightfall=slow`, so a screenshot can catch the lamps. */
type Moment = { id: number; reduced: boolean; slow: number; lamps: NightFallLamp[] };

type ProbeWindow = Window & {
  __pubmaxPaintedMapTapPoints?: () => { x: number; y: number }[];
};

/** The prices the map is painting, so no lamp blooms over one. Empty off the map. */
function paintedPrices(): { x: number; y: number }[] {
  try {
    return (window as ProbeWindow).__pubmaxPaintedMapTapPoints?.() ?? [];
  } catch {
    return [];
  }
}

function readLastNight(): string | null {
  try {
    return safeLocalStorage()?.getItem(NIGHT_FALL_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLastNight(key: string): void {
  try {
    safeLocalStorage()?.setItem(NIGHT_FALL_STORAGE_KEY, key);
  } catch {
    // A browser that refuses storage still plays it once in this page.
  }
}

/**
 * Whether the address this page was opened at asked for the demo:
 * `?nightfall=now`, or `?nightfall=slow` for the same moment at a quarter
 * speed. Some pages tidy their query string with history.replaceState before
 * this lazy chunk arrives, so the navigation entry is read as well.
 */
function demoAsked(): "now" | "slow" | null {
  const asked = (search: string) => {
    try {
      const value = new URLSearchParams(search).get(NIGHT_FALL_PARAM);
      return value === "now" || value === "slow" ? value : null;
    } catch {
      return null;
    }
  };
  const live = asked(window.location.search);
  if (live) return live;
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry ? asked(new URL(entry.name).search) : null;
  } catch {
    return null;
  }
}

/** How long the demo waits before the page turns dark, so dusk is seen falling. */
const DEMO_DUSK_MS = 240;

export default function NightFall(): React.ReactNode {
  const [moment, setMoment] = useState<Moment | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    let sequence = 0;
    let frame = 0;
    let duskTimer = 0;
    // Remembered here too, so a browser that refuses storage still plays it
    // once per page rather than on every theme change.
    let playedKey: string | null = readLastNight();

    const play = (slow = 1) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const reduced = prefersReducedMotion();
        sequence += 1;
        setMoment({
          id: sequence,
          reduced,
          slow,
          lamps: reduced ? [] : nightFallLamps(window.innerWidth, window.innerHeight, paintedPrices()),
        });
      });
    };

    const demo = demoAsked();
    if (demo) {
      play(demo === "slow" ? 4 : 1);
      if (root.dataset.theme !== "dark") {
        duskTimer = window.setTimeout(() => {
          // The demo's dark lasts this page's life and is never stored. The
          // theme-chosen mark is the one the theme control sets when storage
          // refuses a choice: it stands the night rule's minute tick down
          // (ThemeAttribute.tsx), so the clock does not undo the demo.
          root.dataset.themeChosen = "1";
          root.dataset.theme = "dark";
        }, prefersReducedMotion() ? 0 : DEMO_DUSK_MS * (demo === "slow" ? 4 : 1));
      }
      return () => {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(duskTimer);
      };
    }

    const check = () => {
      const key = nightFallDue({
        nightTheme: root.dataset.nightTheme === "1",
        theme: root.dataset.theme,
        lastPlayedKey: playedKey,
        now: new Date(),
      });
      if (!key) return;
      playedKey = key;
      writeLastNight(key);
      play();
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-night-theme"] });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!moment) return;
    const timer = window.setTimeout(() => setMoment(null), NIGHT_FALL_MS * moment.slow + 100);
    return () => window.clearTimeout(timer);
  }, [moment]);

  if (!moment) return null;
  const whole = { animationDuration: `${NIGHT_FALL_MS * moment.slow}ms` };
  return createPortal(
    <div
      key={moment.id}
      className="nightFall"
      data-testid="wild-night-fall"
      data-reduced={moment.reduced ? "true" : undefined}
    >
      {moment.reduced ? null : <div className="nightFallVeil" aria-hidden="true" style={whole} />}
      {moment.lamps.map((lamp, index) => (
        <span
          key={index}
          className="nightFallLamp"
          aria-hidden="true"
          style={{
            left: lamp.x,
            top: lamp.y,
            width: lamp.size,
            height: lamp.size,
            animationDelay: `${lamp.delayMs * moment.slow}ms`,
            animationDuration: `${Math.max(600, NIGHT_FALL_MS - lamp.delayMs) * moment.slow}ms`,
          }}
        />
      ))}
      <div className="nightFallToast" role="status" style={whole}>
        <span className="nightFallToastIcon" aria-hidden="true">
          <Moon size={ICON_SIZE.inline} />
        </span>
        <p className="nightFallToastText">
          <span className="nightFallToastTime">{NIGHT_FALL_TOAST.time}.</span>{" "}
          {NIGHT_FALL_TOAST.text}
        </p>
      </div>
    </div>,
    document.body,
  );
}

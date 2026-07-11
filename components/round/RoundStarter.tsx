"use client";

import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { normalizeHandle } from "@/lib/profiles";
import { startRoundWithStops, type SeedStop } from "@/lib/startRoundWithStops";

import "./roundStarter.css";

export type RoundStarterProps = {
  defaultTitle?: string;
  seedStops?: SeedStop[];
  /** Denser UI for the Plan drawer. */
  compact?: boolean;
  className?: string;
};

const ACTIVE_ROUND_KEY = "pubmax_active_round";

/**
 * Start a Round: group-crawl entry (GH #26). Mints a Round, optionally seeds
 * stops from a Plan route, stamps `pubmax_active_round`, and navigates to the
 * live Round page. Handle UX matches the rest of the social layer
 * (`pubmax_handle` in localStorage).
 */
export default function RoundStarter({
  defaultTitle,
  seedStops,
  compact = false,
  className,
}: RoundStarterProps): React.JSX.Element {
  const router = useRouter();
  const [handle, setHandle] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? "");
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasSeeds = Boolean(seedStops && seedStops.length > 0);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    const clean = normalizeHandle(handle);
    if (!clean) {
      setError("Pick a handle to start a Round.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      window.localStorage.setItem("pubmax_handle", clean);
    } catch {
      // storage disabled — the Round still starts, handle just isn't remembered
    }

    const result = await startRoundWithStops({
      handle: clean,
      title: defaultTitle,
      seedStops,
    });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    try {
      window.localStorage.setItem(ACTIVE_ROUND_KEY, result.code);
    } catch {
      // storage disabled — Round page can still be opened; chip just won't light
    }

    router.push(`/rounds/${result.code}`);
  }

  const formClass = ["roundStarter", compact ? "compact" : null, className]
    .filter(Boolean)
    .join(" ");

  return (
    <form className={formClass} onSubmit={start}>
      <span className="roundStarterBadge">
        <Users size={14} aria-hidden="true" /> The Round · group crawl
      </span>
      <h2 className="roundStarterTitle">
        {hasSeeds ? "Invite friends to this plan" : "Start a Round"}
      </h2>
      <p className="roundStarterBlurb">
        {hasSeeds
          ? "Turn this plan into a Round. Friends join by a short code; stops are already queued."
          : "A group crawl that builds itself. Friends join by a short code; as everyone drops pints, the route grows itself, stop by stop."}
      </p>
      <div className="roundStarterRow">
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="your handle"
          aria-label="Your handle"
          autoComplete="off"
          maxLength={30}
        />
        <button type="submit" className="crawlPrimaryBtn" disabled={busy}>
          <Users size={16} aria-hidden="true" />{" "}
          {busy ? "Starting…" : hasSeeds ? "Start Round" : "Start a Round"}
        </button>
      </div>
      {error ? (
        <p className="roundStarterError" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

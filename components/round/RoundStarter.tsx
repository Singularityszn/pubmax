"use client";

import { Copy, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { writeActiveRoundCode } from "@/lib/activeRound";
import { normalizeHandle } from "@/lib/profiles";
import { startRoundWithStops, type SeedStop } from "@/lib/startRoundWithStops";

import "./roundStarter.css";

export type RoundStarterProps = {
  defaultTitle?: string;
  seedStops?: SeedStop[];
  /** Denser UI for the Plan drawer. */
  compact?: boolean;
  /**
   * When true, stay on the map after start (success UI + callback) instead of
   * navigating to `/rounds/{code}`. Defaults to `true` when `compact`.
   */
  stayOnMap?: boolean;
  /** Fires after a successful start when staying on the map (chip can light immediately). */
  onRoundStarted?: (code: string) => void;
  className?: string;
};

/**
 * Start a Round: group-crawl entry (GH #26). Mints a Round, optionally seeds
 * stops from a Plan route, stamps the active Round key, and either navigates
 * to the live Round page or (Plan drawer / stayOnMap) keeps the user on the map.
 * Handle UX matches the rest of the social layer (`pubmax_handle` in localStorage).
 */
export default function RoundStarter({
  defaultTitle,
  seedStops,
  compact = false,
  stayOnMap,
  onRoundStarted,
  className,
}: RoundStarterProps): React.JSX.Element {
  const router = useRouter();
  const stay = stayOnMap ?? compact;
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
  const [startedCode, setStartedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const hasSeeds = Boolean(seedStops && seedStops.length > 0);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — code is still visible to copy manually.
    }
  }

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

    writeActiveRoundCode(result.code);

    if (stay) {
      setStartedCode(result.code);
      setBusy(false);
      onRoundStarted?.(result.code);
      return;
    }

    router.push(`/rounds/${result.code}`);
  }

  const formClass = ["roundStarter", compact ? "compact" : null, className]
    .filter(Boolean)
    .join(" ");

  if (startedCode) {
    return (
      <div className={`${formClass} roundStarterSuccess`} role="status" aria-live="polite">
        <span className="roundStarterBadge">
          <Users size={14} aria-hidden="true" /> Round is live
        </span>
        <h2 className="roundStarterTitle">Share the code</h2>
        <p className="roundStarterBlurb">
          Friends join with this code. You stay on the map — open the Round board anytime.
        </p>
        <p className="roundStarterCode" data-testid="round-starter-code">
          {startedCode}
        </p>
        <div className="roundStarterRow">
          <button
            type="button"
            className="crawlPrimaryBtn"
            onClick={() => void copyCode(startedCode)}
          >
            <Copy size={16} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
          </button>
          <Link href={`/rounds/${startedCode}`} className="crawlPrimaryBtn roundStarterBoardLink">
            Open Round board
          </Link>
        </div>
      </div>
    );
  }

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
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
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

import Link from "next/link";
import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { PresenceState } from "./usePresence";

export default function PresenceHere({
  venueName,
  presenceState,
  promptOwned,
  onClaimPrompt,
  markPresenceHere,
  leavePresenceHere,
}: {
  venueName: string;
  presenceState: PresenceState;
  promptOwned: boolean;
  onClaimPrompt: () => void;
  markPresenceHere: () => void;
  leavePresenceHere: () => void;
}) {
  return (
    <div className="presenceHere">
      {presenceState === "here" || presenceState === "leaving" ? (
        <p
          className="presenceHereConfirm"
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            margin: "12px 0 0",
            minHeight: "42px",
            fontWeight: 700,
            color: "var(--state-active-ink)",
          }}
        >
          <MapPin size={16} aria-hidden="true" /> You&rsquo;re here
          <Button
            type="button"
            variant="ghost"
            onClick={leavePresenceHere}
            disabled={presenceState === "leaving"}
          >
            {presenceState === "leaving" ? "Leaving…" : "Leave"}
          </Button>
        </p>
      ) : (
        <button
          type="button"
          className="addStopBtn"
          onClick={() => {
            onClaimPrompt();
            markPresenceHere();
          }}
          disabled={presenceState === "sending"}
          aria-label={`Mark that you're at ${venueName} tonight`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          <MapPin size={16} aria-hidden="true" />
          {presenceState === "sending" ? "Checking in…" : "I'm here"}
        </button>
      )}
      <p
        className="description muted"
        style={{ margin: "6px 0 0", fontSize: "0.82rem", textAlign: "center" }}
      >
        Only your mates see this, for two hours.
      </p>
      {presenceState === "no-handle" && promptOwned ? (
        <p
          className="description muted"
          style={{ marginTop: "8px", fontSize: "0.82rem" }}
        >
          Claim a handle to check in.{" "}
          <Link href="/u/you" className="sheetPromptLink">
            Set yours
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

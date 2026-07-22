"use client";

// Sort My Night P1 — persistent crew re-invite MVP.
// Surfaces the usual lot remembered from the last plan and shares a
// WhatsApp-first message that names them + the current plan link.

import { useMemo, useState, useSyncExternalStore } from "react";

import { trackEvent } from "@/lib/analytics";
import {
  buildLastCrewShareText,
  readLastCrew,
  subscribeLastCrew,
} from "@/lib/lastCrew";
import { shareNightObject } from "@/lib/shareSheet";

type LastCrewInviteProps = {
  planId: string;
  planTitle: string;
  /** Site-relative plan path (e.g. /plan/abc). Absolute URL resolved at share time. */
  planUrl: string;
}

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

export default function LastCrewInvite({
  planId,
  planTitle,
  planUrl,
}: LastCrewInviteProps) {
  const crew = useSyncExternalStore(subscribeLastCrew, readLastCrew, () => null);
  const [status, setStatus] = useState("");

  const absoluteUrl = useMemo(() => toAbsoluteUrl(planUrl), [planUrl]);
  const message = useMemo(() => {
    if (!crew) return "";
    return buildLastCrewShareText({
      names: crew.names,
      planUrl: absoluteUrl,
      title: planTitle,
    });
  }, [crew, planTitle, absoluteUrl]);

  if (!crew || crew.names.length < 2) return null;
  // Don't nudge re-invite for the same plan that produced the roster.
  if (crew.sourcePlanId && crew.sourcePlanId === planId) return null;

  async function handleInvite() {
    if (!message) return;
    const outcome = await shareNightObject({
      title: planTitle,
      text: message,
      url: absoluteUrl,
    });
    if (outcome === "shared" || outcome === "whatsapp") {
      trackEvent("plan_invite_sent", { channel: outcome === "whatsapp" ? "whatsapp" : "native" });
      setStatus("Invite ready for the usual lot.");
    } else if (outcome === "failed") {
      try {
        await navigator.clipboard.writeText(message);
        trackEvent("plan_invite_sent", { channel: "copy" });
        setStatus("Invite copied. Paste it to the usual lot.");
      } catch {
        setStatus("");
      }
    }
  }

  return (
    <section className="lastCrewInvite" aria-label="Invite the usual lot">
      <p className="lastCrewInvite__lede">
        Usual lot: <strong>{crew.names.join(", ")}</strong>
      </p>
      <button
        type="button"
        className="lastCrewInvite__cta pressable"
        onClick={() => void handleInvite()}
      >
        Invite the usual lot
      </button>
      {status ? (
        <p className="lastCrewInvite__status" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}

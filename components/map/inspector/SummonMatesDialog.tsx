"use client";

// "Summon mates": the small form behind the action card's door. Pick a time,
// tick the mates, send. Each mate gets a direct message with the pub attached
// (app/api/summon/route.ts). Anyone, signed in or not, can share a link that
// opens the pub with the time on it instead.
//
// The list is the server's answer: live mates with no block or mute either way
// (lib/summonMates.server.ts). The receipt names only the mates the server says
// it reached. Nothing here counts who is coming.

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "@/components/auth/authContext";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { ContributionGateDialog } from "@/components/identity/ContributionGateDialog";
import { Button } from "@/components/ui/button";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { authedActionFetch, signedInActionFetch } from "@/lib/authedFetch";
import { readProviderAccountRevision, readProviderAccountSignal, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import { readContributionGateStatus, type ContributionGateStatus } from "@/lib/contributionGateStatus";
import { shareNightObject } from "@/lib/shareSheet";
import {
  defaultSummonTime,
  parseSummonTime,
  SUMMON_MAX_MATES,
  SUMMON_NO_MATES_LINE,
  SUMMON_SEND_FAILED_LINE,
  SUMMON_SIGNED_OUT_LINE,
  summonSentLine,
  summonShareText,
  venueSummonUrl,
} from "@/lib/summonMates";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { Venue } from "@/lib/venues";

import "./tableRequest.css";
import "./summonMates.css";

type Mates =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "ready"; handles: string[] }
  | { kind: "unavailable"; text: string };

type Stage =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "sent"; sent: string[]; failed: string[] };

function readHandles(body: unknown, key: "mates" | "sent" | "failed"): string[] {
  const value = (body as Record<string, unknown> | null)?.[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

type Props = {
  venue: Venue;
  onClose: () => void;
};

function accessGate(body: unknown): ContributionGateStatus | null {
  const error = body as { code?: unknown; details?: { gate?: unknown } } | null;
  if (error?.code === "SOCIAL_SIGN_IN_REQUIRED") return "sign_in_required";
  if (error?.code !== "SOCIAL_ADULT_VERIFICATION_REQUIRED") return null;
  return readContributionGateStatus(error.details?.gate) ?? null;
}

export default function SummonMatesDialog(props: Props) {
  const { signedOut, phase } = useViewerSession();
  const accountRevision = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  return <SummonMatesForm key={`${props.venue.id}:${accountRevision}:${phase}`} {...props} signedOut={signedOut} accountRevision={accountRevision} />;
}

function SummonMatesForm({ venue, onClose, signedOut, accountRevision }: Props & { signedOut: boolean; accountRevision: number }) {
  const { identityResolved } = useAuth();
  const titleId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [time, setTime] = useState(() => defaultSummonTime());
  const [mates, setMates] = useState<Mates>({ kind: "loading" });
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [gate, setGate] = useState<ContributionGateStatus | null>(null);
  const [reload, setReload] = useState(0);

  useDismissOnEscape(!gate, onClose);
  useFocusTrap(!gate, dialogRef, "strict-modal");
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (signedOut || !identityResolved || readProviderAccountRevision() !== accountRevision) return;
    const controller = new AbortController();
    const accountSignal = readProviderAccountSignal();
    const abort = () => controller.abort();
    accountSignal.addEventListener("abort", abort, { once: true });
    const live = () => !controller.signal.aborted && !accountSignal.aborted && readProviderAccountRevision() === accountRevision;
    void signedInActionFetch("/api/summon", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!live()) return;
        if (!response) return;
        const body = (await response.json().catch(() => null)) as unknown;
        if (!live()) return;
        if (!response.ok) {
          setGate(accessGate(body));
          setMates({ kind: "unavailable", text: errorMessageFrom(body, "Your mates are unavailable right now.") });
          return;
        }
        setMates({ kind: "ready", handles: readHandles(body, "mates") });
      })
      .catch(() => {
        if (live()) {
          setMates({ kind: "unavailable", text: "We couldn't reach PUBMAXX. Check your signal." });
        }
      });
    return () => {
      accountSignal.removeEventListener("abort", abort);
      controller.abort();
    };
  }, [signedOut, identityResolved, accountRevision, reload]);

  const listed: Mates = signedOut ? { kind: "signed-out" } : mates;
  const validTime = parseSummonTime(time);

  function toggle(handle: string): void {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(handle)) next.delete(handle);
      else if (next.size < SUMMON_MAX_MATES) next.add(handle);
      return next;
    });
  }

  async function send(): Promise<void> {
    const accountSignal = readProviderAccountSignal();
    const live = () => !accountSignal.aborted && readProviderAccountRevision() === accountRevision && dialogRef.current !== null;
    if (signedOut || !live()) return;
    if (!validTime) {
      setError("Pick a time.");
      return;
    }
    if (picked.size === 0) {
      setError("Pick at least one mate.");
      return;
    }
    setError(null);
    setStage({ kind: "sending" });
    try {
      const response = await authedActionFetch(
        "/api/summon",
        {
          method: "POST",
          signal: accountSignal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ venueId: venue.id, time: validTime, mates: [...picked] }),
        },
        { requiresIdentity: true },
      );
      const body = (await response.json().catch(() => null)) as unknown;
      if (!live()) return;
      if (response.ok) {
        setStage({ kind: "sent", sent: readHandles(body, "sent"), failed: readHandles(body, "failed") });
        return;
      }
      setStage({ kind: "form" });
      setGate(accessGate(body));
      setError(errorMessageFrom(body, SUMMON_SEND_FAILED_LINE));
    } catch {
      if (!live()) return;
      setStage({ kind: "form" });
      setError("We couldn't reach PUBMAXX. Check your signal and try again.");
    }
  }

  async function shareLink(): Promise<void> {
    if (!validTime) {
      setError("Pick a time.");
      return;
    }
    setError(null);
    setShareNote(null);
    const url = new URL(venueSummonUrl(venue.id, validTime), window.location.origin).toString();
    const outcome = await shareNightObject({
      title: venue.name,
      text: summonShareText(venue.name, validTime),
      url,
    });
    if (outcome === "shared" || outcome === "cancelled") return;
    if (outcome === "whatsapp") {
      setShareNote("Opened WhatsApp to share the link.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareNote("Sharing didn't open, so we copied the link.");
    } catch {
      setError("Couldn't copy the link. Try Share again.");
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage.kind === "sending") return;
    void send();
  }

  const canSend = listed.kind === "ready" && listed.handles.length > 0;

  const dialog = (
    <div className="tableRequestBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="tableRequestDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-summon-dialog=""
      >
        <h2 id={titleId}>Summon your mates to {venue.name}</h2>
        {stage.kind === "sent" ? (
          <div className="tableRequestOutcome" data-summon-outcome="sent">
            <p className="tableRequestOutcomeLead" role="status">
              {summonSentLine(stage.sent)}
            </p>
            {stage.failed.length > 0 ? (
              <p className="tableRequestError" role="alert">
                {`Not sent to ${stage.failed.map((handle) => `@${handle}`).join(", ")}. Try them again in a minute.`}
              </p>
            ) : null}
          </div>
        ) : (
          <form className="tableRequestForm" onSubmit={onSubmit} noValidate>
            <label className="tableRequestField summonTimeField">
              <span>What time</span>
              <input
                type="time"
                step={900}
                required
                value={time}
                onChange={(event) => setTime(event.target.value)}
                {...(error === "Pick a time." ? { "aria-invalid": true, "aria-describedby": errorId } : {})}
              />
            </label>
            {listed.kind === "loading" ? (
              <p className="tableRequestHint" role="status">
                Finding your mates…
              </p>
            ) : listed.kind === "signed-out" ? (
              <p className="tableRequestHint">{SUMMON_SIGNED_OUT_LINE}</p>
            ) : listed.kind === "unavailable" ? (
              <p className="tableRequestHint">{listed.text}</p>
            ) : listed.handles.length === 0 ? (
              <p className="tableRequestHint">{SUMMON_NO_MATES_LINE}</p>
            ) : (
              <fieldset className="summonMates">
                <legend>Who to summon</legend>
                <ul className="summonMatesList">
                  {listed.handles.map((handle) => (
                    <li key={handle}>
                      <label className="summonMate">
                        <input
                          type="checkbox"
                          checked={picked.has(handle)}
                          disabled={!picked.has(handle) && picked.size >= SUMMON_MAX_MATES}
                          onChange={() => toggle(handle)}
                        />
                        <span>@{handle}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            {error ? (
              <p id={errorId} className="tableRequestError" role="alert">
                {error}
              </p>
            ) : null}
            {shareNote ? (
              <p className="tableRequestHint" role="status">
                {shareNote}
              </p>
            ) : null}
            {canSend ? (
              <Button
                type="submit"
                variant="primary"
                className="tableRequestPrimary"
                disabled={stage.kind === "sending" || picked.size === 0}
              >
                {stage.kind === "sending"
                  ? "Sending…"
                  : picked.size === 0
                    ? "Send"
                    : `Send to ${picked.size} ${picked.size === 1 ? "mate" : "mates"}`}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={canSend ? "secondary" : "primary"}
              className="tableRequestPrimary"
              onClick={() => void shareLink()}
            >
              {canSend ? "Share a link instead" : "Share a link"}
            </Button>
            {listed.kind === "signed-out" ? (
              <Button
                type="button"
                variant="secondary"
                className="tableRequestPrimary"
                onClick={() => setGate("sign_in_required")}
              >
                Sign in
              </Button>
            ) : null}
          </form>
        )}
        <Button type="button" variant="ghost" className="tableRequestClose" onClick={onClose}>
          {stage.kind === "sent" ? "Done" : "Not now"}
        </Button>
      </section>
      {gate ? (
        <ContributionGateDialog
          mode={gate}
          error={null}
          onClose={() => setGate(null)}
          onAsserted={() => {
            if (readProviderAccountRevision() !== accountRevision) return;
            setGate(null);
            setError(null);
            setPicked(new Set());
            setMates({ kind: "loading" });
            setReload((current) => current + 1);
          }}
          returnTo={venueMapUrl(venue.id)}
        />
      ) : null}
    </div>
  );

  // Portalled for the same reason as the table form: the desktop drawer is a
  // transformed box and would otherwise contain the fixed backdrop.
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

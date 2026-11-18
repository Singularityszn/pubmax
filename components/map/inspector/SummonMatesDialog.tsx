"use client";

// "Summon mates": the small form behind the action card's door. Pick a time,
// tick the mates, send. Each mate gets a direct message with the pub attached
// (app/api/summon/route.ts). Anyone, signed in or not, can share a link that
// opens the pub with the time on it instead.
//
// The list is the server's answer: live mates with no block or mute either way
// (lib/summonMates.server.ts). The receipt names only the mates the server says
// it reached. Nothing here counts who is coming.
//
// A dated price rides along only when the pub's live public detail proves it
// (lib/summonPrice.ts). Its age is checked again on share and when the page
// comes back, so a dialog left open past the 30-day line drops it. The preview
// shows the shared invite. The send posts no price: the server reads its own.

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
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
  summonText,
  venueSummonUrl,
} from "@/lib/summonMates";
import { selectSummonPrice, summonPriceSentence } from "@/lib/summonPrice";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { Venue } from "@/lib/venues";
import { getWarmedVenue, warmVenueDetail } from "@/lib/warmVenueDetail";

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

/** The clock, read when the reader shares or comes back. Never during render. */
function readClock(): number {
  return Date.now();
}

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
  // Only a live public detail read. A saved device copy never lends a price.
  const [detail, setDetail] = useState<Venue | null>(() => getWarmedVenue(venue.id));
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const price = useMemo(() => selectSummonPrice(detail, checkedAt), [detail, checkedAt]);
  // The venue action that opened the dialog. Focus goes back to it on close,
  // even after a gate has come and gone.
  const [originRef] = useState(() => ({
    current: typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  }));
  // The control that opened a gate, so closing the gate lands back on it.
  const gateReturnRef = useRef<HTMLElement | null>(null);
  const previewLabelId = useId();

  useDismissOnEscape(!gate, onClose);
  useFocusTrap(!gate, dialogRef, "strict-modal", originRef);
  useEffect(() => {
    if (gate) return;
    // After the gate's own trap has given the page back.
    queueMicrotask(() => {
      const dialogNode = dialogRef.current;
      const target = gateReturnRef.current;
      gateReturnRef.current = null;
      if (target?.isConnected && dialogNode?.contains(target) && !target.matches(":disabled")) {
        target.focus({ preventScroll: true });
        return;
      }
      dialogNode?.focus({ preventScroll: true });
    });
  }, [gate]);

  function openGate(status: ContributionGateStatus | null, invoker: HTMLElement | null): void {
    gateReturnRef.current = status ? invoker : null;
    setGate(status);
  }

  useEffect(() => {
    if (getWarmedVenue(venue.id)) return;
    let live = true;
    void warmVenueDetail(venue.id).then((result) => {
      if (live && result.status === "found" && !result.savedAt) {
        setDetail(result.venue);
        setCheckedAt(readClock());
      }
    });
    return () => {
      live = false;
    };
  }, [venue.id]);

  useEffect(() => {
    // A phone can hold this dialog for days. Coming back checks the price's age again.
    const recheck = () => {
      if (document.visibilityState === "visible") setCheckedAt(readClock());
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("pageshow", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("pageshow", recheck);
      window.removeEventListener("focus", recheck);
    };
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
          openGate(accessGate(body), null);
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
    const focused = document.activeElement;
    const invoker = focused instanceof HTMLElement && dialogRef.current?.contains(focused) ? focused : null;
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
      openGate(accessGate(body), invoker);
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
    const now = readClock();
    setCheckedAt(now);
    const fresh = selectSummonPrice(detail, now);
    const text = summonShareText(venue.name, validTime, fresh, url);
    const outcome = await shareNightObject({ title: venue.name, text, url });
    if (outcome === "shared" || outcome === "cancelled") return;
    if (outcome === "whatsapp") {
      setShareNote("Opened WhatsApp to share the link.");
      return;
    }
    try {
      // A priced invite already names the link, before the publisher's page.
      await navigator.clipboard.writeText(fresh ? text : `${text}\n${url}`);
      setShareNote("Sharing didn't open, so we copied the invite and link.");
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
        aria-modal={gate ? undefined : true}
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
            {price && validTime ? (
              <div className="tableRequestScript summonPreview" role="group" aria-labelledby={previewLabelId} data-summon-preview="">
                <p id={previewLabelId} className="tableRequestHint">Your invite</p>
                <p>
                  {summonText(venue.name, validTime)} It&apos;s on the PUBMAXX map:{" "}
                  <a href={venueSummonUrl(venue.id, validTime)}>map link</a>
                </p>
                <p>
                  {summonPriceSentence(price)}{" "}
                  <a href={price.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Source: {price.sourceLabel}
                  </a>
                </p>
              </div>
            ) : null}
            {price && validTime && canSend ? (
              <p className="tableRequestHint">A message sent from here reads the price again first, so it can change or go without one.</p>
            ) : null}
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
                onClick={(event) => openGate("sign_in_required", event.currentTarget)}
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

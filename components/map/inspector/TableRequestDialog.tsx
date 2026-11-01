"use client";

// "Ask the pub for a table" (launch plan 1 Nov 2026, section 7 item 3): the
// small form behind the action card's "Ask for a table", for a crew of 6 to 20.
//
// It asks for the name the table is under, the size of the crew, the day and
// the time, an optional note, and ONE contact the pub can reply to, which the
// person chooses. One validator (lib/tableRequests.ts) answers here and at the
// route, so the form never claims a request the server would refuse.
//
// TWO ENDINGS, AND THE PERSON IS TOLD WHICH ONE RAN:
//   - Sent: PUBMAXX emailed the pub's verified operator. The pub replies to
//     the person, not to us, and a reply is not promised.
//   - Not sent: PUBMAXX sent nothing. The dialog hands the person a prefilled
//     email to the pub's own published address, or its phone, from the venue
//     record, and says plainly that PUBMAXX did not send it. A deployment
//     with no sign-in lands here without asking the server, because the
//     server can only ever answer the same.
//
// IT NEVER CHARGES ANYTHING and it is never a booking: no fee, no deposit, no
// card (ADR 0011 keeps a fee per seated group for later). Nothing here changes
// a rank, a pin colour, a price band or an order.

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "@/components/auth/AuthProvider";
import { ContributionGateDialog } from "@/components/identity/ContributionGateDialog";
import { Button } from "@/components/ui/button";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  readContributionGateStatus,
  type ContributionGateStatus,
} from "@/lib/contributionGateStatus";
import {
  TABLE_REQUEST_EMAIL_FALLBACK_LINE,
  TABLE_REQUEST_FREE_LINE,
  TABLE_REQUEST_MAX_PARTY,
  TABLE_REQUEST_MIN_PARTY,
  TABLE_REQUEST_NO_CONTACT_LINE,
  TABLE_REQUEST_NOT_SENT_LINE,
  TABLE_REQUEST_PHONE_FALLBACK_LINE,
  TABLE_REQUEST_SEND_LABEL,
  TABLE_REQUEST_SENT_LINE,
  tableRequestDateBounds,
  tableRequestLines,
  tableRequestMailtoHref,
  validateTableRequest,
  type TableRequestContactKind,
  type TableRequestField,
  type TableRequestFields,
} from "@/lib/tableRequests";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { venueContacts, type Venue } from "@/lib/venues";

import "./tableRequest.css";

type Draft = {
  name: string;
  partySize: string;
  date: string;
  time: string;
  note: string;
  contactKind: TableRequestContactKind;
  contactValue: string;
};

type Stage =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "not_sent"; request: TableRequestFields };

const PARTY_SIZES = Array.from(
  { length: TABLE_REQUEST_MAX_PARTY - TABLE_REQUEST_MIN_PARTY + 1 },
  (_, index) => TABLE_REQUEST_MIN_PARTY + index,
);

/** Stands in for the account the server binds from the session, so the shared validator can run here. */
const BROWSER_ACCOUNT = "this-browser";

function NotSent({ venue, request }: { venue: Venue; request: TableRequestFields }) {
  const contacts = venueContacts(venue);
  const lines = tableRequestLines(venue.name, request);
  return (
    <div className="tableRequestOutcome" data-table-request-outcome="not_sent">
      <p className="tableRequestOutcomeLead" role="status">
        {TABLE_REQUEST_NOT_SENT_LINE}
      </p>
      {contacts.emailHref ? (
        <>
          <p className="tableRequestHint">{TABLE_REQUEST_EMAIL_FALLBACK_LINE}</p>
          <Button asChild variant="primary" className="tableRequestPrimary">
            <a href={tableRequestMailtoHref(contacts.emailHref, venue.name, request)}>Email {venue.name}</a>
          </Button>
        </>
      ) : contacts.phoneHref ? (
        <>
          <p className="tableRequestHint">{TABLE_REQUEST_PHONE_FALLBACK_LINE}</p>
          <Button asChild variant="primary" className="tableRequestPrimary">
            <a href={contacts.phoneHref}>Ring {venue.name}</a>
          </Button>
        </>
      ) : (
        <p className="tableRequestHint">{TABLE_REQUEST_NO_CONTACT_LINE}</p>
      )}
      {contacts.emailHref ? null : (
        <div className="tableRequestScript" aria-label="Your request">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TableRequestDialog({
  venue,
  onClose,
}: {
  venue: Venue;
  onClose: () => void;
}) {
  const { configured, user } = useAuth();
  const titleId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const bounds = tableRequestDateBounds();
  const [draft, setDraft] = useState<Draft>(() => ({
    name: "",
    partySize: String(TABLE_REQUEST_MIN_PARTY),
    date: bounds.min,
    time: "19:00",
    note: "",
    contactKind: "email",
    contactValue: user?.email ?? "",
  }));
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [error, setError] = useState<{ field: TableRequestField | null; text: string } | null>(null);
  const [gate, setGate] = useState<ContributionGateStatus | null>(null);

  useDismissOnEscape(gate === null, onClose);
  useFocusTrap(gate === null, dialogRef, "strict-modal");
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  async function send(): Promise<void> {
    const validation = validateTableRequest(
      {
        venueId: venue.id,
        name: draft.name,
        partySize: draft.partySize,
        date: draft.date,
        time: draft.time,
        note: draft.note,
        contact: { kind: draft.contactKind, value: draft.contactValue },
      },
      BROWSER_ACCOUNT,
    );
    if (!validation.ok) {
      setError({ field: validation.field, text: validation.error });
      return;
    }
    setError(null);
    // No sign-in on this deployment: the server could only answer "not sent".
    if (!configured) {
      setStage({ kind: "not_sent", request: validation.fields });
      return;
    }
    setStage({ kind: "sending" });
    try {
      const response = await authedActionFetch(
        "/api/table-requests",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            venueId: venue.id,
            name: validation.fields.name,
            partySize: validation.fields.partySize,
            date: validation.fields.date,
            time: validation.fields.time,
            note: validation.fields.note ?? "",
            contact: { kind: validation.fields.contactKind, value: validation.fields.contactValue },
          }),
        },
        { requiresIdentity: true },
      );
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.ok && body?.outcome === "sent") {
        setStage({ kind: "sent" });
        return;
      }
      if (response.ok) {
        setStage({ kind: "not_sent", request: validation.fields });
        return;
      }
      const status = readContributionGateStatus(body?.status);
      setStage({ kind: "form" });
      if (status) {
        setGate(status);
        return;
      }
      const details = body?.details as { field?: unknown } | undefined;
      setError({
        field: typeof details?.field === "string" ? (details.field as TableRequestField) : null,
        text: errorMessageFrom(body, "We could not send that just now. Try again."),
      });
    } catch {
      setStage({ kind: "form" });
      setError({ field: null, text: "We could not reach PUBMAXX. Check your signal and try again." });
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage.kind === "sending") return;
    void send();
  }

  const invalid = (field: TableRequestField) =>
    error?.field === field ? { "aria-invalid": true, "aria-describedby": errorId } : {};

  const dialog = (
    <div className="tableRequestBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="tableRequestDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-venue-id={venue.id}
      >
        <h2 id={titleId}>Ask {venue.name} for a table</h2>
        {stage.kind === "sent" ? (
          <div className="tableRequestOutcome" data-table-request-outcome="sent">
            <p className="tableRequestOutcomeLead" role="status">
              {TABLE_REQUEST_SENT_LINE}
            </p>
          </div>
        ) : stage.kind === "not_sent" ? (
          <NotSent venue={venue} request={stage.request} />
        ) : (
          <form className="tableRequestForm" onSubmit={onSubmit} noValidate>
            <p className="tableRequestHint">{TABLE_REQUEST_FREE_LINE}</p>
            <label className="tableRequestField">
              <span>Name the table is under</span>
              <input
                type="text"
                autoComplete="name"
                maxLength={60}
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                {...invalid("name")}
              />
            </label>
            <div className="tableRequestRow">
              <label className="tableRequestField">
                <span>How many</span>
                <select
                  value={draft.partySize}
                  onChange={(event) => update({ partySize: event.target.value })}
                  {...invalid("partySize")}
                >
                  {PARTY_SIZES.map((size) => (
                    <option key={size} value={String(size)}>
                      {size} people
                    </option>
                  ))}
                </select>
              </label>
              <label className="tableRequestField">
                <span>Day</span>
                <input
                  type="date"
                  min={bounds.min}
                  max={bounds.max}
                  value={draft.date}
                  onChange={(event) => update({ date: event.target.value })}
                  {...invalid("date")}
                />
              </label>
              <label className="tableRequestField">
                <span>Time</span>
                <input
                  type="time"
                  step={900}
                  value={draft.time}
                  onChange={(event) => update({ time: event.target.value })}
                  {...invalid("time")}
                />
              </label>
            </div>
            <label className="tableRequestField">
              <span>Anything the pub should know (optional)</span>
              <textarea
                rows={2}
                maxLength={300}
                value={draft.note}
                onChange={(event) => update({ note: event.target.value })}
                {...invalid("note")}
              />
            </label>
            <fieldset className="tableRequestContact">
              <legend>How the pub replies to you</legend>
              <div className="tableRequestContactKinds" role="radiogroup">
                {(["email", "phone"] as const).map((kind) => (
                  <label key={kind} className="tableRequestContactKind">
                    <input
                      type="radio"
                      name="tableRequestContactKind"
                      value={kind}
                      checked={draft.contactKind === kind}
                      onChange={() =>
                        update({
                          contactKind: kind,
                          contactValue: kind === "email" ? user?.email ?? "" : "",
                        })
                      }
                    />
                    {kind === "email" ? "Email" : "Phone"}
                  </label>
                ))}
              </div>
              <label className="tableRequestField">
                <span>{draft.contactKind === "email" ? "Your email" : "Your phone number"}</span>
                <input
                  type={draft.contactKind === "email" ? "email" : "tel"}
                  autoComplete={draft.contactKind === "email" ? "email" : "tel"}
                  inputMode={draft.contactKind === "email" ? "email" : "tel"}
                  value={draft.contactValue}
                  onChange={(event) => update({ contactValue: event.target.value })}
                  {...invalid("contact")}
                />
              </label>
              <p className="tableRequestHint">We give this to the pub and show it to nobody else.</p>
            </fieldset>
            {error ? (
              <p id={errorId} className="tableRequestError" role="alert">
                {error.text}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              className="tableRequestPrimary"
              disabled={stage.kind === "sending"}
            >
              {stage.kind === "sending" ? "Sending…" : TABLE_REQUEST_SEND_LABEL}
            </Button>
          </form>
        )}
        <Button type="button" variant="ghost" className="tableRequestClose" onClick={onClose}>
          {stage.kind === "sent" || stage.kind === "not_sent" ? "Done" : "Not now"}
        </Button>
      </section>
      {gate ? (
        <ContributionGateDialog
          mode={gate}
          error={null}
          onClose={() => setGate(null)}
          onAsserted={() => {
            setGate(null);
            void send();
          }}
        />
      ) : null}
    </div>
  );

  // A dialog is the viewport's, not its opener's: the desktop drawer is a
  // transformed box, which would otherwise be the containing block for the
  // fixed backdrop (the same reason ContributionGateDialog portals).
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

"use client";

// The verified operator's list of "Ask the pub for a table" requests, inside
// the operator panel (launch plan 1 Nov 2026, section 7 item 3). Each request
// was also emailed to the operator; this is the same request, kept so the pub
// can find it again. It shows the name the table is under, the crew, the day,
// the time, the note and the ONE contact the person chose for the reply, as a
// link the pub can tap. Never the person's account.
//
// A request is a message, never a booking: the pub replies to the person
// directly, and nothing here takes a payment or holds a table.

import { useEffect, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import {
  TABLE_REQUEST_OPERATOR_HEADING,
  tableRequestDayLabel,
  type OperatorTableRequest,
} from "@/lib/tableRequests";

type Read = { venueId: string; requests: OperatorTableRequest[] | null };

function readRequests(body: unknown): OperatorTableRequest[] {
  const requests = (body as { requests?: unknown } | null)?.requests;
  return Array.isArray(requests) ? (requests as OperatorTableRequest[]) : [];
}

export default function OperatorTableRequests({ venueId }: { venueId: string }) {
  const [read, setRead] = useState<Read | null>(null);

  useEffect(() => {
    let active = true;
    authedActionFetch(
      `/api/table-requests?venueId=${encodeURIComponent(venueId)}`,
      {},
      { requiresIdentity: true },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (active) setRead({ venueId, requests: body === null ? null : readRequests(body) });
      })
      .catch(() => {
        if (active) setRead({ venueId, requests: null });
      });
    return () => {
      active = false;
    };
  }, [venueId]);

  const current = read && read.venueId === venueId ? read : null;
  return (
    <section className="operatorRailRequests" aria-label={TABLE_REQUEST_OPERATOR_HEADING}>
      <h3 className="operatorRailRequestsHeading">{TABLE_REQUEST_OPERATOR_HEADING}</h3>
      {current === null ? (
        <p className="operatorRailBody">Checking for table requests…</p>
      ) : current.requests === null ? (
        <p className="operatorRailBody">We could not load your table requests just now.</p>
      ) : current.requests.length === 0 ? (
        <p className="operatorRailBody">No table requests yet. Each one also comes to your email.</p>
      ) : (
        <ul className="operatorRailRequestList">
          {current.requests.map((request) => (
            <li key={request.id} className="operatorRailRequest">
              <p className="operatorRailRequestLine">
                {request.name}, {request.partySize} people, {tableRequestDayLabel(request.date)} at {request.time}
              </p>
              {request.note ? <p className="operatorRailBody">{request.note}</p> : null}
              <a
                className="operatorRailRequestReply"
                href={request.contactKind === "email" ? `mailto:${request.contactValue}` : `tel:${request.contactValue}`}
              >
                {request.contactKind === "email" ? "Reply by email" : "Ring them back"}: {request.contactValue}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

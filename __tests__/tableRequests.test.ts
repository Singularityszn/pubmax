import { describe, expect, it } from "vitest";
import { tableRequestPartySizeInText } from "@/lib/tableRequestIntent";

// The pure leaf behind "Ask the pub for a table" (lib/tableRequests.ts): the
// one validator the form and the route share, and every word a request is
// sent in. The route's own proof is __tests__/tableRequestsRoute.test.ts.

import {
  TABLE_REQUEST_FREE_LINE,
  TABLE_REQUEST_MAX_DAYS_AHEAD,
  TABLE_REQUEST_NOT_SENT_LINE,
  TABLE_REQUEST_OPERATOR_FOOTER,
  tableRequestDateBounds,
  tableRequestMailtoHref,
  tableRequestOperatorEmail,
  toOperatorTableRequest,
  validateTableRequest,
  type TableRequest,
} from "@/lib/tableRequests";

const NOW = Date.parse("2026-11-02T18:00:00.000Z");
const USER = "a1111111-1111-4111-8111-111111111111";

describe("tableRequestPartySizeInText", () => {
  it.each([
    ["A table for 8 near Soho on Friday", 8],
    ["Where in Soho can 8 of us book a table on Friday?", 8],
    ["Table for 8 people please", 8],
    ["Can we get a table for eight?", 8],
    ["Reserve for a party of 10", 10],
    ["A booking for six on Friday", 6],
    ["A reservation for twenty", 20],
    ["Table for 12", 12],
    ["A table for 6", 6],
    ["A table for 20", 20],
    ["Book a table for 8 on 12/11", 8],
    ["Book a table for eight on 12/11", 8],
    ["Can eight people book a table on 12/11?", 8],
    ["Book a table for a group of eight on 12/11", 8],
    ["A table for 5", null],
    ["A table for 21", null],
    ["A table for twenty-one", null],
    ["A table for twenty one", null],
    ["Book a table for 6-8", null],
    ["Book a table for 6 - 8", null],
    ["Book a table for 6–8", null],
    ["Book a table for 6 to 8", null],
    ["Book a table for six to eight", null],
    ["Book a table for 6/8", null],
    ["Book a table for six or eight", null],
    ["Book a table for 6 or 8", null],
    ["Can 6-8 people book a table?", null],
    ["Can six to eight of us book a table?", null],
    ["Can twenty one people book a table?", null],
    ["Can thirty six people book a table?", null],
    ["Can one hundred and six of us book a table?", null],
    ["A table for twenty one, or a table for eight", null],
    ["A table for 8.5", null],
    ["A table for 8.00", null],
    ["Can 8.00 people book a table?", null],
    ["Can 8.00 of us book a table?", null],
    ["Can 8.00 mates book a table?", null],
    ["Book a table for 8.00 for ten people", 10],
    ["Can 8.00 people book a table for ten?", 10],
    ["A table for 8:00", null],
    ["Can 8:10 people book a table?", null],
    ["Can 8:10 of us book a table?", null],
    ["Can 8:10 mates book a table?", null],
    ["Book a table for 8:00 for ten people", 10],
    ["Can 8:10 people book a table for ten?", 10],
    ["8 of us fancy a pint on Friday", null],
    ["A table at 8pm on Friday", null],
    ["Book a table under £8", null],
    ["Book a table at 20:00", null],
    ["Book a table for 20:00", null],
    ["Book a table for 8 pm", null],
    ["Book a table for eight pm", null],
    ["A table for 8.30pm", null],
    ["A table for eight p.m.", null],
    ["A table for 8+", null],
    ["A table for 8:30am", null],
    ["A table for eight a.m.", null],
    ["A table for eight:30 pm", null],
    ["A table for eight.30 pm", null],
    ["A table for a party of eight+", null],
    ["A table for a group of 8-", null],
    ["A table for eight–", null],
    ["A table for 8/", null],
    ["A table for 8+ or a table for ten", null],
    ["Book a table for eight p.m. for ten people", 10],
    ["Book a table for 8.30pm for ten people", 10],
    ["Book a table for eight am", null],
    ["Book a table for eight o'clock", null],
    ["Book a table for 8 o'clock", null],
    ["Book a table for eight o’clock", null],
    ["Book a table for six pm for eight people", 8],
    ["Book a table for 6 pm for 8 people", 8],
    ["Book a table for six o'clock for eight mates", 8],
    ["Book a table for a party of eight pm", null],
    ["Book a table for a group of eight pm", null],
    ["Get a table for 6 or 8 people", null],
    ["Can I book a table?", null],
    ["", null],
  ])("reads a group size from %s", (text, expected) => {
    expect(tableRequestPartySizeInText(text)).toBe(expected);
  });
});

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venueId: "venue-crown",
    name: "  Sam <b>Jones</b> ",
    partySize: "8",
    date: "2026-11-14",
    time: "19:30",
    note: "",
    contact: { kind: "email", value: " Sam@Example.COM " },
    ...over,
  };
}

describe("validateTableRequest", () => {
  it("cleans and normalises a good request, binding the account from the session", () => {
    const result = validateTableRequest({ ...body(), requesterUserId: "someone-else" }, USER, NOW);
    expect(result).toEqual({
      ok: true,
      fields: {
        venueId: "venue-crown",
        requesterUserId: USER,
        name: "Sam bJones/b",
        partySize: 8,
        date: "2026-11-14",
        time: "19:30",
        note: null,
        contactKind: "email",
        contactValue: "sam@example.com",
      },
    });
  });

  it("collapses a phone to its digits and keeps the country plus", () => {
    const result = validateTableRequest(body({ contact: { kind: "phone", value: "+44 (0)7700 900-123" } }), USER, NOW);
    expect(result.ok && result.fields.contactValue).toBe("+4407700900123");
  });

  it.each([
    [5, false],
    [6, true],
    [20, true],
    [21, false],
    ["12", true],
    [8.5, false],
    [null, false],
  ])("party size %s is accepted: %s", (partySize, ok) => {
    expect(validateTableRequest(body({ partySize }), USER, NOW).ok).toBe(ok);
  });

  it("takes today and refuses yesterday and a day past the window, in London", () => {
    expect(validateTableRequest(body({ date: "2026-11-02" }), USER, NOW).ok).toBe(true);
    const past = validateTableRequest(body({ date: "2026-11-01" }), USER, NOW);
    expect(past).toMatchObject({ ok: false, field: "date" });
    const { max } = tableRequestDateBounds(NOW);
    expect(validateTableRequest(body({ date: max }), USER, NOW).ok).toBe(true);
    const beyond = new Date(Date.parse(`${max}T12:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(validateTableRequest(body({ date: beyond }), USER, NOW)).toMatchObject({ ok: false, field: "date" });
    expect(TABLE_REQUEST_MAX_DAYS_AHEAD).toBeGreaterThan(30);
  });

  it("refuses an empty account, a missing pub, a bad time and an unknown contact kind", () => {
    expect(validateTableRequest(body(), " ", NOW).ok).toBe(false);
    expect(validateTableRequest(body({ venueId: "" }), USER, NOW)).toMatchObject({ field: "venueId" });
    expect(validateTableRequest(body({ time: "19:60" }), USER, NOW)).toMatchObject({ field: "time" });
    expect(validateTableRequest(body({ contact: "sam@example.com" }), USER, NOW)).toMatchObject({ field: "contact" });
    expect(validateTableRequest(body({ contact: { kind: "post", value: "1 High St" } }), USER, NOW)).toMatchObject({
      field: "contact",
    });
  });
});

describe("the words a request is sent in", () => {
  const request = {
    name: "Sam",
    partySize: 8,
    date: "2026-11-14",
    time: "19:30",
    note: "Birthday <script>",
    contactKind: "email" as const,
    contactValue: "sam@example.com",
  };

  it("names the pub, the crew, the day and the way to reply, and says nothing is paid", () => {
    const email = tableRequestOperatorEmail("The Crown & Anchor", request);
    expect(email.subject).toBe("Table for 8 at The Crown & Anchor, Saturday 14 November");
    expect(email.text).toContain("Sam would like a table for 8 on Saturday 14 November at 19:30.");
    expect(email.text).toContain("Reply by email to sam@example.com.");
    expect(email.text).toContain(TABLE_REQUEST_OPERATOR_FOOTER);
    expect(email.html).toContain("The Crown &amp; Anchor");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("builds the person's own prefilled email to the pub's published address", () => {
    const href = tableRequestMailtoHref("mailto:bar@thecrown.example", "The Crown", request);
    expect(href.startsWith("mailto:bar@thecrown.example?subject=")).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe("Table for 8 at The Crown, Saturday 14 November");
    expect(url.searchParams.get("body")).toContain("Reply by email to sam@example.com.");
    expect(url.searchParams.get("body")).not.toContain("PUBMAXX");
  });

  it("says plainly what is free and what PUBMAXX did not do", () => {
    expect(TABLE_REQUEST_FREE_LINE).toMatch(/Free\./);
    expect(TABLE_REQUEST_FREE_LINE).toMatch(/no payment/);
    expect(TABLE_REQUEST_NOT_SENT_LINE).toBe("PUBMAXX did not send this.");
  });
});

describe("the operator's view of a request", () => {
  it("carries the name and the chosen contact, never the account id", () => {
    const stored: TableRequest = {
      id: "r1",
      venueId: "venue-crown",
      requesterUserId: USER,
      name: "Sam",
      partySize: 8,
      date: "2026-11-14",
      time: "19:30",
      note: null,
      contactKind: "phone",
      contactValue: "+447700900123",
      delivery: "emailed",
      createdAt: "2026-11-02T18:00:00.000Z",
      deliveredAt: "2026-11-02T18:00:01.000Z",
    };
    const view = toOperatorTableRequest(stored);
    expect(view).not.toHaveProperty("requesterUserId");
    expect(JSON.stringify(view)).not.toContain(USER);
    expect(view).toMatchObject({ name: "Sam", contactKind: "phone", contactValue: "+447700900123" });
  });
});

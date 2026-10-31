// THE LINK LEDGER AND THE LISTING RECORD (docs/growth/BACKLINK_PLAYBOOK.md).
//
// Tactics 5 and 27 ask for one log of every pitch, request and placed link, so
// nobody pitches the same request twice and a delivered link can be checked
// again later. Tactic 69 asks that every directory listing says the same thing.
// The ledger is docs/growth/backlinks/ledger.csv and the listing is
// docs/growth/backlinks/listing.json; this fence holds both to their shape, and
// holds the listing to the site's own contact constants so the two cannot drift.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTACT_EMAIL, HELLO_EMAIL } from "@/lib/siteContact";

const DIR = join(process.cwd(), "docs/growth/backlinks");

const HEADER = [
  "id", "tactic", "logged_on", "kind", "source_url", "destination_path",
  "context", "status", "checked_on", "notes",
] as const;
type Row = Record<(typeof HEADER)[number], string>;

const KINDS = new Set(["placement", "roundup", "journalist", "recovery", "replacement", "asset", "listing"]);
const STATUSES = new Set(["pitched", "accepted", "live", "declined", "lost"]);

/** RFC 4180 lines: a field may be quoted, and a quote inside one is doubled. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { fields.push(field); field = ""; }
    else field += char;
  }
  fields.push(field);
  return fields;
}

function readLedger(): { header: string[]; rows: Row[] } {
  const lines = readFileSync(join(DIR, "ledger.csv"), "utf8").split("\n").filter((line) => line.trim() !== "");
  const [first = "", ...rest] = lines;
  const header = parseCsvLine(first);
  const rows = rest.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(HEADER.map((key, index) => [key, cells[index] ?? ""])) as Row;
  });
  return { header, rows };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = new Date().toISOString().slice(0, 10);

describe("the link ledger", () => {
  const { header, rows } = readLedger();

  it("keeps its header, so a spreadsheet and this fence read the same columns", () => {
    expect(header).toEqual([...HEADER]);
  });

  it("gives every row a unique id and a tactic from the playbook", () => {
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of rows) {
      expect(row.id, "id").toMatch(/^[a-z0-9-]+$/);
      const tactic = Number(row.tactic);
      expect(Number.isInteger(tactic) && tactic >= 1 && tactic <= 69, `${row.id} tactic`).toBe(true);
    }
  });

  it("dates every row on a real day that has happened", () => {
    for (const row of rows) {
      expect(row.logged_on, `${row.id} logged_on`).toMatch(ISO_DAY);
      expect(row.logged_on <= today, `${row.id} logged_on is in the future`).toBe(true);
      if (row.checked_on) {
        expect(row.checked_on, `${row.id} checked_on`).toMatch(ISO_DAY);
        expect(row.checked_on >= row.logged_on && row.checked_on <= today, `${row.id} checked_on`).toBe(true);
      }
    }
  });

  it("uses the closed kinds and statuses", () => {
    for (const row of rows) {
      expect(KINDS.has(row.kind), `${row.id} kind ${row.kind}`).toBe(true);
      expect(STATUSES.has(row.status), `${row.id} status ${row.status}`).toBe(true);
    }
  });

  it("names an outside https page and a path on our own site", () => {
    for (const row of rows) {
      const source = new URL(row.source_url);
      expect(source.protocol, `${row.id} source_url`).toBe("https:");
      expect(source.hostname.endsWith("pubmaxxing.com"), `${row.id} links to itself`).toBe(false);
      expect(row.destination_path, `${row.id} destination_path`).toMatch(/^\/[^\s]*$/);
    }
  });

  it("calls a link live only once somebody checked it", () => {
    for (const row of rows.filter((entry) => entry.status === "live")) {
      expect(row.checked_on, `${row.id} is live with no checked_on`).not.toBe("");
    }
  });

  it("pitches one journalist request once", () => {
    const requests = rows.filter((row) => row.kind === "journalist").map((row) => row.source_url);
    expect(new Set(requests).size).toBe(requests.length);
  });
});

describe("the listing record", () => {
  const listing = JSON.parse(readFileSync(join(DIR, "listing.json"), "utf8")) as Record<string, unknown>;

  it("names the product and the site the way every other surface does", () => {
    expect(listing.name).toBe("PUBMAXX");
    expect(listing.url).toBe("https://pubmaxxing.com");
  });

  it("reads its addresses from the site's own contact constants", () => {
    expect(listing.email).toBe(HELLO_EMAIL);
    expect(listing.pressEmail).toBe(CONTACT_EMAIL);
  });

  it("links only to pages on the site", () => {
    for (const url of Object.values(listing.links as Record<string, string>)) {
      expect(url.startsWith("https://pubmaxxing.com/")).toBe(true);
    }
  });
});

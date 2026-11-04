import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// A TABLE REQUEST CHANGES NOTHING ELSE AND CHARGES NOTHING (launch plan 1 Nov
// 2026, section 7 item 3; docs/adr/0011-venue-operator-rail.md;
// docs/SPONSORSHIP_POLICY.md, the never-changes list). "Ask the pub for a
// table" is a message from a crew to a pub. This source fence holds that:
//
//   1. Only the files below may import a table-request module. A ranker, a
//      pin colour, a price band or a list order that reached for one would
//      fail here before it could read a single row.
//   2. The modules that rank, colour, band or order a venue name no table
//      request at all.
//   3. Nothing in the lane is paid: no table-request module reaches the
//      sponsorship rail, a checkout or a card, and none names a fee in code.

const ROOT = process.cwd();

const TABLE_REQUEST_MODULES = [
  "@/lib/tableRequests",
  "@/lib/tableRequestsStore",
  "@/lib/tableRequestDelivery.server",
  "@/lib/operatorAccountAddress.server",
  "./TableRequestDialog",
  "./OperatorTableRequests",
];

/** Every file allowed to import a table-request module, and why. */
const ALLOWED_IMPORTERS: Record<string, string> = {
  "lib/tableRequestsStore.ts": "the store",
  "lib/tableRequestDelivery.server.ts": "the delivery: the operator, the email and the store",
  "app/api/table-requests/route.ts": "the one route: the request and the operator's read",
  "components/map/inspector/VenueActionCard.tsx": "the card's door, and the form behind it",
  "components/map/inspector/TableRequestDialog.tsx": "the form",
  "components/operators/OperatorTableRequests.tsx": "the operator panel's list",
  "components/operators/OperatorRailPanel.tsx": "mounts the list for a verified operator",
  "lib/accountExport.ts": "the export lane's type: the requester's own fields",
  "lib/accountExport.server.ts": "the export lane: the requester's own requests",
};

/** What ranks, colours, bands or orders a venue. None may name a table request. */
const NEVER_CHANGES_MODULES = [
  "lib/forYou.ts",
  "lib/concierge/rank.ts",
  "lib/nearMeAnswer.ts",
  "lib/priceTier.ts",
  "lib/priceBand.ts",
  "lib/pintTrust.ts",
  "lib/venues.ts",
  "lib/slimPins.ts",
  "lib/tonightListGrouping.ts",
  "lib/tonightOutListings.ts",
  "lib/tonightCheapPints.ts",
  "lib/hypedPubs.ts",
  "lib/dealsHonesty.ts",
  "lib/venuePriceLane.ts",
];
const NEVER_CHANGES_DIRECTORIES = ["components/map/canvas"];

const TABLE_REQUEST_FILES = [
  "lib/tableRequests.ts",
  "lib/tableRequestsStore.ts",
  "lib/tableRequestDelivery.server.ts",
  "lib/operatorAccountAddress.server.ts",
  "app/api/table-requests/route.ts",
  "components/map/inspector/TableRequestDialog.tsx",
  "components/operators/OperatorTableRequests.tsx",
];

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** The code alone: a comment that explains the rule is not a breach of it. */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === "node_modules") continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(relative(ROOT, join(ROOT, rel)));
  }
}

function importsTableRequests(text: string): boolean {
  return TABLE_REQUEST_MODULES.some(
    (mod) =>
      text.includes(`from "${mod}"`) ||
      text.includes(`from '${mod}'`) ||
      text.includes(`import("${mod}")`),
  );
}

describe("a table request changes nothing else", () => {
  it("is imported only by its own store, delivery, route, form and panel", () => {
    const files: string[] = [];
    for (const dir of ["app", "components", "lib"]) walk(dir, files);
    const importers = files.filter((file) => importsTableRequests(source(file))).sort();
    expect(importers).toEqual(Object.keys(ALLOWED_IMPORTERS).sort());
  });

  it("is never named by what ranks, colours, bands or orders a venue", () => {
    const files = [...NEVER_CHANGES_MODULES];
    for (const dir of NEVER_CHANGES_DIRECTORIES) walk(dir, files);
    for (const file of files) {
      expect(source(file), file).not.toMatch(/tableRequest|table_requests|TableRequest|for a table/i);
    }
  });
});

describe("a table request charges nothing", () => {
  it("reaches no sponsorship rail, checkout or card, and names no fee in code", () => {
    for (const file of TABLE_REQUEST_FILES) {
      const text = code(file);
      expect(text, file).not.toContain("@/lib/sponsorship");
      expect(text, file).not.toMatch(/stripe|checkout|paymentIntent|cardNumber/i);
      expect(text, file).not.toMatch(/\b(?:fee|deposit|amountPence|priceGbp|charge)\b\s*[:=(]/i);
    }
  });

  it("says out loud that it is free and takes no payment", () => {
    const leaf = source("lib/tableRequests.ts");
    expect(leaf).toMatch(/TABLE_REQUEST_FREE_LINE\s*=\s*\n?\s*"[^"]*Free\.[^"]*no payment/);
    expect(leaf).toMatch(/TABLE_REQUEST_OPERATOR_FOOTER\s*=\s*\n?\s*"[^"]*no booking and no payment/);
  });
});

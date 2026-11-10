// A Guinndex price reaches a pub only when the page dates it, the pub is the
// same pub, and no fresher price on record says otherwise.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { readGuinndexObservation } from "@/lib/harvest/guinndex";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { indexCandidates, matchGuinndexPub, venueCandidates, writeGuinndexCache } from "../scripts/build_guinndex_prices.mjs";
import { addListingSiteRows } from "../scripts/build_uk_price_bundle.mjs";

const NOW = Date.parse("2026-11-09T12:00:00Z");

function detail(pub: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    pub: { slug: "the-pub-london", guinness_price_cents: 650, currency: "GBP", price_source: "crowdsourced", ...pub },
    price_history: [],
    drink_prices: [],
    ...extra,
  };
}

const guinness = (cents: number, at: string) => ({ drink_type: "stout", drink_brand: "Guinness", price_cents: cents, created_at: at });

describe("Guinndex cache-only build", () => {
  const root = process.cwd();
  const committedPack = readFileSync(path.join(root, "data/uk_prices/guinndex.json"));
  const previousReport = '[{"slug":"keep-existing-report"}]\n';
  const pub = { slug: "the-pub-london", name: "The Pub", lat: 51.5, lng: -0.1, guinness_price_cents: 650 };

  function runBuilder(cwd: string) {
    return spawnSync(process.execPath, [
      "--import", createRequire(import.meta.url).resolve("tsx"),
      path.join(root, "scripts/build_guinndex_prices.mjs"),
    ], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json") },
    });
  }

  function fixture() {
    const cwd = mkdtempSync(path.join(root, ".guinndex-build-test-"));
    mkdirSync(path.join(cwd, "data/uk_prices"), { recursive: true });
    writeFileSync(path.join(cwd, "data/uk_prices/guinndex.json"), committedPack);
    mkdirSync(path.join(cwd, "public/data"), { recursive: true });
    writeFileSync(path.join(cwd, "public/data/venues_slim.json"), JSON.stringify({
      rows: [{ id: "venue-the-pub", name: pub.name, lat: pub.lat, lng: pub.lng }],
    }));
    return cwd;
  }

  it.each(["missing", "empty", "county-only", "pub-only", "no-listed-pubs", "undated-prices"])(
    "refuses a %s cache without changing the committed pack or report",
    (state) => {
      const cwd = fixture();
      const cache = path.join(cwd, "data-harvest/guinndex");
      try {
        if (state !== "missing") {
          mkdirSync(path.join(cache, "county"), { recursive: true });
          mkdirSync(path.join(cache, "pub"), { recursive: true });
          writeFileSync(path.join(cache, "unmatched.json"), previousReport);
        }
        if (["county-only", "no-listed-pubs", "undated-prices"].includes(state)) {
          writeGuinndexCache(cache, "county", "Greater London", { pubs: state === "no-listed-pubs" ? [] : [pub] });
        }
        if (["pub-only", "no-listed-pubs", "undated-prices"].includes(state)) {
          writeGuinndexCache(cache, "pub", pub.slug, detail(pub));
        }

        const result = runBuilder(cwd);
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain(
          ["no-listed-pubs", "undated-prices"].includes(state)
            ? "cache produced no publishable prices"
            : "cache requires county lists and pub pages",
        );
        expect(readFileSync(path.join(cwd, "data/uk_prices/guinndex.json"))).toEqual(committedPack);
        if (state === "missing") {
          expect(() => readFileSync(path.join(cache, "unmatched.json"))).toThrow();
        } else {
          expect(readFileSync(path.join(cache, "unmatched.json"), "utf8")).toBe(previousReport);
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it("rebuilds a matched, dated price from both cache inputs", () => {
    const cwd = fixture();
    const cache = path.join(cwd, "data-harvest/guinndex");
    try {
      writeGuinndexCache(cache, "county", "Greater London", { pubs: [pub] });
      writeGuinndexCache(cache, "pub", pub.slug, detail(pub, {
        drink_prices: [guinness(650, "2026-06-01T09:00:00Z")],
      }));

      const result = runBuilder(cwd);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const pack = JSON.parse(readFileSync(path.join(cwd, "data/uk_prices/guinndex.json"), "utf8"));
      expect(pack.rows).toEqual([{
        venueId: "venue-the-pub",
        venueName: "The Pub",
        london: true,
        sourceUrl: "https://guinndex.co.uk/pub/the-pub-london",
        priceGbp: 6.5,
        observedAt: "2026-06-01T09:00:00.000Z",
        drinkLabel: "Guinness",
        servingSize: "Pint",
        priceSource: "crowdsourced",
      }]);
      expect(JSON.parse(readFileSync(path.join(cache, "unmatched.json"), "utf8"))).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("Guinndex persisted cache contract", () => {
  it("persists only approved facts in county and pub responses", () => {
    const dir = mkdtempSync(path.join(process.cwd(), ".guinndex-cache-test-"));
    const pub = { slug: "the-pub-london", name: "The Pub", lat: 51.5, lng: -0.1, formatted_address: "London SW1A 1AA", guinness_price_cents: 650, currency: "GBP", price_source: "crowdsourced" };
    const record = guinness(650, "2026-06-01T09:00:00Z");
    const unrelated = { google_place_id: "secret-place", rating: 5, opening_hours: ["always"], phone: "012345", photos: ["photo"], taps: ["lager"] };
    try {
      writeGuinndexCache(dir, "county", "Greater London", { pubs: [{ ...pub, ...unrelated }], ...unrelated });
      expect(JSON.parse(readFileSync(path.join(dir, "county/Greater%20London.json"), "utf8"))).toEqual({ pubs: [pub] });
      writeGuinndexCache(dir, "pub", pub.slug, {
        pub: { ...pub, ...unrelated },
        ...unrelated,
        drink_prices: [{ ...record, contributor: "private-name", ...unrelated }, { ...record, drink_brand: "Other tap" }],
        price_history: [{ new_price_cents: 650, created_at: record.created_at, contributor: "private-name" }],
      });
      const cached = JSON.parse(readFileSync(path.join(dir, `pub/${pub.slug}.json`), "utf8"));
      expect(cached).toEqual({
        pub,
        drink_prices: [record],
        price_history: [{ new_price_cents: 650, created_at: record.created_at, flag_reason: null }],
      });
      expect(readGuinndexObservation(cached, NOW)).toEqual({
        ok: true,
        observation: { slug: pub.slug, priceGbp: 6.5, observedAt: "2026-06-01T09:00:00.000Z", priceSource: "crowdsourced" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    { pub: { price_source: "ai_call", call_completed_at: "2026-06-01T09:00:00Z" }, extra: {}, expected: { ok: true, observation: { slug: "the-pub-london", priceGbp: 6.5, observedAt: "2026-06-01T09:00:00.000Z", priceSource: "ai_call" } } },
    { pub: { price_source: "placeholder" }, extra: { price_history: [{ new_price_cents: 650, created_at: "2026-06-01T09:00:00Z" }] }, expected: { ok: false, reason: "placeholder" } },
    { pub: {}, extra: { price_history: [{ new_price_cents: 650, created_at: "2026-06-01T09:00:00Z", flag_reason: "untrusted submission" }] }, expected: { ok: false, reason: "flagged" } },
    { pub: {}, extra: { drink_prices: [guinness(700, "2026-06-01T09:00:00Z")] }, expected: { ok: false, reason: "newer-record-disagrees" } },
    { pub: { business_status: "CLOSED_PERMANENTLY" }, extra: {}, expected: { ok: false, reason: "closed" } },
    { pub: { currency: "EUR" }, extra: {}, expected: { ok: false, reason: "not-gbp" } },
  ])("preserves the observation decision after trimming: $expected", ({ pub, extra, expected }) => {
    const dir = mkdtempSync(path.join(process.cwd(), ".guinndex-cache-test-"));
    try {
      writeGuinndexCache(dir, "pub", "the-pub-london", detail(pub, extra));
      const cached = JSON.parse(readFileSync(path.join(dir, "pub/the-pub-london.json"), "utf8"));
      expect(readGuinndexObservation(cached, NOW)).toEqual(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readGuinndexObservation", () => {
  it.each([
    { price_history: [{ new_price_cents: 650, created_at: "2026-06-01T09:00:00Z" }] },
    { drink_prices: [guinness(650, "2026-06-01T09:00:00Z")] },
    {},
  ])("skips placeholder provenance before accepting any timestamp: %j", (extra) => {
    expect(readGuinndexObservation(detail({ price_source: "placeholder" }, extra), NOW)).toEqual({
      ok: false,
      reason: "placeholder",
    });
  });

  it("takes the headline price dated by the newest record that states it", () => {
    const read = readGuinndexObservation(
      detail({}, { drink_prices: [guinness(650, "2026-04-22T10:35:15Z"), guinness(650, "2026-06-01T09:00:00Z")] }),
      NOW,
    );
    expect(read).toEqual({
      ok: true,
      observation: { slug: "the-pub-london", priceGbp: 6.5, observedAt: "2026-06-01T09:00:00.000Z", priceSource: "crowdsourced" },
    });
  });

  it("never dates a price from the record's own update stamp", () => {
    expect(readGuinndexObservation(detail({ updated_at: "2026-07-05T18:49:54Z", price_source: "ai_call" }), NOW)).toEqual({
      ok: false,
      reason: "undated",
    });
  });

  it("dates a phoned price by the finished call", () => {
    const read = readGuinndexObservation(detail({ price_source: "ai_call", call_completed_at: "2026-03-17T20:00:00Z" }), NOW);
    expect(read.ok && read.observation.observedAt).toBe("2026-03-17T20:00:00.000Z");
  });

  it("skips a price a newer record contradicts", () => {
    const read = readGuinndexObservation(
      detail({}, { drink_prices: [guinness(650, "2026-04-01T00:00:00Z"), guinness(700, "2026-05-01T00:00:00Z")] }),
      NOW,
    );
    expect(read).toEqual({ ok: false, reason: "newer-record-disagrees" });
  });

  it("skips a price Guinndex itself flagged", () => {
    const read = readGuinndexObservation(
      detail(
        { guinness_price_cents: 860 },
        {
          price_history: [{ new_price_cents: 860, flag_reason: "Price too high: £8.60", created_at: "2026-04-22T10:35:14Z" }],
          drink_prices: [guinness(860, "2026-04-22T10:35:15Z")],
        },
      ),
      NOW,
    );
    expect(read).toEqual({ ok: false, reason: "flagged" });
  });

  it("skips a figure outside the pint band, a closed pub and a date in the future", () => {
    const dated = { drink_prices: [guinness(150, "2026-04-01T00:00:00Z")] };
    expect(readGuinndexObservation(detail({ guinness_price_cents: 150 }, dated), NOW)).toEqual({ ok: false, reason: "implausible-price" });
    expect(
      readGuinndexObservation(detail({ business_status: "CLOSED_PERMANENTLY" }, { drink_prices: [guinness(650, "2026-04-01T00:00:00Z")] }), NOW),
    ).toEqual({ ok: false, reason: "closed" });
    expect(readGuinndexObservation(detail({}, { drink_prices: [guinness(650, "2027-01-01T00:00:00Z")] }), NOW)).toEqual({
      ok: false,
      reason: "undated",
    });
  });
});

describe("matchGuinndexPub", () => {
  const grid = indexCandidates(
    venueCandidates({
      baseRows: [
        ["n1", "The Kings Ford", "250 Chingford Mount Road, E4 8JL", 51.6200, -0.0130, ""],
        ["n2", "The Red Lion", "1 High Street, SW1A 1AA", 51.5000, -0.1400, "venue-curated-red-lion"],
        ["n3", "Red Lion", "2 High Street, SW1A 1AB", 51.50005, -0.14005, ""],
        ["n4", "The Crown", "9 Other Road, N1 1AA", 51.5400, -0.1000, ""],
      ],
      slimRows: [{ id: "venue-slim-only", name: "The Harp", lat: 51.5100, lng: -0.1250, filterHints: { searchText: "the harp 47 chandos place wc2n 4hs" } }],
    }),
  );

  it("matches the same pub under an operator suffix and a dropped apostrophe", () => {
    expect(
      matchGuinndexPub({ name: "The King's Ford - JD Wetherspoon", lat: 51.6201, lng: -0.0131, formatted_address: "250-252 Chingford Mount Rd, London E4 8JL, UK" }, grid),
    ).toMatchObject({ ok: true, venueId: "venue-uk-n1" });
  });

  it("matches a curated venue that no base pub hands to", () => {
    expect(matchGuinndexPub({ name: "The Harp", lat: 51.5101, lng: -0.1251, formatted_address: "47 Chandos Pl, London WC2N 4HS, UK" }, grid)).toMatchObject({
      ok: true,
      venueId: "venue-slim-only",
    });
  });

  it.each([
    ["The King's Arms, Woodstock", "Woodstock Arms", false],
    ["Woodstock Arms", "The King's Arms, Woodstock", false],
    ["The King's Arms, Woodstock", "Woodstock Arms", true],
    ["Woodstock Arms", "The King's Arms, Woodstock", true],
  ])("refuses locality-only name overlap: %s versus %s (curated: %s)", (name, candidateName, curated) => {
    const candidates = indexCandidates(venueCandidates({
      baseRows: curated ? [] : [["n34043327", candidateName, "8 Market Street, Woodstock OX20 1SX", 51.84753, -1.35521, ""]],
      slimRows: curated ? [{ id: "venue-woodstock", name: candidateName, lat: 51.84753, lng: -1.35521 }] : [],
    }));
    expect(matchGuinndexPub({
      name, lat: 51.8479246, lng: -1.3546192, formatted_address: "19 Market St, Woodstock OX20 1SU, UK",
    }, candidates)).toEqual({ ok: false, reason: "no-venue" });
  });

  it.each([
    ["The Old Hat, Ealing", "Old Hat"],
    ["Old Hat", "The Old Hat, Ealing"],
    ["Old Hat Ealing", "Old Hat"],
    ["Old Hat", "Old Hat Ealing"],
  ])("keeps near-name matches for the same pub: %s versus %s", (name, candidateName) => {
    const candidates = indexCandidates(venueCandidates({
      baseRows: [],
      slimRows: [{ id: "venue-same-pub", name: candidateName, lat: 51.5, lng: -0.1 }],
    }));
    expect(matchGuinndexPub({ name, lat: 51.5001, lng: -0.1001 }, candidates))
      .toMatchObject({ ok: true, venueId: "venue-same-pub" });
  });

  it("keeps the wider exact-name radius when both names include a locality", () => {
    const candidates = indexCandidates(venueCandidates({
      baseRows: [["n1", "The King's Arms, Woodstock", "", 51.5, -0.1, ""]],
      slimRows: [],
    }));
    expect(matchGuinndexPub({ name: "The King's Arms, Woodstock", lat: 51.501, lng: -0.1 }, candidates))
      .toMatchObject({ ok: true, venueId: "venue-uk-n1" });
    expect(matchGuinndexPub({ name: "Kings Arms", lat: 51.501, lng: -0.1 }, candidates))
      .toEqual({ ok: false, reason: "no-venue" });
  });

  it("refuses two pubs of one name side by side", () => {
    expect(matchGuinndexPub({ name: "Red Lion", lat: 51.50002, lng: -0.14002, formatted_address: "London SW1A 1AA, UK" }, grid)).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("refuses a shared name in another postcode district or too far away", () => {
    expect(matchGuinndexPub({ name: "The Crown", lat: 51.5401, lng: -0.1001, formatted_address: "London N7 1AA, UK" }, grid)).toEqual({
      ok: false,
      reason: "no-venue",
    });
    expect(matchGuinndexPub({ name: "The Crown", lat: 51.5430, lng: -0.1000, formatted_address: "London N1 1AA, UK" }, grid)).toEqual({
      ok: false,
      reason: "no-venue",
    });
  });
});

describe("addListingSiteRows", () => {
  const row = (venueId: string, observedAt = "2026-06-01T09:00:00.000Z", sourceUrl = "https://guinndex.co.uk/pub/the-pub-london") => ({
    venueId,
    venueName: "The Pub",
    sourceUrl,
    priceGbp: 6.5,
    observedAt,
    drinkLabel: "Guinness",
    servingSize: "Pint",
  });

  function run(rows: Record<string, unknown>[], baselineDays = new Map<string, string>()) {
    const pushed: UkPriceBundleRow[] = [];
    const report = { droppedRefusedHost: 0, droppedUnresolvedVenue: 0, droppedOlderThanOnRecord: 0 };
    addListingSiteRows(rows, {
      owners: new Map([["n9", "venue-curated-nine"]]),
      servedRefs: new Set(["n1", "n9"]),
      venueAliases: { "venue-old": "venue-new" },
      baselineDays,
      push: (pushedRow) => pushed.push(pushedRow),
      report,
    });
    return { pushed, report };
  }

  it("writes a listed Guinness pint credited to Guinndex under the venue that serves the pub", () => {
    const { pushed } = run([row("venue-uk-n9"), row("venue-old"), row("venue-uk-n1")]);
    expect(pushed.map((pushedRow) => pushedRow.venueId)).toEqual(["venue-curated-nine", "venue-new", "venue-uk-n1"]);
    expect(pushed[0]).toMatchObject({
      category: "beer",
      lane: "listing-site",
      standing: "listed",
      publisher: "Guinndex",
      sourceUrl: "https://guinndex.co.uk/pub/the-pub-london",
      drinkLabel: "Guinness",
      servingSize: "Pint",
      observedAt: "2026-06-01T09:00:00.000Z",
    });
  });

  it("drops a row off the registered host, a pub that left the base layer, and one older than the price on record", () => {
    const { pushed, report } = run(
      [row("venue-uk-n1", undefined, "https://example.com/pub/x"), row("venue-uk-n404"), row("venue-curated", "2026-06-01T09:00:00.000Z")],
      new Map([["venue-curated", "2026-10-02"]]),
    );
    expect(pushed).toEqual([]);
    expect(report).toEqual({ droppedRefusedHost: 1, droppedUnresolvedVenue: 1, droppedOlderThanOnRecord: 1 });
  });
});

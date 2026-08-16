import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMMON_SITEMAP_URL,
  COMMON_SOURCE,
  COMMON_TIME_EVIDENCE,
  COMMON_USER_AGENT,
  commonCrawlOrder,
  commonStartsDate,
  isStaleCommonDate,
  parseCommonOgPrefix,
  parseCommonPostHtml,
  parseCommonSitemap,
  parseCommonSitemapEntries,
  refreshCommonEvents,
  toCommonEventRow,
} from "../scripts/whatson/commonRefresh.mjs";
import { isValidWhatsOnRow, parseWhatsOnRows } from "@/lib/whatsOn";

const TODAY = "2026-08-16";
const NOW = Date.parse("2026-08-16T10:00:00.000Z");

describe("OG prefix parse", () => {
  it("takes place and date from the OG prefix and ignores the rest", () => {
    expect(parseCommonOgPrefix("Hackney · 27 Aug — Saturday night with the regulars")).toEqual({
      placeName: "Hackney",
      dateText: "27 Aug",
    });
    expect(parseCommonOgPrefix("Peckham · 20 Aug · a long description we must never store")).toEqual({
      placeName: "Peckham",
      dateText: "20 Aug",
    });
  });

  it("returns null when the prefix is not place · date", () => {
    expect(parseCommonOgPrefix("Just a caption with no prefix")).toBeNull();
    expect(parseCommonOgPrefix("")).toBeNull();
  });
});

describe("common post HTML", () => {
  it("builds an event row from og:title plus the OG prefix and never stores the description", () => {
    const html = `
      <meta property="og:title" content="Sunday roast club" />
      <meta property="og:description" content="Camberwell · 20 Aug — Come down, bring a friend, names in the body" />
    `;
    const parsed = parseCommonPostHtml(html);
    expect(parsed).toEqual({
      title: "Sunday roast club",
      placeName: "Camberwell",
      dateText: "20 Aug",
    });
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const row = toCommonEventRow({
      url: "https://www.common-social.com/post/abc",
      parsed,
      observedAt: "2026-08-16T10:00:00.000Z",
      todayLondon: TODAY,
    });
    expect(row).toMatchObject({
      kind: "event",
      title: "Sunday roast club",
      placeName: "Camberwell",
      source: { label: "common", url: "https://www.common-social.com/post/abc" },
      confidence: "listed",
    });
    expect((row as { venueId?: string } | null)?.venueId).toBeUndefined();
    expect(JSON.stringify(row)).not.toMatch(/Come down/);
    expect(JSON.stringify(row)).not.toMatch(/bring a friend/);
    expect(JSON.stringify(row)).not.toMatch(/names in the body/);
    expect(isValidWhatsOnRow(row as unknown, NOW)).toBe(true);
  });

  it("drops a post whose date is before today", () => {
    expect(isStaleCommonDate("15 Aug", TODAY)).toBe(true);
    expect(isStaleCommonDate("16 Aug", TODAY)).toBe(false);
    expect(isStaleCommonDate("20 Aug", TODAY)).toBe(false);
    const row = toCommonEventRow({
      url: "https://www.common-social.com/post/old",
      parsed: { title: "Last week", placeName: "Soho", dateText: "10 Aug" },
      observedAt: "2026-08-16T10:00:00.000Z",
      todayLondon: TODAY,
    });
    expect(row).toBeNull();
  });
});

describe("a stated date is never a stated time", () => {
  it("carries the date and says the start time is not published", () => {
    const row = toCommonEventRow({
      url: "https://www.common-social.com/post/abc",
      parsed: { title: "Sunday roast club", placeName: "Camberwell", dateText: "20 Aug" },
      observedAt: "2026-08-16T10:00:00.000Z",
      todayLondon: TODAY,
    });
    expect(row).not.toBeNull();
    expect(row?.startsDate).toBe("2026-08-20");
    expect((row as unknown as { startsAt?: string })?.startsAt).toBeUndefined();
    expect(row?.timeEvidence).toBe(COMMON_TIME_EVIDENCE);
    expect(JSON.stringify(row)).not.toContain("20:00");
    expect(isValidWhatsOnRow(row as unknown, NOW)).toBe(true);
  });

  it("rolls the year forward for a day-month far behind today", () => {
    // Read in December, "5 Jan" is next month, not eleven months ago.
    expect(commonStartsDate("5 Jan", "2026-12-20")).toBe("2027-01-05");
    expect(isStaleCommonDate("5 Jan", "2026-12-20")).toBe(false);
    // A day-month just behind today is genuinely past, and still stale.
    expect(commonStartsDate("15 Dec", "2026-12-20")).toBe("2026-12-15");
    expect(isStaleCommonDate("15 Dec", "2026-12-20")).toBe(true);
  });
});

describe("refreshCommonEvents", () => {
  const NOW_MS = Date.parse("2026-08-16T10:00:00.000Z");

  function post(url: string) {
    return `<meta property="og:title" content="Night at ${url.slice(-3)}" />
      <meta property="og:description" content="Camberwell · 20 Aug - never stored" />`;
  }

  function makeFetch(urls: string[], seen: string[]) {
    const sitemap = `<urlset>${urls
      .map((url) => `<url><loc>${url}</loc></url>`)
      .join("")}</urlset>`;
    return async (target: string | URL) => {
      const href = String(target);
      if (href === COMMON_SITEMAP_URL) {
        return new Response(sitemap, { status: 200 });
      }
      seen.push(href);
      return new Response(post(href), { status: 200 });
    };
  }

  it("stamps its own generatedAt so the rows it just wrote still validate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "common-refresh-"));
    const outPath = join(dir, "events_london.json");
    writeFileSync(
      outPath,
      JSON.stringify({
        generatedAt: "2026-07-18T00:00:00.000Z",
        kind: "events",
        region: "greater-london",
        sources: [],
        rows: [],
      }),
    );
    const seen: string[] = [];
    await refreshCommonEvents({
      nowMs: NOW_MS,
      fetchImpl: makeFetch(["https://www.common-social.com/post/one"], seen) as typeof fetch,
      outPath,
      gapMs: 0,
    });
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.generatedAt).toBe(new Date(NOW_MS).toISOString());
    // The file's own stamp is what every reader dates its rows by, so the rows
    // this run wrote must survive that read.
    const parsed = parseWhatsOnRows(written, Date.parse(written.generatedAt));
    expect(parsed.map((row) => row.source.label)).toEqual(["common"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reuses a post it already holds and caps the rest, reporting both", async () => {
    const dir = mkdtempSync(join(tmpdir(), "common-refresh-"));
    const outPath = join(dir, "events_london.json");
    const held = toCommonEventRow({
      url: "https://www.common-social.com/post/one",
      parsed: { title: "Held", placeName: "Camberwell", dateText: "20 Aug" },
      observedAt: "2026-08-15T10:00:00.000Z",
      todayLondon: TODAY,
    });
    writeFileSync(
      outPath,
      JSON.stringify({
        generatedAt: "2026-08-15T10:00:00.000Z",
        kind: "events",
        region: "greater-london",
        sources: [],
        rows: [held],
      }),
    );
    const urls = [
      "https://www.common-social.com/post/one",
      "https://www.common-social.com/post/two",
      "https://www.common-social.com/post/thr",
    ];
    const seen: string[] = [];
    const report = await refreshCommonEvents({
      nowMs: NOW_MS,
      fetchImpl: makeFetch(urls, seen) as typeof fetch,
      outPath,
      gapMs: 0,
      maxFetches: 1,
    });
    // Undated sitemap: the budget walks from the end, so the newest untouched
    // post is read and the one already held is not re-fetched.
    expect(seen).toEqual(["https://www.common-social.com/post/thr"]);
    expect(report.reusedHeld).toBe(1);
    expect(report.fetched).toBe(1);
    expect(report.skippedOverBudget).toBe(1);
    expect(report.rows).toHaveLength(2);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("sitemap + UA", () => {
  it("keeps only /post/* locs", () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://www.common-social.com/post/one</loc></url>
        <url><loc>https://www.common-social.com/</loc></url>
        <url><loc>https://www.common-social.com/friends</loc></url>
        <url><loc>https://www.common-social.com/post/two</loc></url>
      </urlset>`;
    expect(parseCommonSitemap(xml)).toEqual([
      "https://www.common-social.com/post/one",
      "https://www.common-social.com/post/two",
    ]);
  });

  it("names PUBMAXX and the public contact in the UA string", () => {
    expect(COMMON_USER_AGENT).toMatch(/PUBMAXX/);
    expect(COMMON_USER_AGENT).toMatch(/karanszdy@gmail\.com/);
    expect(COMMON_SOURCE.label).toBe("common");
  });
});

describe("the crawl budget advances", () => {
  it("spends the budget on the freshest published posts, not the oldest", () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://www.common-social.com/post/ancient</loc><lastmod>2024-01-01</lastmod></url>
        <url><loc>https://www.common-social.com/post/recent</loc><lastmod>2026-08-14</lastmod></url>
        <url><loc>https://www.common-social.com/post/newest</loc><lastmod>2026-08-15</lastmod></url>
      </urlset>`;
    const entries = parseCommonSitemapEntries(xml);
    expect(entries).toHaveLength(3);
    expect(commonCrawlOrder(entries)).toEqual([
      "https://www.common-social.com/post/newest",
      "https://www.common-social.com/post/recent",
      "https://www.common-social.com/post/ancient",
    ]);
  });

  it("walks an undated sitemap from the end, where a growing sitemap appends", () => {
    const xml = `<urlset>
      <url><loc>https://www.common-social.com/post/one</loc></url>
      <url><loc>https://www.common-social.com/post/two</loc></url>
      <url><loc>https://www.common-social.com/post/three</loc></url>
    </urlset>`;
    expect(commonCrawlOrder(parseCommonSitemapEntries(xml))).toEqual([
      "https://www.common-social.com/post/three",
      "https://www.common-social.com/post/two",
      "https://www.common-social.com/post/one",
    ]);
  });

  it("reaches an upcoming post that a document-order crawl would never fetch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "common-refresh-"));
    const outPath = join(dir, "events_london.json");
    const nowMs = Date.parse("2026-08-16T10:00:00.000Z");
    const stale = "https://www.common-social.com/post/stale";
    const upcoming = "https://www.common-social.com/post/upcoming";
    const xml = `<urlset>
      <url><loc>${stale}</loc><lastmod>2024-01-01</lastmod></url>
      <url><loc>${upcoming}</loc><lastmod>2026-08-15</lastmod></url>
    </urlset>`;
    const seen: string[] = [];
    const fetchImpl = async (target: string | URL) => {
      const href = String(target);
      if (href === COMMON_SITEMAP_URL) return new Response(xml, { status: 200 });
      seen.push(href);
      const when = href === stale ? "1 Jan" : "20 Aug";
      return new Response(
        `<meta property="og:title" content="A night" />
         <meta property="og:description" content="Camberwell · ${when} - never stored" />`,
        { status: 200 },
      );
    };
    const report = await refreshCommonEvents({
      nowMs,
      fetchImpl: fetchImpl as typeof fetch,
      outPath,
      gapMs: 0,
      maxFetches: 1,
    });
    expect(seen).toEqual([upcoming]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].startsDate).toBe("2026-08-20");
    rmSync(dir, { recursive: true, force: true });
  });
});

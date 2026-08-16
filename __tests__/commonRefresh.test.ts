import { describe, expect, it } from "vitest";

import {
  COMMON_SOURCE,
  COMMON_USER_AGENT,
  isStaleCommonDate,
  parseCommonOgPrefix,
  parseCommonPostHtml,
  parseCommonSitemap,
  toCommonEventRow,
} from "../scripts/whatson/commonRefresh.mjs";
import { isValidWhatsOnRow } from "@/lib/whatsOn";

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

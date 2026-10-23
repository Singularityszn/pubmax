// THE RECEIPT NAMES THE PAGE THAT SERVED ITS WORDS.
//
// scripts/harvest/uk-prices/record-later-publications.mjs re-reads each source
// page to keep a verbatim excerpt beside the rows it published. The host picks
// the last hop, so the excerpt can come from a page other than the source URL.
// These cases pin that the landing is asked about (source policy, then robots)
// and that the read answers the landing as `evidenceUrl`.

import { describe, expect, it } from "vitest";

import type { RobotsChecker } from "@/lib/harvest/robots";

import { readEvidence } from "../scripts/harvest/uk-prices/record-later-publications.mjs";

const ROWS = [{ priceGbp: 6.5 }];
const PAGE = "<html><body><p>Neck Oil IPA pint £6.50</p></body></html>";

/** A fetch that answers one page and reports where it landed. */
function landingFetch(landedUrl: string, body = PAGE): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    url: landedUrl,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => body,
    body: null,
  })) as unknown as typeof fetch;
}

function robotsAllowing(allowed: (url: string) => boolean): RobotsChecker {
  return async (url: string) =>
    allowed(url)
      ? { allowed: true, reason: "no-rules-published", robots: "absent", evidence: "test" }
      : { allowed: false, reason: "robots-disallowed", robots: "rules-file", evidence: "test" };
}

describe("the evidence re-read", () => {
  it("names the landing page when a permitted redirect serves the excerpt", async () => {
    const read = await readEvidence(
      "https://thelamb.example/menu",
      ROWS,
      robotsAllowing(() => true),
      landingFetch("https://thelamb.example/drinks/2026"),
    );
    expect(read.evidence).toContain("£6.50");
    expect(read.evidenceUrl).toBe("https://thelamb.example/drinks/2026");
  });

  it("keeps no excerpt when the landing page's robots rules refuse it", async () => {
    const read = await readEvidence(
      "https://thelamb.example/menu",
      ROWS,
      robotsAllowing((url) => !url.includes("/drinks/")),
      landingFetch("https://thelamb.example/drinks/2026"),
    );
    expect(read.evidence).toMatch(/^not re-read: redirected to https:\/\/thelamb\.example\/drinks\/2026, robots/);
    expect(read.evidence).not.toContain("£6.50");
  });

  it("names the source itself when nothing redirected", async () => {
    const read = await readEvidence(
      "https://thelamb.example/menu",
      ROWS,
      robotsAllowing(() => true),
      landingFetch("https://thelamb.example/menu"),
    );
    expect(read.evidenceUrl).toBe("https://thelamb.example/menu");
  });
});

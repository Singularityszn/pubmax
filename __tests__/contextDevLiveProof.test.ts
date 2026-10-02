import { describe, expect, it } from "vitest";

import { scrapeMarkdown } from "@/lib/contextDev";

// A permitted chain pub page the UK price crawl has ALREADY priced
// (data/uk_prices/site_harvest.jsonl), so the proof is checkable against a row
// this repository already holds rather than against whatever the page says today.
const PROOF_URL = "https://www.greeneking.co.uk/pubs/isle-of-wight/folly/menu";

describe("contextDev live proof", () => {
  it.skipIf(!process.env.CONTEXT_DEV_API_KEY?.trim())(
    "scrapeMarkdown on a permitted chain pub menu the crawl already priced",
    async () => {
      const result = await scrapeMarkdown(PROOF_URL, { maxAgeMs: 0 });
      const summary =
        result.status === "ok"
          ? {
              status: result.status,
              url: result.url,
              markdownChars: result.markdown.length,
              preview: result.markdown.slice(0, 800),
            }
          : result;
      // Captain proof artefact: trimmed output for PR bodies.
      console.log("contextDev live proof:", JSON.stringify(summary, null, 2));
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("expected ok");
      expect(result.markdown.length).toBeGreaterThan(0);
    },
    90_000,
  );
});

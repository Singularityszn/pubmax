import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTACT_EMAIL } from "@/lib/siteContact";
import {
  WEATHER_RECOMMENDATION_CONDITIONS,
  weatherRecommendationConditionLabel,
} from "@/lib/weatherRecommendations";

// The /privacy + /terms fence. These pages are the only surfaces where the site
// makes promises about data ON THE RECORD, so the regressions that matter are
// (a) a reader who cannot find them, (b) a dead contact address, and (c) a
// privacy claim drifting away from what the code does. Source-level assertions,
// the same house pattern as landingChromeCss.test.ts: they fail in CI rather
// than needing a browser pass we can't run headless.

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const privacy = read("app/privacy/page.tsx");
const terms = read("app/terms/page.tsx");
const landing = read("components/landing/LandingPage.tsx");
const sitemap = read("app/sitemap.ts");

describe("legal content pages", () => {
  it("reaches the reader from the site footer", () => {
    expect(landing).toMatch(/<Link href="\/privacy">/);
    expect(landing).toMatch(/<Link href="\/terms">/);
    expect(landing).toMatch(/CONTACT_MAILTO/);
  });

  it("is discoverable in the sitemap", () => {
    expect(sitemap).toMatch(/path: "\/privacy"/);
    expect(sitemap).toMatch(/path: "\/terms"/);
  });

  it("quotes the one monitored contact address on both pages", () => {
    for (const page of [privacy, terms]) {
      expect(page).toMatch(/from "@\/lib\/siteContact"/);
      expect(page).toMatch(/\{CONTACT_EMAIL\}/);
      // The address itself never gets hardcoded into a page: swapping to a
      // company inbox later must stay a one-constant change.
      expect(page).not.toContain(CONTACT_EMAIL);
    }
  });

  it("claims nothing we have not got", () => {
    for (const page of [privacy, terms]) {
      expect(page).not.toMatch(/ISO ?27001|SOC ?2|GDPR certified|Privacy Shield/i);
      // We are one person, not a company with a Data Protection Officer. The
      // privacy page may say we have NOT appointed one; neither page may claim
      // we have.
      expect(page).not.toMatch(/(?<!not )appointed a Data Protection Officer/i);
    }
  });

  it("keeps the privacy notice honest about how analytics actually work", () => {
    // Each of these mirrors a real gate: consent-off-by-default and the account
    // toggle (components/profile/PubmaxxAccountHub.tsx), Do Not Track (client
    // beacon + app/api/events/route.ts), the header-stripping first-party proxy
    // (app/ingest/[...path]/route.ts), and hashed-never-stored IPs
    // (lib/supabase.ts hashIp/hashActor).
    expect(privacy).toMatch(/off by default/i);
    expect(privacy).toMatch(/Do Not Track/);
    expect(privacy).toMatch(/no forwarded IP address/i);
    expect(privacy).toMatch(/never the address itself/i);
    expect(privacy).toMatch(/PostHog/);
    expect(privacy).toMatch(/Supabase/);
    expect(privacy).toMatch(/Vercel/);
    expect(privacy).toMatch(/PUBMAXX never stores raw IP addresses in its own/);
    expect(privacy).not.toMatch(/We never store your IP address/);
  });

  it("discloses precise location processing without overstating retention", () => {
    expect(privacy).toMatch(/coordinates never leave your\s+device/);
    expect(privacy).toMatch(/\/api\/whats-on/);
    expect(privacy).toMatch(/\/api\/tonight-conditions/);
    expect(privacy).toMatch(/\/api\/last-train/);
    expect(privacy).toMatch(/\/api\/nearby-bus-departures/);
    expect(privacy).toMatch(/\/api\/tfl-disruption/);
    expect(privacy).toMatch(/\/api\/citymcp\/journey/);
    expect(privacy).toMatch(/without\s+rounding them first/);
    expect(privacy).toMatch(/rounds your\s+point to three decimal places/);
    expect(privacy).toMatch(/public StopPoint API/);
    expect(privacy).toMatch(/pub(?:&rsquo;|’)s public map coordinates/);
    expect(privacy).not.toMatch(/does not\s+write them to our database/);
    expect(privacy).not.toMatch(/not sent to us or stored anywhere/);
  });

  it("names every third party that receives a viewer point", () => {
    // What this block does: it locks the disclosed coordinate-recipient set
    // (TfL, CityMCP, Google Maps) against silent removal from the page, and
    // checks each disclosed host still appears in the source file that
    // actually contacts it. What it does NOT do: discover a new provider
    // added through an unrecognised code path. The backstop for that is the
    // AGENTS.md rule that any data-practice change must update the privacy
    // page in the same commit.
    const thirdPartySection =
      privacy.match(/aria-labelledby="third"[\s\S]*?aria-labelledby="keep"/)?.[0] ?? "";

    const coordinateRecipients = [
      { name: "Transport for London", host: "api.tfl.gov.uk", source: "lib/tflClient.server.ts" },
      { name: "CityMCP", host: "citymcp.com", source: "lib/citymcp/client.ts" },
      { name: "Google Maps", host: "google.com", source: "lib/venueJourney.ts" },
    ];
    for (const recipient of coordinateRecipients) {
      expect(thirdPartySection, `Missing recipient name ${recipient.name}`).toContain(recipient.name);
      expect(thirdPartySection, `Missing recipient host ${recipient.host}`).toContain(recipient.host);
      expect(read(recipient.source), `${recipient.source} no longer contacts ${recipient.host}`).toContain(
        recipient.host,
      );
    }
  });

  it("discloses push subscription storage and retention", () => {
    // Mirrors lib/pushTokenStore.ts + lib/webPush.ts: registration posts the
    // serialized subscription to /api/push-tokens, the store keeps a durable
    // row, and deletion happens on provider-reported invalidation or request.
    expect(privacy).toMatch(/PUBMAXX\s+stores\s+your\s+browser&rsquo;s\s+push\s+subscription/);
    expect(privacy).toMatch(/endpoint\s+plus\s+its\s+keys/);
    expect(privacy).toMatch(/until\s+the\s+push\s+service\s+reports\s+it\s+dead\s+or\s+you\s+ask\s+us\s+to\s+remove\s+it/);
    expect(privacy).toMatch(/belongs\s+to\s+your\s+own\s+browser&rsquo;s\s+push\s+service/);
    expect(privacy).toMatch(/stored\s+subscription\s+row\s+stays/);
    expect(privacy).not.toMatch(/a push subscription is held\s+by your own browser/);
  });

  it("describes remembered-area request use without claiming all state stays local", () => {
    expect(privacy).toMatch(/public area&rsquo;s coarse centre/);
    expect(privacy).toMatch(/The saved choice itself is not\s+uploaded/);
    expect(privacy).toMatch(/don&rsquo;t upload those stored values as a bundle/);
    expect(privacy).toMatch(/device night profile stays\s+on your device unless you sign in/);
    expect(privacy).not.toMatch(/These never leave your\s+device/);
  });

  it("describes durable rate-limit retention", () => {
    expect(privacy).toMatch(/durable limiter rows are\s+keyed to salted hashes/);
    expect(privacy).toMatch(/Hit timestamps\s+outside that window are pruned/);
    expect(privacy).toMatch(/the key row remains/);
    expect(privacy).not.toMatch(/Server and rate-limit records/);
  });

  it("discloses the durable Recommendation row and its retention", () => {
    // Mirrors lib/weatherRecommendationStore.ts and migration 0058: a durable
    // row carrying a PUBLIC handle (unlike a community price, which is
    // anonymous), the venue, one closed condition, the authored reason, a
    // server timestamp, and the same server-derived actor hash the price route
    // uses (lib/communityPriceActor.ts). Attribution is the point of the
    // feature, so the page may never describe these rows as anonymous.
    expect(privacy).toMatch(/Recommendations, and Night Memories/);
    expect(privacy).toMatch(/public PUBMAXX\s+handle/);
    expect(privacy).toMatch(/the same opaque device token described below/);
    expect(privacy).toMatch(/the time our\s+server took it/);
    expect(privacy).toMatch(/<strong>Recommendations:<\/strong>/);
    expect(privacy).toMatch(/replaces the one you already had/);
    // The closed vocabulary is the product's, not the page's: if a condition is
    // added or renamed, this sentence has to be rewritten with it.
    const privacyProse = privacy.toLowerCase().replace(/\s+/g, " ");
    for (const condition of WEATHER_RECOMMENDATION_CONDITIONS) {
      const label = weatherRecommendationConditionLabel(condition);
      expect(privacyProse, `Missing condition ${label}`).toContain(
        label.toLowerCase(),
      );
    }
  });

  it("names all three price lanes and fences the historical one", () => {
    // lib/priceHistory.ts added a THIRD price lane: dated, sourced prices from
    // years gone by, shown on the venue sheet and barred from every
    // current-price system. A terms page that still says prices come from two
    // places would be describing a product that no longer exists, so the count
    // and the "not tonight's price" fence are both pinned here.
    expect(terms).toMatch(/Prices\s+come\s+from\s+three\s+places/);
    expect(terms).toMatch(/never\s+a\s+price\s+for\s+tonight/);
    expect(terms).toMatch(/dated\s+record\s+of\s+the\s+past/);
    expect(terms).not.toMatch(/Prices\s+come\s+from\s+two\s+places/);
  });

  it("states the product's own age framing on the terms page", () => {
    expect(terms).toMatch(/under 18/i);
    expect(terms).toMatch(/drinkaware\.co\.uk/);
  });
});

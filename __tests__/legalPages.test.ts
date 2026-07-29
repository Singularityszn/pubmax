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
    // Each of these mirrors a real gate: the first-visit choice
    // (components/AnalyticsConsentPrompt.tsx), later withdrawal in the account
    // hub, Do Not Track (client beacon + app/api/events/route.ts), the
    // header-stripping first-party proxy (app/ingest/[...path]/route.ts), and
    // hashed-never-stored IP rate limits plus consent-gated PostHog request
    // context (lib/supabase.ts clientIp/hashIp).
    expect(privacy).toMatch(/off by default/i);
    expect(privacy).toMatch(/first visit/i);
    expect(privacy).toMatch(/Allow or No thanks/i);
    expect(privacy).toMatch(/remembers\s+that choice/i);
    expect(privacy).toMatch(/page visits/i);
    expect(privacy).toMatch(/account settings/i);
    expect(privacy).toMatch(/Do Not Track/);
    expect(privacy).toMatch(/persistent\s+device\s+identifier/i);
    expect(privacy).toMatch(/browser\s+and\s+version/i);
    expect(privacy).toMatch(/operating\s+system/i);
    expect(privacy).toMatch(/device\s+type/i);
    expect(privacy).toMatch(/screen\s+and\s+viewport\s+size/i);
    expect(privacy).toMatch(/referrer/i);
    expect(privacy).toMatch(/campaign\s+parameters/i);
    expect(privacy).toMatch(/Web\s+Vitals/i);
    expect(privacy).toMatch(/person\s+and\s+device\s+records/i);
    expect(privacy).toMatch(/raw\s+IP\s+address[\s\S]*PostHog/i);
    expect(privacy).not.toMatch(/no forwarded IP address/i);
    expect(privacy).not.toMatch(/person profiles are switched off/i);
    expect(privacy).toMatch(/never the address itself/i);
    expect(privacy).toMatch(/PostHog/);
    expect(privacy).toMatch(/Supabase/);
    expect(privacy).toMatch(/Vercel/);
    expect(privacy).toMatch(/PUBMAXX never stores raw IP addresses in its own/);
    expect(privacy).not.toMatch(/We never store your IP address/);
  });

  it("keeps analytics optional in the terms as well as the privacy notice", () => {
    expect(terms).toMatch(/Browsing does not require an account or analytics/);
    expect(terms).toMatch(/Allow or No thanks/);
    expect(terms).toMatch(/same app either way/);
    expect(terms).toMatch(/persistent\s+device\s+identifier/i);
    expect(terms).toMatch(/browser,\s+operating\s+system\s+and\s+device\s+type/i);
    expect(terms).toMatch(/screen\s+size/i);
    expect(terms).toMatch(/referrer\s+and\s+campaign/i);
    expect(terms).toMatch(/performance/i);
  });

  it("states both 12-month analytics retention clocks on both legal pages", () => {
    expect(privacy).toMatch(
      /PostHog\s+deletes\s+analytics\s+events\s+12 months after collection/i,
    );
    expect(privacy).toMatch(
      /It\s+deletes\s+pseudonymous\s+person\s+and\s+device\s+records\s+12 months after their last activity/i,
    );
    expect(terms).toMatch(
      /PostHog\s+deletes\s+analytics\s+events\s+12 months after collection\s+and\s+pseudonymous\s+person\s+and\s+device\s+records\s+12 months after their last activity/i,
    );
  });

  it("discloses same-journey referral signup and post-erasure blocking", () => {
    expect(privacy).toMatch(/same\s+sign-in journey/i);
    expect(privacy).toMatch(/delayed return/i);
    expect(privacy).not.toMatch(/referral attribution[^]*consent-only/);
    expect(privacy).toMatch(/one-way hash of the deleted account ID/);
    expect(privacy).toMatch(/existing session cannot recreate/);
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
    // row carrying a public handle, the venue, one closed condition, the
    // authored reason, a server timestamp, and a server-derived actor token.
    // Current community prices also carry an account-owned public handle;
    // anonymity is reserved for legacy price rows without one.
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

  it("discloses community venue reports and their contributor count", () => {
    expect(privacy).toMatch(/Community venue reports/);
    expect(privacy).toMatch(/rough or\s+posh/);
    expect(privacy).toMatch(/entrance and toilet access\s+separately/);
    expect(privacy).toMatch(/door policy/);
    expect(privacy).toMatch(/people were eating/);
    expect(privacy).toMatch(/same stable private profile key/);
    expect(privacy).toMatch(/Venue reports do not enter the public\s+contributor record/);
    expect(privacy).toMatch(/Community prices and venue reports:/);
  });

  it("explains account-bound price attribution and public contributor ranking", () => {
    expect(privacy).toMatch(/public contributor record/i);
    expect(privacy).toMatch(
      /prices[\s\S]*Visit Reports[\s\S]*Recommendations/i,
    );
    expect(privacy).toMatch(/requires a signed-in account/);
    expect(privacy).toMatch(
      /server derives both contribution\s+identifiers from the authenticated account/,
    );
    expect(privacy).toMatch(/Older rows that had no handle remain\s+anonymous/);
    expect(privacy).toMatch(/hidden[\s\S]*do not count/i);
    expect(privacy).toMatch(
      /Visit Reports and Recommendations[\s\S]*existing public profile[\s\S]*remain visible[\s\S]*excluded/i,
    );
    expect(privacy).toMatch(/all\s+time/i);
    expect(privacy).not.toMatch(/future contributor count/i);
  });

  it("states exactly what private profile data is retained", () => {
    expect(privacy).toMatch(/Google or Apple sign-in/);
    expect(privacy).toMatch(/Date of\s+birth is required to finish signup/);
    expect(privacy).toMatch(/Full name and sex are optional/);
    expect(privacy).toMatch(/only identity shown with contributions/);
    expect(privacy).toMatch(/product analytics and\s+social features/);
    expect(privacy).toMatch(/keep date of birth while your account exists/);
    expect(privacy).toMatch(/does not block signup, contribution or any other feature at\s+any age/);
    expect(terms).toMatch(/retain date of birth while your account exists/);
    expect(terms).toMatch(/do not block any feature at any age/);
    expect(terms).toMatch(/Only your handle is public/);
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

  it("states the product's non-blocking age framing on the terms page", () => {
    expect(terms).toMatch(/does not block accounts or contributions based on age/i);
    expect(terms).toMatch(/Pubs\s+decide who they serve/i);
    expect(terms).toMatch(/drinkaware\.co\.uk/);
  });

  it("discloses private referral attribution and its genuine browser limits", () => {
    expect(privacy).toMatch(/private referral edge/i);
    expect(privacy).not.toMatch(/referral journey cookie/i);
    expect(privacy).toMatch(/same\s+sign-in journey/i);
    expect(privacy).toMatch(/different\s+browser or device/i);
    expect(privacy).toMatch(/never shown on a public profile/i);
    expect(privacy).toMatch(/first accepted contribution/i);
    expect(privacy).toMatch(/milestone records/i);
    expect(privacy).toMatch(/until either account is deleted/i);
    expect(privacy).not.toMatch(/Unclaimed journeys/i);
  });

  it("states referral qualification and the closed reward gate in the terms", () => {
    expect(terms).toMatch(/self-referrals/i);
    expect(terms).toMatch(/circular\s+referrals/i);
    expect(terms).toMatch(/signs up and makes a first accepted contribution/i);
    expect(terms).toMatch(/referral rewards are not active/i);
    expect(terms).toMatch(/do not grant access/i);
  });
});

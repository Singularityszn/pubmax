import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTACT_EMAIL } from "@/lib/siteContact";

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
const lastTrainRoute = read("app/api/last-train/route.ts");
const cityMcpClient = read("lib/citymcp/client.ts");
const useVenueJourney = read("components/map/useVenueJourney.ts");
const venueJourney = read("lib/venueJourney.ts");
const venueExternalActions = read("lib/venueExternalActions.ts");

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
    expect(privacy).toMatch(/\/api\/tfl-disruption/);
    expect(privacy).toMatch(/\/api\/citymcp\/journey/);
    expect(privacy).toMatch(/without\s+rounding them first/);
    expect(privacy).toMatch(/rounds your\s+point to three decimal places/);
    expect(privacy).toMatch(/public StopPoint API/);
    expect(privacy).not.toMatch(/does not\s+write them to our database/);
    expect(privacy).not.toMatch(/not sent to us or stored anywhere/);
  });

  it("names every third party that receives a viewer point", () => {
    expect(lastTrainRoute).toMatch(/api\.tfl\.gov\.uk/);
    expect(cityMcpClient).toMatch(/https:\/\/citymcp\.com\/london\/mcp/);
    expect(useVenueJourney).toMatch(/privacyRoundedJourneyPoint/);
    expect(useVenueJourney).toMatch(/fetch\("\/api\/citymcp\/journey"/);
    expect(venueJourney).toMatch(/https:\/\/www\.google\.com\/maps\/dir/);
    expect(venueJourney).toMatch(/params\.set\("origin"/);
    expect(venueExternalActions).toMatch(/https:\/\/www\.google\.com\/maps\/search/);

    expect(privacy).toMatch(/<dt>Transport for London<\/dt>/);
    expect(privacy).toMatch(/<dt>CityMCP<\/dt>/);
    expect(privacy).toMatch(/<dt>Google Maps<\/dt>/);
  });

  it("describes durable rate-limit retention", () => {
    expect(privacy).toMatch(/durable limiter rows are\s+keyed to salted hashes/);
    expect(privacy).toMatch(/Hit timestamps\s+outside that window are pruned/);
    expect(privacy).toMatch(/the key row remains/);
    expect(privacy).not.toMatch(/Server and rate-limit records/);
  });

  it("states the product's own age framing on the terms page", () => {
    expect(terms).toMatch(/under 18/i);
    expect(terms).toMatch(/drinkaware\.co\.uk/);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("VOICE.md compliance audit", () => {
  it("keeps account and sign-in copy plain, precise, and free of identity plumbing", () => {
    const onboarding = read("components/identity/AccountOnboarding.tsx");
    const contributionGate = read(
      "components/identity/ContributionGateDialog.tsx",
    );
    const identityNudge = read("components/identity/IdentityNudge.tsx");
    const accountHub = read("components/profile/PubmaxxAccountHub.tsx");

    expect(onboarding).toContain(
      "Your public handle appears on every contribution you make.",
    );
    expect(onboarding).not.toContain("owns every contribution");

    expect(contributionGate).toMatch(
      /Contributions show your public handle, so you need an account\s+first\./,
    );
    expect(contributionGate).toMatch(
      /Choose a public handle and add your date of birth before\s+contributing\./,
    );
    expect(contributionGate).not.toContain("account-owned");
    expect(contributionGate).not.toContain("private profile");

    expect(identityNudge).toContain(
      "Leave your email. We&apos;ll send the weekly pint digest.",
    );
    expect(identityNudge).not.toContain("Just leave your email");

    expect(accountHub).toContain("<h3>Optional usage analytics</h3>");
    expect(accountHub).not.toContain("Anonymous usage analytics");
    expect(accountHub).not.toContain("person-level account checks");
  });

  it("keeps map trust and failure copy exact without exposing map plumbing", () => {
    const legend = read("lib/mapPriceLegend.ts");
    const priceSubmit = read("components/map/VenuePriceSubmit.tsx");
    const communityPrice = read("lib/communityPrice.ts");
    const mapCanvas = read("components/PubMapCanvas.tsx");

    expect(legend).not.toContain("One recent pint report");
    expect(legend).not.toContain("curated pub");
    expect(legend).toContain("A recent pint report");
    expect(legend).toContain(
      "a second independent drinker reporting a similar price can set the pin's band",
    );

    for (const source of [priceSubmit, communityPrice]) {
      expect(source).not.toContain("logging the same price");
      expect(source).not.toContain("logs the same");
    }
    expect(priceSubmit).not.toContain("badged as community -");
    expect(communityPrice).not.toMatch(
      /(?:old|confirmation|unconfirmed) - /i,
    );
    expect(priceSubmit).not.toContain("account-owned");

    expect(mapCanvas).not.toContain("The map couldn't start its renderer.");
    expect(mapCanvas).not.toContain(
      "The map's renderer started but never drew a frame.",
    );
    expect(mapCanvas).not.toContain("Map renderer unavailable");
    expect(mapCanvas).not.toContain("can't paint the map");
    expect(mapCanvas).toContain("This browser or device cannot show the map right now.");
  });

  it("keeps journeys, empty states, and locality copy plain and supportable", () => {
    const plan = read("components/plan/PlanComposer.tsx");
    const planPage = read("app/plan/page.tsx");
    const feed = read("app/feed/FeedPageClient.tsx");
    const feedCard = read("components/feed/FeedCard.tsx");
    const today = read("app/today/TodayClient.tsx");
    const tonight = read("app/tonight/TonightClient.tsx");
    const near = read("components/nearme/NearMeNow.tsx");
    const tonightNearby = read("components/discovery/TonightNearbyLane.tsx");
    const deals = read("components/discovery/DealsTonightLane.tsx");
    const rivalry = read("components/discovery/CityRivalryTable.tsx");
    const borough = read("app/borough/[slug]/page.tsx");
    const memories = read("components/profile/NightMemoryStudio.tsx");

    for (const source of [plan, planPage]) {
      expect(source).not.toMatch(
        /capture state|captured coverage|evidence capture|evidence gate|evidence gaps|snapshot/iu,
      );
    }
    expect(planPage).not.toContain("group-chat archaeology");
    expect(planPage).not.toContain("actually make sense");

    expect(feed).toContain('title="Couldn\'t load Stories."');
    expect(feed).not.toContain("Couldn't pour the feed.");
    expect(feed).not.toContain("reach the bar");
    expect(feed).not.toContain("Capture a Moment");
    expect(feedCard).not.toContain("Provenance:");

    expect(today).not.toContain("refresh this by hand right now");
    expect(today).not.toContain("catch up shortly");
    expect(tonight).not.toContain("same spine as the map");

    expect(near).toContain("Cheapest listed near you");
    expect(near).not.toContain("Finding the cheapest");
    expect(near).not.toContain("Pulling up the cheapest");

    expect(tonightNearby).not.toContain("Curated things to do");
    expect(tonightNearby).not.toContain("Grounded,");
    expect(tonightNearby).not.toContain("upstream-sourced");
    expect(deals).not.toContain("experience deals");
    expect(rivalry).not.toContain(
      'caption = "UK city energy. Demo Pint Drops, curated crawls',
    );
    expect(borough).not.toMatch(/curated (?:route|crawls)/iu);
    expect(memories).not.toContain("Capture a Moment");
  });

  it("keeps legal and Pint Index copy truthful and free of data plumbing", () => {
    const privacy = read("app/privacy/page.tsx");
    const terms = read("app/terms/page.tsx");
    const pintIndex = read("app/pint-index/page.tsx");

    expect(privacy).not.toContain("Browsing is anonymous");
    expect(privacy).not.toContain("Anonymous usage analytics");
    expect(privacy).not.toContain("not a queue");
    expect(privacy).not.toContain("community observation rows");
    expect(privacy).not.toContain("A row is one observation");

    expect(terms).not.toContain("optional anonymous analytics");
    expect(terms).not.toContain("account identity boundary");
    expect(terms).not.toContain("Prices are observations, not offers");
    expect(terms).not.toContain(
      "Every price on PUBMAXX is what someone saw, on a date we show you",
    );
    expect(terms).toContain(
      "Every current price names where it came from.",
    );

    for (const phrase of [
      "observation-date validation",
      "provenance-first",
      "provenance-validated snapshot",
      "Observation window:",
      "Download the public snapshot",
      "Methodology &amp; provenance",
      "Eligible evidence.",
      "boundary artifact",
      "Quarantine.",
      "product continuity",
      "evidence record",
      "Top of it right now:",
    ]) {
      expect(pintIndex).not.toContain(phrase);
    }
    expect(pintIndex).toContain("Method and sources");
    expect(pintIndex).toContain("Prices seen:");
  });
});

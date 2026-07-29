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
});

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CityPubsOnlyNoteLine } from "@/components/map/CityPubsOnlyNote";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import { listEnabledCities } from "@/lib/cities";
import { CITY_PUBS_ONLY_NOTE, cityPubsOnlyNoteFor } from "@/lib/cityPubsOnlyNote";

// Launch review, 30 Oct 2026, item 13: "It doesn't work outside London."
// Every enabled city outside London has no priced pin, and /places said
// "London only, for now" while the city maps said nothing at all.

describe("a city map outside London says what it is", () => {
  it("prints the line on every enabled city without listed prices, and never on London", () => {
    expect(cityPubsOnlyNoteFor("london")).toBeNull();
    const others = listEnabledCities().filter((city) => city.id !== "london");
    expect(others.length).toBeGreaterThan(0);
    for (const city of others) {
      const priced = getCityCapabilityProfile(city.id).prices.availability === "available";
      expect(cityPubsOnlyNoteFor(city.id), city.id).toBe(priced ? null : CITY_PUBS_ONLY_NOTE);
    }
  });

  it("says pubs only, no prices yet, and links to the city picker", () => {
    const html = renderToStaticMarkup(<CityPubsOnlyNoteLine note={CITY_PUBS_ONLY_NOTE} />);
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toBe("Pubs only here, no prices yet. Tell us your city.");
    expect(html).toContain('href="/places"');
    expect(html).toContain('role="note"');
    expect(text).not.toMatch(/[!—]/u);
  });

  it("mounts from the host shell, never from the edit-locked PubMap", () => {
    expect(readFileSync("components/PubMaxingShell.tsx", "utf8")).toContain("<CityPubsOnlyNoteMount");
    expect(readFileSync("components/PubMap.tsx", "utf8")).not.toContain("CityPubsOnlyNote");
  });

  it("waits under the map banner staging rules", () => {
    const staging = readFileSync("components/map/mapBannerStaging.css", "utf8");
    for (const selector of [
      ".appShell.onboarding-open .cityPubsOnlyNote",
      "body:has(.mapArrivalCard) .cityPubsOnlyNote",
      ".mapStage:has(.citySuggestBanner) .cityPubsOnlyNote",
      ".mapStage:has(.cityStatusBanner) .cityPubsOnlyNote",
      ".mapStage:has(.tonightLaneCollapsed) .cityPubsOnlyNote",
      ".mapStage:has(.tonightLane--open) .cityPubsOnlyNote",
      "body:has(.mobileSheetPortal) .cityPubsOnlyNote",
      "body:has(.mobileMapSearchRow) .cityPubsOnlyNote",
    ]) {
      expect(staging, selector).toContain(selector);
    }
  });
});

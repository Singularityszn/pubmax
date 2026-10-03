import { describe, expect, it } from "vitest";

import {
  FLASH_LITE_SKU,
  JOB_SPEND_CAP_USD,
  amenityColumnIsBlank,
  evidenceQuoteIsOnPage,
  keepEvidencedAmenities,
  matchPubToVenue,
  parsePubAmenityModelJson,
  projectPubAmenitySpend,
  stampAmenityColumns,
  statedAmenities,
} from "@/lib/harvest/pubWebsiteAmenities";

const PAGE = [
  "The Crown serves food every day from noon.",
  "Our beer garden opens when the weather does.",
  "Sunday pub quiz starts at eight.",
  "Cocktails are listed on the board behind the bar.",
].join(" ");

describe("parsePubAmenityModelJson", () => {
  it("reads a fenced object and drops keys that are not amenities", () => {
    const raw = [
      "```json",
      JSON.stringify({
        amenities: {
          food: { value: true, evidence: "serves food every day" },
          wifi: { value: true, evidence: "free wifi" },
          cocktails: { value: "yes", evidence: "Cocktails" },
        },
      }),
      "```",
    ].join("\n");
    const parsed = parsePubAmenityModelJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.amenities.food).toEqual({
      value: true,
      evidence: "serves food every day",
    });
    expect(parsed.amenities).not.toHaveProperty("wifi");
    expect(parsed.amenities.cocktails).toBeUndefined();
  });

  it("refuses a body that is not JSON", () => {
    expect(parsePubAmenityModelJson("the pub has a garden")).toEqual({
      ok: false,
      reason: "not-json",
    });
  });
});

describe("keepEvidencedAmenities", () => {
  it("keeps a true value only when the quote is on the page", () => {
    const kept = keepEvidencedAmenities(
      {
        food: { value: true, evidence: "serves food every day" },
        beerGarden: { value: true, evidence: "Our Beer Garden opens" },
        liveSports: { value: true, evidence: "we show every match live" },
        cocktails: { value: false, evidence: "Cocktails are listed on the board" },
        pubQuiz: { value: true, evidence: "quiz" },
      },
      PAGE,
    );
    expect(kept.food).toBe("serves food every day");
    expect(kept.beerGarden).toBe("Our Beer Garden opens");
    expect(kept.liveSports).toBeUndefined();
    expect(kept.cocktails).toBeUndefined();
    expect(kept.pubQuiz).toBeUndefined();
    expect(evidenceQuoteIsOnPage(PAGE, "quiz")).toBe(false);
  });

  it("drops a quote that is on the page but does not state the amenity at this pub", () => {
    const page = [
      "We serve a range of tea, coffee and hot chocolate drinks.",
      "All children's meals are served with a drink and fruit option included.",
      "Book a table for all the top sporting action, from footy to rugby, F1, darts and more!",
      "Pool Charging Station by the door.",
      "Plenty of merriment from Christmas quizzes to karaoke. Come join us.",
      "Food and drinks Hotels About us Contact us Careers",
    ].join(" ");
    const kept = keepEvidencedAmenities(
      {
        nonAlcoholic: { value: true, evidence: "tea, coffee and hot chocolate drinks" },
        darts: { value: true, evidence: "from footy to rugby, F1, darts and more!" },
        pool: { value: true, evidence: "Pool Charging Station" },
        karaoke: { value: true, evidence: "Christmas quizzes to karaoke" },
        food: { value: true, evidence: "Food and drinks Hotels About us Contact us Careers" },
      },
      page,
    );
    expect(kept).toEqual({});
    expect(
      keepEvidencedAmenities(
        {
          nonAlcoholic: {
            value: true,
            evidence: "All children's meals are served with a drink",
          },
          karaoke: { value: true, evidence: "karaoke. Come join us" },
        },
        page,
      ),
    ).toEqual({});
  });

  it("drops chain-wide news, seasonal promotions and a bare time range", () => {
    const page = [
      "Related Content Alcohol free cocktails fuelling growth in low and no sales at Greene King Pubs.",
      "Plenty of merriment from Christmas quizzes to karaoke.",
      "Drinks deals 4pm - 7pm, Monday to Thursday!",
    ].join(" ");
    const kept = keepEvidencedAmenities(
      {
        nonAlcoholic: {
          value: true,
          evidence: "Alcohol free cocktails fuelling growth in low and no sales at Greene King Pubs",
        },
        pubQuiz: { value: true, evidence: "Christmas quizzes" },
        happyHour: { value: true, evidence: "4pm - 7pm, Monday to Thursday!" },
      },
      page,
    );
    expect(kept).toEqual({});
    for (const evidence of ["Alcohol free cocktails", "low and no sales"]) {
      expect(keepEvidencedAmenities({ nonAlcoholic: { value: true, evidence } }, page)).toEqual({});
    }
  });

  it("drops a bare screen, drinks before an event elsewhere, a quiz machine and generic soft drinks", () => {
    expect(
      statedAmenities({
        liveSports: "tv TV screens",
        liveMusic: "pre/post match & concert drinks",
        pubQuiz: "Quiz Machine",
        nonAlcoholic: "alcoholic and non-alcoholic drinks",
      }),
    ).toEqual({});
    expect(statedAmenities({ liveSports: "pre/post match & concert drinks" })).toEqual({});
    expect(
      statedAmenities({
        liveSports: "We show live sport on our Sky Sports screens",
        liveMusic: "live music every Saturday",
        pubQuiz: "Join our pub quiz, every Wednesday",
        nonAlcoholic: "non-alcoholic beers",
      }),
    ).toEqual({
      liveSports: "We show live sport on our Sky Sports screens",
      liveMusic: "live music every Saturday",
      pubQuiz: "Join our pub quiz, every Wednesday",
      nonAlcoholic: "non-alcoholic beers",
    });
  });

  it("keeps a quote that names the amenity itself", () => {
    const page = [
      "Lucky Saint 0.5% and alcohol-free cocktails behind the bar.",
      "Upstairs we have a dart board and two pool tables.",
      "Karaoke every Thursday from eight.",
      "Our kitchen serves food every day.",
      "2-4-1 cocktails Monday to Friday, 5-7pm.",
    ].join(" ");
    const kept = keepEvidencedAmenities(
      {
        nonAlcoholic: { value: true, evidence: "alcohol-free cocktails" },
        darts: { value: true, evidence: "a dart board" },
        pool: { value: true, evidence: "two pool tables" },
        karaoke: { value: true, evidence: "Karaoke every Thursday" },
        food: { value: true, evidence: "serves food every day" },
        happyHour: { value: true, evidence: "2-4-1 cocktails Monday to Friday" },
      },
      page,
    );
    expect(kept).toEqual({
      happyHour: "2-4-1 cocktails Monday to Friday",
      nonAlcoholic: "alcohol-free cocktails",
      darts: "a dart board",
      pool: "two pool tables",
      karaoke: "Karaoke every Thursday",
      food: "serves food every day",
    });
  });
});

describe("statedAmenities", () => {
  it("drops stored quotes the gate would refuse, so a restamp cannot bring them back", () => {
    expect(
      statedAmenities({
        nonAlcoholic: "tea, coffee and hot chocolate drinks",
        darts: "Boxing Darts Formula 1",
        pubQuiz: "Christmas quizzes to karaoke.",
        beerGarden: "Our beer garden opens",
        pool: "two pool tables",
      }),
    ).toEqual({ beerGarden: "Our beer garden opens", pool: "two pool tables" });
  });
});

describe("stampAmenityColumns", () => {
  it("writes yes into a blank column and leaves a stated answer alone", () => {
    const { row, stamped } = stampAmenityColumns(
      { food: "", cocktails: "no", beer_garden: "yes (summer)" },
      {
        food: "serves food every day",
        cocktails: "Cocktails are listed on the board",
        beerGarden: "Our beer garden opens",
      },
    );
    expect(row.food).toBe("yes");
    expect(row.cocktails).toBe("no");
    expect(row.beer_garden).toBe("yes (summer)");
    expect(stamped).toEqual(["food"]);
    expect(amenityColumnIsBlank("")).toBe(true);
    expect(amenityColumnIsBlank("n/a")).toBe(true);
    expect(amenityColumnIsBlank("no")).toBe(false);
  });
});

describe("projectPubAmenitySpend", () => {
  it("prices the Flash-Lite text SKU under the job cap for the London pub set", () => {
    const spend = projectPubAmenitySpend({
      calls: 1882,
      inputTokensPerCall: 3000,
      outputTokensPerCall: 800,
      inputUsdPerMillion: FLASH_LITE_SKU.inputUsdPerMillion,
      outputUsdPerMillion: FLASH_LITE_SKU.outputUsdPerMillion,
    });
    expect(spend).toBeCloseTo(1.16684, 4);
    expect(spend).toBeLessThan(JOB_SPEND_CAP_USD);
  });
});

describe("matchPubToVenue", () => {
  const venues = [
    { venueId: "venue-near", name: "The Shy Horse", lat: 51.5, lng: -0.1 },
    { venueId: "venue-far", name: "The Shy Horse", lat: 51.7, lng: -0.4 },
    { venueId: "venue-other", name: "The Crown and Treaty", lat: 51.5, lng: -0.1 },
  ];

  it("picks the closest pub whose name agrees", () => {
    const match = matchPubToVenue(
      {
        osmId: "node/1",
        name: "The Shy Horse",
        lat: 51.5002,
        lng: -0.1002,
        website: "https://example.com/shy-horse",
      },
      venues,
    );
    expect(match?.venueId).toBe("venue-near");
  });

  it("matches a chain suffix on the same pub", () => {
    const match = matchPubToVenue(
      {
        osmId: "node/3",
        name: "The Shy Horse",
        lat: 51.5001,
        lng: -0.1001,
        website: "https://example.com/shy-horse",
      },
      [{ venueId: "venue-spoon", name: "The Shy Horse - JD Wetherspoon", lat: 51.5002, lng: -0.1002 }],
    );
    expect(match?.venueId).toBe("venue-spoon");
  });

  it("does not match a different pub that only shares a word", () => {
    const match = matchPubToVenue(
      {
        osmId: "node/2",
        name: "The Crown",
        lat: 51.5,
        lng: -0.1,
        website: "https://example.com/crown",
      },
      venues,
    );
    expect(match).toBeNull();
  });
});


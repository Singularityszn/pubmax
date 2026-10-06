// The venue-level half of the truth contract (lib/venues.ts).
//
// `lib/venueTruth.ts` owns the reading rules; these hold the two functions that
// apply them to a whole venue record, including the two LAYERS a venue arrives
// in: one holding its source rows, and one built from the slim index which
// holds only presence flags.

import { describe, expect, it } from "vitest";

import { groupVenuePrices, venueAmenityStatus, venueContacts, type VenuePrice } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

function row(over: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "row-1",
    pub_name: "The Test Arms",
    pint_name: "Lager",
    price_gbp: 4.8,
    price_text: "£4.80",
    address: "1 Test Street, London",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "Westminster",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Westminster",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    source_datasets: "test",
    source_row_count: 1,
    has_visible_borough_row: true,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...over,
  };
}

describe("venueAmenityStatus", () => {
  it("reads a blank column as unknown rather than a stated absence", () => {
    const [venue] = groupVenuePrices([row()]);
    const status = venueAmenityStatus(defined(venue));
    expect(status.beerGarden).toBe("unknown");
    expect(status.food).toBe("unknown");
    // The boolean the filter machinery reads is untouched: false still means
    // "not known to be true", which is the direction a positive filter wants.
    expect(defined(venue).amenities.beerGarden).toBe(false);
  });

  it("reads a stated presence, qualifier and all", () => {
    const [venue] = groupVenuePrices([
      row({ beer_garden: "Yes", live_music: "yes (fri & sat)", pub_quiz: "yes sundays" }),
    ]);
    const status = venueAmenityStatus(defined(venue));
    expect(status.beerGarden).toBe("known-true");
    expect(status.liveMusic).toBe("known-true");
    expect(status.pubQuiz).toBe("known-true");
  });

  it("reads a value that answers a different question as unknown", () => {
    // One bundled row really does carry "Dog friendly" in the cocktails column.
    const [venue] = groupVenuePrices([row({ cocktails: "Dog friendly" })]);
    expect(venueAmenityStatus(defined(venue)).cocktails).toBe("unknown");
  });

  it("reads a stated absence as a stated absence", () => {
    const [venue] = groupVenuePrices([row({ food: "No" })]);
    expect(venueAmenityStatus(defined(venue)).food).toBe("known-false");
  });

  it("lets one row's yes answer for the whole pub", () => {
    const [venue] = groupVenuePrices([
      row({ app_price_id: "a", food: "" }),
      row({ app_price_id: "b", food: "Yes" }),
    ]);
    expect(venueAmenityStatus(defined(venue)).food).toBe("known-true");
  });

  it("never states an absence for the derived alcohol-free lane", () => {
    const [dry] = groupVenuePrices([row({ pint_name: "Lucky Saint" })]);
    const [wet] = groupVenuePrices([row({ pint_name: "Lager" })]);
    expect(venueAmenityStatus(defined(dry)).nonAlcoholic).toBe("known-true");
    expect(venueAmenityStatus(defined(wet)).nonAlcoholic).toBe("unknown");
  });

  it("reads a slim-built venue's flags as presence-or-unknown", () => {
    // No source rows: a flag that is on is a statement carried forward, and a
    // flag that is off is a flag nobody set, never a No.
    const slimShaped = {
      amenities: {
        food: true,
        cocktails: false,
        beerGarden: false,
        liveSports: false,
        liveMusic: false,
        pubQuiz: false,
        darts: false,
        pool: false,
        happyHour: false,
        karaoke: false,
        nonAlcoholic: false,
      },
    };
    const status = venueAmenityStatus(slimShaped);
    expect(status.food).toBe("known-true");
    expect(status.cocktails).toBe("unknown");
    expect(Object.values(status)).not.toContain("known-false");
  });
});

describe("venueContacts", () => {
  it("refuses a website URL sitting in the phone column", () => {
    const [venue] = groupVenuePrices([
      row({
        phone_number: "🌐 https://www.lsesu.com/social/three-tuns/",
        website: "https://www.lsesu.com/social/three-tuns/",
      }),
    ]);
    const contacts = venueContacts(defined(venue));
    expect(contacts.phoneNumber).toBeNull();
    expect(contacts.phoneHref).toBeNull();
    expect(contacts.websiteHref).toBe("https://www.lsesu.com/social/three-tuns/");
  });

  it("publishes a real number and its dialable href", () => {
    const [venue] = groupVenuePrices([row({ phone_number: "020 7123 4567" })]);
    expect(venueContacts(defined(venue))).toMatchObject({
      phoneNumber: "02071234567",
      phoneHref: "tel:02071234567",
    });
  });

  it("prefers a contract already stamped on the record", () => {
    const stamped = {
      website: "https://ignored.example",
      bookingLink: "",
      contacts: {
        phoneNumber: "02071234567",
        phoneHref: "tel:02071234567",
        websiteHref: "https://stamped.example",
        emailHref: null,
        bookingHref: null,
      },
    };
    expect(venueContacts(stamped).websiteHref).toBe("https://stamped.example");
  });

  it("takes the first value that PARSES, not the first non-blank one", () => {
    // The three leading values below are real shapes out of the shipped
    // dataset: 478 of the 852 pubs holding any phone value lead with something
    // that is not a number, and six of them carry a clean one in a later row.
    // Taking the first non-blank value threw that number away and answered null
    // over a pub whose own rows hold a dialable one.
    const [venue] = groupVenuePrices([
      row({
        app_price_id: "row-a",
        phone_number: "🌐 https://www.theoldhatealing.co.uk/ 🍽️ Food available ☀️ Beer garden available",
        email: "🍽️ Food available",
      }),
      row({ app_price_id: "row-b", phone_number: "🍽️ Food available 🍹 Cocktails available" }),
      row({ app_price_id: "row-c", phone_number: "020 8840 9430", email: "hello@theoldhat.example" }),
    ]);
    expect(venueContacts(defined(venue))).toMatchObject({
      phoneNumber: "02088409430",
      phoneHref: "tel:02088409430",
      emailHref: "mailto:hello@theoldhat.example",
    });
  });

  it("still answers null when no row holds a value that parses", () => {
    const [venue] = groupVenuePrices([
      row({ app_price_id: "row-a", phone_number: "🌐 https://www.theblueboat.co.uk/" }),
      row({ app_price_id: "row-b", phone_number: "❓ Pub quiz available", email: "not an address" }),
    ]);
    expect(venueContacts(defined(venue))).toMatchObject({
      phoneNumber: null,
      phoneHref: null,
      emailHref: null,
    });
  });

  it("answers every field null for a venue holding nothing", () => {
    const [venue] = groupVenuePrices([row()]);
    expect(venueContacts(defined(venue))).toEqual({
      phoneNumber: null,
      phoneHref: null,
      websiteHref: null,
      emailHref: null,
      bookingHref: null,
    });
  });
});

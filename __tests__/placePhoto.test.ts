import { describe, expect, it } from "vitest";

import {
  areaPlacePhoto,
  areaRoutePlacePhoto,
  boroughPlacePhoto,
  londonPlacePhoto,
  pubPlacePhoto,
  routePlacePhoto,
  PLACE_PHOTO_WALK_METRES,
} from "@/components/listing/placePhoto";
import { AREA_PHOTOS, LANDING_PHOTO_SPOTS, LANDING_PHOTOS, PUB_PHOTOS } from "@/lib/landingImagery";
import { LONDON_COLLAGE_PHOTOS } from "@/lib/landingLondonCollage";

// The listing pages' photographs (taste plan, 18 Oct 2026). Three honesty
// rules, pinned: a pub photograph only for that pub, a borough photograph
// captioned with its place, and a route photograph only when every stop is a
// short walk from where it was taken, never a photograph of one pub.

describe("pubPlacePhoto", () => {
  it("answers only for a pub we hold a photograph OF, matched by venue id", () => {
    const [venueId, photoId] = Object.entries(PUB_PHOTOS)[0] ?? [];
    expect(venueId).toBeTruthy();
    const photo = pubPlacePhoto(venueId);
    expect(photo).toMatchObject({ key: `landing:${photoId}`, scope: "pub", namesPlace: false });
    expect(photo?.credit).toMatchObject({ kind: "licensed" });
    expect(pubPlacePhoto("venue-not-here")).toBeNull();
    expect(pubPlacePhoto(null)).toBeNull();
  });
});

describe("boroughPlacePhoto", () => {
  it("names the place it shows, and answers nothing for a borough we hold no photograph of", () => {
    const southwark = boroughPlacePhoto("Southwark");
    expect(southwark).toMatchObject({
      key: "landing:borough-market",
      place: "Borough Market, Southwark",
      scope: "borough",
      namesPlace: true,
    });
    expect(boroughPlacePhoto("Waltham Forest")).toBeNull();
    expect(boroughPlacePhoto(null)).toBeNull();
  });
});

describe("routePlacePhoto", () => {
  // Four points round the market itself, nearer it than the founder's
  // Southwark photograph a few streets east.
  const BOROUGH = [
    { lat: 51.5058, lng: -0.0918 },
    { lat: 51.5062, lng: -0.0905 },
    { lat: 51.505, lng: -0.0925 },
    { lat: 51.5054, lng: -0.0912 },
  ];

  it("leads a compact route with the patch it walks through", () => {
    const photo = routePlacePhoto(BOROUGH);
    expect(photo?.key).toBe("landing:borough-market");
    expect(photo?.scope).toBe("area");
    expect(photo?.namesPlace).toBe(true);
  });

  it("gives a route that leaves the walk no photograph at all", () => {
    expect(routePlacePhoto([...BOROUGH, { lat: 51.5414, lng: -0.1462 }])).toBeNull();
    expect(routePlacePhoto([])).toBeNull();
  });

  it("can use a founder photograph, credited to the founder", () => {
    const leadenhall = LONDON_COLLAGE_PHOTOS.find((photo) => photo.id === "leadenhall-boxhall");
    expect(leadenhall).toBeTruthy();
    const [lat, lng] = leadenhall!.spot;
    const photo = routePlacePhoto([{ lat, lng }]);
    expect(photo).toMatchObject({ key: "collage:leadenhall-boxhall", place: "Leadenhall Market" });
    expect(photo?.credit).toEqual({ kind: "founder" });
  });

  it("never lends a photograph of one pub to a route", () => {
    const pubPhotoIds = new Set(Object.values(PUB_PHOTOS));
    for (const id of Object.keys(LANDING_PHOTO_SPOTS)) {
      expect(pubPhotoIds.has(id), id).toBe(false);
      expect(LANDING_PHOTOS[id], id).toBeTruthy();
    }
    const crown = LONDON_COLLAGE_PHOTOS.find((photo) => photo.id === "crown-tavern");
    expect(crown).toBeTruthy();
    const [lat, lng] = crown!.spot;
    expect(routePlacePhoto([{ lat, lng }])?.key).not.toBe("collage:crown-tavern");
  });

  it("walks the same half mile the landing collage prices", () => {
    expect(PLACE_PHOTO_WALK_METRES).toBe(800);
  });
});

describe("areaPlacePhoto and londonPlacePhoto", () => {
  it("leads an area with its own photograph, captioned with the place it shows", () => {
    expect(areaPlacePhoto("bermondsey-london-bridge")).toMatchObject({
      key: "landing:borough-market",
      place: "Borough Market, Southwark",
      scope: "area",
      namesPlace: true,
    });
    expect(areaPlacePhoto("dalston")).toBeNull();
    expect(areaPlacePhoto(null)).toBeNull();
  });

  it("never hands a pub photograph to an area", () => {
    const pubPhotoIds = new Set(Object.values(PUB_PHOTOS));
    for (const slug of Object.keys(AREA_PHOTOS)) {
      const photo = areaPlacePhoto(slug);
      expect(photo, slug).toBeTruthy();
      expect(pubPhotoIds.has(photo!.key.replace("landing:", "")), slug).toBe(false);
    }
  });

  it("names London's photograph by the place it really shows", () => {
    expect(londonPlacePhoto()).toMatchObject({
      key: "landing:city-of-london",
      place: "The City of London",
      scope: "london",
      namesPlace: true,
    });
  });
});

describe("areaRoutePlacePhoto", () => {
  const BOROUGH_STOPS = [
    { lat: 51.5057, lng: -0.0907 },
    { lat: 51.5047, lng: -0.0921 },
    { lat: 51.5061, lng: -0.0915 },
  ];

  it("leads a plan with its named area's photograph when every stop is a short walk from it", () => {
    expect(areaRoutePlacePhoto("bermondsey-london-bridge", BOROUGH_STOPS)?.key).toBe(
      "landing:borough-market",
    );
  });

  it("gives none when one stop strays, the area is another, or the photograph has no spot", () => {
    expect(
      areaRoutePlacePhoto("bermondsey-london-bridge", [...BOROUGH_STOPS, { lat: 51.4985, lng: -0.0712 }]),
    ).toBeNull();
    // The stops are by Borough Market, so Soho's photograph is not theirs.
    expect(areaRoutePlacePhoto("piccadilly-soho", BOROUGH_STOPS)).toBeNull();
    // Angel has a photograph but no recorded spot, so no walk can be measured.
    expect(LANDING_PHOTO_SPOTS["angel-islington"]).toBeUndefined();
    expect(areaRoutePlacePhoto("islington", [{ lat: 51.5322, lng: -0.1058 }])).toBeNull();
    expect(areaRoutePlacePhoto("bermondsey-london-bridge", [])).toBeNull();
    expect(areaRoutePlacePhoto(null, BOROUGH_STOPS)).toBeNull();
  });
});

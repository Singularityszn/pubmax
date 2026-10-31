import { readFileSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DogOfTheWeekBody from "@/components/drink-wall/DogOfTheWeekBody";
import { DogOfTheWeekCardView } from "@/components/discovery/DogOfTheWeekCard";
import {
  DOG_OF_THE_WEEK_EMPTY_LINE,
  DOG_OF_THE_WEEK_UNREAD_LINE,
  pickDogOfTheWeek,
  type DogOfTheWeek,
} from "@/lib/dogOfTheWeek";
import {
  DRINK_WALL_CATEGORIES,
  DRINK_WALL_DOG_NEEDS_PUB_LINE,
  validateDrinkWallSubmission,
  type DrinkWallPhotoDTO,
} from "@/lib/drinkWall";
import { validateVenuePhotoSubmission } from "@/lib/venuePhotos";

// Launch review F7: a "Dog" category on the photo wall, taken through the same
// upload doors and the same moderation as every wall photo, and a Dog of the
// week page showing the newest approved one with its pub.

function photo(overrides: Partial<DrinkWallPhotoDTO> = {}): DrinkWallPhotoDTO {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    venueId: "venue-abc",
    venueName: "The Dog and Duck",
    wallCategory: "dog",
    placeLabel: null,
    url: "/api/venue-photo/venue-abc/11111111-1111-4111-8111-111111111111",
    drinkCategory: null,
    caption: "",
    width: 1200,
    height: 900,
    createdAt: "2026-10-30T20:00:00.000Z",
    author: { handle: "karan" },
    ownedByViewer: false,
    ...overrides,
  };
}

const DOG: DogOfTheWeek = {
  photoId: "11111111-1111-4111-8111-111111111111",
  url: "/api/venue-photo/venue-abc/11111111-1111-4111-8111-111111111111",
  width: 1200,
  height: 900,
  caption: "Biscuit, a regular",
  createdAt: "2026-10-30T20:00:00.000Z",
  venueId: "venue-abc",
  venueName: "The Dog and Duck",
  handle: "karan",
};

describe("the Dog wall category", () => {
  it("is in the closed set", () => {
    expect(DRINK_WALL_CATEGORIES).toContain("dog");
  });

  it("is accepted by the photo wall upload validator with its pub", () => {
    const answer = validateDrinkWallSubmission({
      wallCategory: "dog",
      venueId: "venue-abc",
      drinkCategory: "beer",
      caption: "Biscuit",
    });
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.value.wallCategory).toBe("dog");
      expect(answer.value.venueId).toBe("venue-abc");
      expect(answer.value.drinkCategory).toBe(null);
    }
  });

  it("is refused without a pub, because the page names where the dog was met", () => {
    expect(validateDrinkWallSubmission({ wallCategory: "dog" })).toEqual({
      ok: false,
      error: DRINK_WALL_DOG_NEEDS_PUB_LINE,
    });
  });

  it("is accepted by a pub's own photo wall, which still defaults to a pint", () => {
    const dog = validateVenuePhotoSubmission({ venueId: "venue-abc", wallCategory: "dog", drinkCategory: "beer" });
    expect(dog.ok && dog.value.wallCategory).toBe("dog");
    expect(dog.ok && dog.value.drinkCategory).toBe(null);
    const pint = validateVenuePhotoSubmission({ venueId: "venue-abc" });
    expect(pint.ok && pint.value.wallCategory).toBe("pint");
    const other = validateVenuePhotoSubmission({ venueId: "venue-abc", wallCategory: "london" });
    expect(other.ok && other.value.wallCategory).toBe("pint");
  });

  it("matches the CHECK in migration 0212, whose rollback moves dogs to pub", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const forward = readFileSync(path.join(dir, "20261031030000_0212_drink_wall_dog_category.sql"), "utf8");
    const words = DRINK_WALL_CATEGORIES.map((word) => `'${word}'`).join(", ");
    expect(forward).toContain(`check (wall_category in (${words}))`);
    const rollback = readFileSync(
      path.join(dir, "rollback", "20261031030000_0212_drink_wall_dog_category_rollback.sql"),
      "utf8",
    );
    const move = rollback.indexOf("update public.venue_photos set wall_category = 'pub' where wall_category = 'dog'");
    const narrow = rollback.indexOf("check (wall_category in ('pint', 'london', 'pub'))");
    expect(move).toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(move);
  });
});

describe("pickDogOfTheWeek", () => {
  it("takes the newest Dog photo that names its pub", () => {
    const dog = pickDogOfTheWeek([
      photo({ id: "a", wallCategory: "pint" }),
      photo({ id: "b", venueName: null }),
      photo({ id: "c", caption: "Biscuit" }),
      photo({ id: "d" }),
    ]);
    expect(dog).toMatchObject({ photoId: "c", venueName: "The Dog and Duck", handle: "karan", caption: "Biscuit" });
  });

  it("answers nothing when no Dog photo is approved", () => {
    expect(pickDogOfTheWeek([])).toBeNull();
    expect(pickDogOfTheWeek([photo({ wallCategory: "pub" })])).toBeNull();
  });
});

describe("the Dog of the week page", () => {
  it("shows the photo, the pub with a link to its page, and the uploader's handle", () => {
    const html = renderToStaticMarkup(<DogOfTheWeekBody read={{ status: "ready", dog: DOG }} />);
    expect(html).toContain('href="/pubs/venue-abc"');
    expect(html).toContain("Met at The Dog and Duck");
    expect(html).toContain("Photo by @karan");
    expect(html).toContain("Biscuit, a regular");
    expect(html).toContain('alt="A dog at The Dog and Duck: Biscuit, a regular"');
  });

  it("prints the empty state when no approved Dog photo exists", () => {
    const html = renderToStaticMarkup(<DogOfTheWeekBody read={{ status: "ready", dog: null }} />);
    expect(html).toContain("No dog yet. Upload one from a pub&#x27;s photo wall.");
    expect(DOG_OF_THE_WEEK_EMPTY_LINE).toBe("No dog yet. Upload one from a pub's photo wall.");
  });

  it("says the wall could not be read rather than that there is no dog", () => {
    const html = renderToStaticMarkup(<DogOfTheWeekBody read={{ status: "unavailable" }} />);
    expect(html).toContain("We could not read the photo wall just now.");
    expect(html).not.toContain("No dog yet");
    expect(DOG_OF_THE_WEEK_UNREAD_LINE).not.toContain("!");
  });
});

describe("the Discover card", () => {
  it("links to the page and names the pub", () => {
    const html = renderToStaticMarkup(<DogOfTheWeekCardView dog={DOG} />);
    expect(html).toContain('href="/dog-of-the-week"');
    expect(html).toContain("Dog of the week");
    expect(html).toContain("Met at The Dog and Duck");
  });

  it("shows nothing when there is no dog", () => {
    expect(renderToStaticMarkup(<DogOfTheWeekCardView dog={null} />)).toBe("");
  });
});

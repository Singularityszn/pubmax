// A deploy can land before the captain applies 0158. Until then the durable
// venue_photos table has no wall_category or place_label column, and PostgREST
// refuses any insert that names one. An ordinary pub-wall photo must still save;
// only a Drink Wall row that needs the new columns may depend on 0158.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/deploymentEnv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploymentEnv")>()),
  isDeployedProduction: () => true,
}));

const supabase = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
}));

const PRE_0158_COLUMNS = new Set([
  "id",
  "venue_id",
  "author_actor",
  "author_profile_id",
  "object_key",
  "drink_category",
  "caption",
  "width",
  "height",
  "moderation_state",
  "report_count",
  "report_actors",
  "reported_at",
  "report_reason",
  "moderated_at",
  "moderator_note",
  "created_at",
]);

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => true,
  requiresSupabaseStore: () => false,
  requireSupabaseAdmin: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        const unknown = Object.keys(row).find((column) => !PRE_0158_COLUMNS.has(column));
        if (unknown) {
          return {
            error: {
              code: "PGRST204",
              message: `Could not find the '${unknown}' column of 'venue_photos' in the schema cache`,
            },
          };
        }
        supabase.inserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { venuePhotoStore } from "@/lib/venuePhotoStore";
import { drinkWallServingKey, venuePhotoServingKey } from "@/lib/venuePhotos";
import { defined } from "@/__tests__/helpers/defined";

const PROFILE = "22222222-2222-4222-8222-222222222222";
const VENUE = "venue-1f5ygjb";

beforeEach(() => {
  supabase.inserted = [];
});

describe("venue photo insert before 0158 is applied", () => {
  it("saves an ordinary pub-wall pint photo", async () => {
    const id = crypto.randomUUID();
    const photo = await venuePhotoStore().create({
      id,
      venueId: VENUE,
      wallCategory: "pint",
      placeLabel: "",
      authorActor: `profile:${PROFILE}`,
      authorProfileId: PROFILE,
      objectKey: venuePhotoServingKey(VENUE, id),
      drinkCategory: null,
      caption: "",
      width: 1080,
      height: 1350,
    });
    expect(photo.wallCategory).toBe("pint");
    expect(supabase.inserted).toHaveLength(1);
    expect(defined(supabase.inserted[0]).id).toBe(id);
  });

  it("refuses a city photo, which needs the 0158 columns, and names the migration", async () => {
    const id = crypto.randomUUID();
    await expect(
      venuePhotoStore().create({
        id,
        venueId: null,
        wallCategory: "london",
        placeLabel: "South Bank",
        authorActor: `profile:${PROFILE}`,
        authorProfileId: PROFILE,
        objectKey: drinkWallServingKey(id),
        drinkCategory: null,
        caption: "",
        width: 1080,
        height: 1350,
      }),
    ).rejects.toThrow(/0158/);
    expect(supabase.inserted).toHaveLength(0);
  });
});

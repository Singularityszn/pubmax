import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DRINK_WALL_CATEGORIES,
  drinkWallServingKey,
  photoObjectKey,
  venuePhotoServingKey,
} from "@/lib/venuePhotos";

const FORWARD = readFileSync(
  join(process.cwd(), "supabase/migrations/20260926120000_0158_drink_wall.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(process.cwd(), "supabase/migrations/rollback/20260926120000_0158_drink_wall_rollback.sql"),
  "utf8",
);

describe("drink wall migration 0158", () => {
  it("is one transaction", () => {
    expect(FORWARD).toMatch(/^begin;$/m);
    expect(FORWARD.trim().endsWith("commit;")).toBe(true);
  });

  it("mirrors closed wall categories", () => {
    for (const cat of DRINK_WALL_CATEGORIES) {
      expect(FORWARD).toContain(`'${cat}'`);
    }
  });

  it("allows city-only object keys", () => {
    expect(FORWARD).toContain("drink-wall/");
    expect(photoObjectKey("PHOTO", null)).toBe(drinkWallServingKey("PHOTO"));
    expect(photoObjectKey("PHOTO", "VENUE")).toBe(venuePhotoServingKey("VENUE", "PHOTO"));
  });

  it("rollback removes client grants", () => {
    expect(ROLLBACK).toContain("revoke all on table public.venue_photos");
    expect(ROLLBACK).toContain("delete from public.venue_photos where venue_id is null");
  });
});

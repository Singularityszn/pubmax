import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/venue/[id]/route";
import type { SlimVenue } from "@/lib/venuesSlim";

const ROOT = path.resolve(__dirname, "..");
const SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const slim = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as SlimVenue[];

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/venue/[id]", () => {
  it("returns full detail for a slim venue id", async () => {
    const seed = slim.find((venue) => venue.id === "venue-16pnwmm") ?? slim[0];
    const res = await GET(new Request(`http://localhost/api/venue/${seed.id}`), ctx(seed.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.venue.id).toBe(seed.id);
    expect(body.venue.name).toBe(seed.name);
    expect(Array.isArray(body.venue.prices)).toBe(true);
    expect(body.venue.prices.length).toBeGreaterThan(0);
    expect(body.venue.address.length).toBeGreaterThan(0);
  });

  it("returns a friendly 404 for an unknown venue id", async () => {
    const res = await GET(
      new Request("http://localhost/api/venue/venue-does-not-exist"),
      ctx("venue-does-not-exist"),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Venue not found." });
  });
});

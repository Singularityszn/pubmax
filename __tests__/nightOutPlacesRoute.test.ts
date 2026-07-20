import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/night-out-places/route";

describe("GET /api/night-out-places", () => {
  it("requires an explicit night-out job and a London anchor", async () => {
    const missing = await GET(new Request("http://localhost/api/night-out-places"));
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({
      code: "INVALID_NIGHT_OUT_JOB",
      retryable: false,
    });

    const outside = await GET(
      new Request(
        "http://localhost/api/night-out-places?job=near_pub_food&lat=53.48&lng=-2.24",
      ),
    );
    expect(outside.status).toBe(400);
    await expect(outside.json()).resolves.toMatchObject({
      code: "INVALID_LONDON_ANCHOR",
    });
  });

  it("returns the committed honest empty state without inventing fallback rows", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/night-out-places?job=near_pub_food&lat=51.513&lng=-0.131",
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "empty",
      job: "near_pub_food",
      places: [],
      message: "No sourced spots have cleared our checks near here yet.",
    });
  });
});

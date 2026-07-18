import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/tonight-conditions/route";

function call(query = ""): Promise<Response> {
  return GET(new Request(`https://pubmaxxing.com/api/tonight-conditions${query}`));
}

describe("GET /api/tonight-conditions", () => {
  it("always answers 200 with no-store and a summary field", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { summary: unknown };
    expect(body).toHaveProperty("summary");
  });

  it("degrades to summary:null while the shipped weather snapshot is empty", async () => {
    // The bundled public/data/weather/latest.json has no observations, so the
    // strip honestly shows nothing rather than inventing weather.
    const body = (await (await call()).json()) as { summary: unknown };
    expect(body.summary).toBeNull();
  });

  it("accepts an optional rounded location without throwing", async () => {
    const res = await call("?lat=51.511&lng=-0.134");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: unknown };
    expect(body).toHaveProperty("summary");
  });

  it("ignores malformed coordinates and still answers cleanly", async () => {
    const res = await call("?lat=not-a-number&lng=999");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: unknown };
    expect(body.summary).toBeNull();
  });
});

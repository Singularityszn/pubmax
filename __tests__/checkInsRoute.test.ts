import { beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/check-ins/route";
import { __resetMemoryCheckIns } from "@/lib/checkInStore";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

// Keyless env (vitest.setup strips SUPABASE_*) → the route runs on the in-memory
// stores and the process-local rate limiter, so this drives it end to end.

function postBody(body: unknown): Request {
  return new Request("http://localhost/api/check-ins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  __resetMemoryCheckIns();
  __resetMemoryFollows();
  __resetMemoryProfiles();
});

describe("POST /api/check-ins", () => {
  it("creates a check-in (201) for a valid body", async () => {
    const res = await POST(postBody({ handle: "karan", areaSlug: "shoreditch", note: "out" }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { checkIn?: { handle: string; areaSlug: string } };
    expect(data.checkIn?.handle).toBe("karan");
    expect(data.checkIn?.areaSlug).toBe("shoreditch");
  });

  it("400s a malformed body", async () => {
    const res = await POST(
      new Request("http://localhost/api/check-ins", { method: "POST", body: "{oops" }),
    );
    expect(res.status).toBe(400);
  });

  it("400s a missing handle", async () => {
    const res = await POST(postBody({ areaSlug: "shoreditch" }));
    expect(res.status).toBe(400);
  });

  it("400s an unknown area", async () => {
    const res = await POST(postBody({ handle: "karan", areaSlug: "atlantis" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/check-ins", () => {
  it("returns a mutual friend's check-in for the viewer", async () => {
    const s = followStore();
    await s.follow("karan", "amy");
    await s.follow("amy", "karan");
    await POST(postBody({ handle: "amy", areaSlug: "brixton" }));

    const res = await GET(new Request("http://localhost/api/check-ins?viewer=karan"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { checkIns: { handle: string }[] };
    expect(data.checkIns.map((c) => c.handle)).toContain("amy");
  });

  it("does not return a non-mutual's check-in", async () => {
    await POST(postBody({ handle: "stranger", areaSlug: "brixton" }));
    const res = await GET(new Request("http://localhost/api/check-ins?viewer=karan"));
    const data = (await res.json()) as { checkIns: { handle: string }[] };
    expect(data.checkIns).toEqual([]);
  });

  it("scope=area returns only area-public check-ins", async () => {
    await POST(postBody({ handle: "karan", areaSlug: "camden", visibility: "friends" }));
    await POST(postBody({ handle: "amy", areaSlug: "camden", visibility: "area" }));
    const res = await GET(new Request("http://localhost/api/check-ins?scope=area"));
    const data = (await res.json()) as { checkIns: { handle: string; visibility: string }[] };
    expect(data.checkIns.every((c) => c.visibility === "area")).toBe(true);
    expect(data.checkIns.map((c) => c.handle)).toContain("amy");
    expect(data.checkIns.map((c) => c.handle)).not.toContain("karan");
  });

  it("an anonymous viewer sees nothing", async () => {
    await POST(postBody({ handle: "karan", areaSlug: "camden" }));
    const res = await GET(new Request("http://localhost/api/check-ins"));
    const data = (await res.json()) as { checkIns: unknown[] };
    expect(data.checkIns).toEqual([]);
  });
});

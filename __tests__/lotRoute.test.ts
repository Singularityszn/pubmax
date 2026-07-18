import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/profiles/[handle]/lot/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

beforeEach(() => {
  __resetMemoryFollows();
  __resetMemoryProfiles();
});

function call(handle: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/profiles/${handle}/lot`), {
    params: Promise.resolve({ handle }),
  });
}

describe("GET /api/profiles/[handle]/lot", () => {
  it("returns the mutual-follow handles (the lot)", async () => {
    const s = followStore();
    await s.follow("karan", "amy");
    await s.follow("amy", "karan");
    await s.follow("karan", "ben"); // one-way, not in the lot

    const res = await call("karan");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { lot: string[] };
    expect(data.lot).toEqual(["amy"]);
  });

  it("returns an empty lot for an empty handle (never 400)", async () => {
    const res = await GET(new Request("http://localhost/api/profiles//lot"), {
      params: Promise.resolve({ handle: "" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { lot: string[] }).toEqual({ lot: [] });
  });
});

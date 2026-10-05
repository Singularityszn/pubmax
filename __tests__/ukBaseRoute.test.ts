import { promises as fs } from "fs";
import path from "path";

import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/uk-base/[id]/route";
import { resetUkBaseIndexForTests } from "@/lib/ukBaseIndex";
import { parseUkBaseManifest, ukBaseIdFor } from "@/lib/ukBasePubs";
import { defined } from "@/__tests__/helpers/defined";

async function firstCommittedId(): Promise<string> {
  const manifestRaw = await fs.readFile(
    path.join(process.cwd(), "public", "data", "uk_base", "manifest.json"),
    "utf8",
  );
  const manifest = parseUkBaseManifest(JSON.parse(manifestRaw));
  if (!manifest) throw new Error("Committed UK base manifest is malformed");
  const shardRaw = await fs.readFile(
    path.join(process.cwd(), "public", defined(manifest.shards[0]).url.replace(/^\//, "")),
    "utf8",
  );
  const shard = JSON.parse(shardRaw) as { pubs: Array<[string, ...unknown[]]> };
  return ukBaseIdFor(defined(shard.pubs[0])[0]);
}

beforeEach(() => {
  resetUkBaseIndexForTests();
});

describe("GET /api/uk-base/[id]", () => {
  it("returns a committed base pub", async () => {
    const id = await firstCommittedId();
    const res = await GET(new Request(`http://localhost/api/uk-base/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pub: { id: string; name: string } };
    expect(body.pub.id).toBe(id);
    expect(body.pub.name.length).toBeGreaterThan(0);
  });

  it("404s a well-formed id the pack does not carry", async () => {
    const id = "venue-uk-n0000000000";
    const res = await GET(new Request(`http://localhost/api/uk-base/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(404);
  });

  it("400s a curated venue id", async () => {
    const id = "venue-7l4pei";
    const res = await GET(new Request(`http://localhost/api/uk-base/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(400);
  });

  // Next already decodes an App Router dynamic param, so `%25` in the path
  // reaches the handler as a literal `%`. A second decodeURIComponent threw
  // `URIError: URI malformed`, which nothing caught: the route answered a
  // bodyless 500 and left the one-envelope law behind. Every malformed param
  // is now the documented 400 with a readable body.
  const malformed: Array<{ id: string; status: number; code: string }> = [
    // Not a base id at all, so the shape check answers first.
    { id: "%", status: 400, code: "INVALID_REQUEST" },
    { id: "%2", status: 400, code: "INVALID_REQUEST" },
    // Base-shaped and holding a literal `%`, which the second decode mangled
    // as well as crashing on: the pack does not carry it, so it is a 404.
    { id: "venue-uk-%", status: 404, code: "NOT_FOUND" },
    { id: "venue-uk-%zz", status: 404, code: "NOT_FOUND" },
    { id: "venue-uk-n1%23", status: 404, code: "NOT_FOUND" },
  ];
  for (const { id, status, code } of malformed) {
    it(`answers the envelope for the param ${JSON.stringify(id)}`, async () => {
      const res = await GET(
        new Request(`http://localhost/api/uk-base/${encodeURIComponent(id)}`),
        { params: Promise.resolve({ id }) },
      );
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toMatchObject({ code });
    });
  }
});

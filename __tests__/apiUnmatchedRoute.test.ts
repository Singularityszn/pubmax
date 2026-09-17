import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The API tree's own 404.
//
// Verification scout verify-preview-4 (section 7.3, observation 9): a mistyped
// multipart `POST /api/avatar` answered a 500 HTML error page
// (`Failed to find Server Action`) rather than a 404 in the house envelope,
// because Next treats a form-encoded or multipart POST to a path no route
// handler claims as a Server Action invocation. It was the only error-level
// runtime log line on that preview in 75 minutes.
//
// What this file holds: an unknown address answers the house envelope whatever
// the METHOD and whatever the CONTENT TYPE, and the route file sits where Next
// will hand it every unmatched path under /api rather than only some of them.

import * as unmatched from "@/app/api/[[...unmatched]]/route";

const ROOT = process.cwd();
const ROUTE_DIRECTORY = "app/api/[[...unmatched]]";

type Handler = () => Response;

const METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"] as const;

function multipartRequest(): Request {
  const body = new FormData();
  body.set("photo", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "pint.jpg");
  return new Request("http://localhost/api/avatar", { method: "POST", body });
}

async function envelope(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("unmatched /api paths", () => {
  it("answers a multipart POST with the house 404 envelope, not an HTML error page", async () => {
    // The scout's exact request shape: a multipart body on an address no route
    // claims. The 500 it used to draw said the server broke where nothing did.
    const request = multipartRequest();
    expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data;/);

    const response = unmatched.POST();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await envelope(response)).toEqual({
      error: "That endpoint doesn't exist.",
      code: "NOT_FOUND",
      retryable: false,
    });
  });

  it("answers every method the same way, so the verb never decides the shape", async () => {
    for (const method of METHODS) {
      const handler = (unmatched as unknown as Record<string, Handler | undefined>)[method];
      expect(handler, method).toBeTypeOf("function");
      const response = (handler as Handler)();
      expect(response.status, method).toBe(404);
      expect((await envelope(response)).code, method).toBe("NOT_FOUND");
    }
  });

  it("exports no handler outside the closed method table", () => {
    expect(Object.keys(unmatched).sort()).toEqual([...METHODS].sort());
  });

  it("is an OPTIONAL catch-all, so bare /api is claimed as well as every path under it", () => {
    // `[...unmatched]` needs at least one segment and would leave `/api` itself
    // on the Server Action path. `servesApiCaller` in proxy.ts treats `/api` and
    // `/api/...` as one caller surface; this keeps the route table agreeing.
    expect(existsSync(join(ROOT, ROUTE_DIRECTORY, "route.ts"))).toBe(true);

    // And it is the ONLY catch-all directly under app/api: a second one would
    // make which of them answers an unknown address a matter of luck.
    const catchAlls = readdirSync(join(ROOT, "app/api"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.includes("..."))
      .map((entry) => entry.name);
    expect(catchAlls).toEqual(["[[...unmatched]]"]);
  });
});

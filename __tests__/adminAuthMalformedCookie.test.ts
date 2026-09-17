import { afterEach, describe, expect, it, vi } from "vitest";

import { isModerator } from "@/lib/adminAuth";

function requestWithCookie(cookie: string): Request {
  return new Request("https://example.com/api/admin/comments", {
    headers: { cookie },
  });
}

describe("admin session cookie decode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads a malformed session cookie as absent rather than throwing", () => {
    // decodeURIComponent throws URIError on an invalid percent-escape. A
    // stale or hand-edited pubmax_admin_session cookie used to turn that
    // into an unhandled 500 for every /api/admin/* route instead of the
    // intended "not a moderator" refusal.
    vi.stubEnv("ADMIN_TOKEN", "super-secret-token");
    for (const junk of ["%zz", "%", "%E0%A4%A", "abc%"]) {
      expect(() =>
        isModerator(requestWithCookie(`pubmax_admin_session=${junk}`)),
      ).not.toThrow();
      expect(isModerator(requestWithCookie(`pubmax_admin_session=${junk}`))).toBe(false);
    }
  });
});

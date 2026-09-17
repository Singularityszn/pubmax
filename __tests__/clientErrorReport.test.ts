import { describe, expect, it } from "vitest";

import {
  buildClientErrorReport,
  CLIENT_ERROR_MESSAGE_MAX,
  CLIENT_ERROR_NAME_MAX,
  describeThrownValue,
  redactClientErrorText,
} from "@/lib/clientErrorReport";

// GAP 16. The endpoint's whole claim is that a report carries nothing about a
// person, so what is tested here is the redaction itself, class by class of
// value, plus the closed route vocabulary that keeps a URL out by
// construction rather than by a regex hoping to catch one.

const redact = (value: unknown) => redactClientErrorText(value, CLIENT_ERROR_MESSAGE_MAX);

describe("redactClientErrorText", () => {
  it("takes the query string off a URL, and the URL with it", () => {
    expect(redact("Failed to fetch https://pubmaxxing.com/map?sel=venue-123&token=abc"))
      .toBe("Failed to fetch <url>");
  });

  it("strips a bare query string left on a relative path", () => {
    expect(redact("GET /api/venue?id=secret failed")).toBe("GET /api/venue failed");
  });

  it("names an email rather than carrying one", () => {
    expect(redact("no account for drinker.name+tag@example.co.uk")).toBe("no account for <email>");
  });

  it("names a handle rather than carrying one", () => {
    expect(redact("cannot follow @some_drinker")).toBe("cannot follow <handle>");
  });

  it("removes a bearer token, a JWT, a long hex string and a UUID", () => {
    expect(redact("Authorization: Bearer abc.def.ghi")).toContain("<redacted>");
    expect(redact("bad jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-here"))
      .not.toContain("eyJhbGci");
    expect(redact(`hash ${"a".repeat(40)}`)).not.toContain("a".repeat(40));
    expect(redact("plan 3f2504e0-4f89-11d3-9a0c-0305e82c3301 missing"))
      .toBe("plan <id> missing");
  });

  it("flattens control characters and collapses whitespace", () => {
    expect(redact("line one\nline\ttwo")).toBe("line one line two");
  });

  it("bounds the text and answers empty for a non-string", () => {
    // Words, not one long run: a 40-character run is token-shaped and is
    // replaced outright, which is the rule above rather than the bound here.
    expect(redact("failed to load a thing ".repeat(80)))
      .toHaveLength(CLIENT_ERROR_MESSAGE_MAX);
    expect(redact(undefined)).toBe("");
    expect(redact({ message: "nope" })).toBe("");
  });
});

describe("buildClientErrorReport", () => {
  it("builds the whole report from a browser's own values", () => {
    expect(
      buildClientErrorReport({
        kind: "unhandledrejection",
        name: "TypeError",
        message: "Failed to fetch",
        path: "/u/some-drinker",
        shell: "native",
      }),
    ).toEqual({
      kind: "unhandledrejection",
      name: "TypeError",
      message: "Failed to fetch",
      // The handle never reaches the report: the closed vocabulary templates it.
      route: "/u/[handle]",
      shell: "native",
    });
  });

  it("answers a null route rather than a path it does not know", () => {
    const report = buildClientErrorReport({
      kind: "error",
      name: "Error",
      message: "boom",
      path: "/some/unknown/surface",
      shell: "web",
    });
    expect(report?.route).toBeNull();
  });

  it("never takes a URL as the route", () => {
    const report = buildClientErrorReport({
      kind: "error",
      message: "boom",
      path: "https://pubmaxxing.com/map?sel=venue-123",
      shell: "web",
    });
    expect(report?.route).toBeNull();
  });

  it("refuses an unknown kind and an empty message", () => {
    expect(buildClientErrorReport({ kind: "crash", message: "boom" })).toBeNull();
    expect(buildClientErrorReport({ kind: "error", message: "" })).toBeNull();
    expect(buildClientErrorReport({ kind: "error", message: "   " })).toBeNull();
  });

  it("falls back to web for an unknown shell and to Error for a missing class", () => {
    const report = buildClientErrorReport({ kind: "error", message: "boom", shell: "desktop" });
    expect(report).toMatchObject({ shell: "web", name: "Error" });
  });

  it("bounds the error class too", () => {
    const report = buildClientErrorReport({
      kind: "error",
      name: "Very Odd Error Class ".repeat(20),
      message: "boom",
    });
    expect(report?.name).toHaveLength(CLIENT_ERROR_NAME_MAX);
  });

  it("replaces a secret-length run in the class rather than truncating it", () => {
    const report = buildClientErrorReport({
      kind: "error",
      name: "N".repeat(500),
      message: "boom",
    });
    expect(report?.name).toBe("<token>");
  });
});

describe("describeThrownValue", () => {
  it("reads an Error, a string and a plain object alike", () => {
    expect(describeThrownValue(new TypeError("bad"))).toEqual({ name: "TypeError", message: "bad" });
    expect(describeThrownValue("bad")).toEqual({ name: "Error", message: "bad" });
    expect(describeThrownValue({ name: "CustomError", message: "bad" }))
      .toEqual({ name: "CustomError", message: "bad" });
    expect(describeThrownValue(undefined)).toEqual({ name: "Error", message: "" });
  });
});

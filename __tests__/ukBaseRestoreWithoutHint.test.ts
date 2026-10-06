import { describe, expect, it } from "vitest";

import {
  ukBaseRestoreFailureNotice,
  ukBaseRestoreFor,
} from "@/lib/pubMap";

describe("ukBaseRestoreFor", () => {
  it("keeps the id and the at= hint when the link carries both", () => {
    expect(
      ukBaseRestoreFor("venue-uk-n311153571", "?sel=venue-uk-n311153571&at=51.5057,-0.1377"),
    ).toEqual({ id: "venue-uk-n311153571", hint: { lat: 51.5057, lng: -0.1377 } });
  });

  it("still restores a base pub when the link has no at= hint", () => {
    expect(ukBaseRestoreFor("venue-uk-n311153571", "?sel=venue-uk-n311153571")).toEqual({
      id: "venue-uk-n311153571",
      hint: null,
    });
  });

  it("treats a malformed hint as no hint, not as no restore", () => {
    expect(ukBaseRestoreFor("venue-uk-n1", "?at=nope")).toEqual({
      id: "venue-uk-n1",
      hint: null,
    });
  });

  it("restores nothing for a curated or empty selection", () => {
    expect(ukBaseRestoreFor("venue-1vle947", "?at=51.5,-0.1")).toBeNull();
    expect(ukBaseRestoreFor("", "")).toBeNull();
    expect(ukBaseRestoreFor(null, "")).toBeNull();
  });
});

describe("ukBaseRestoreFailureNotice", () => {
  it("names an id nothing knows as an unknown pub", () => {
    expect(ukBaseRestoreFailureNotice("missing")).toBe("unknown");
  });

  it("names an unreadable pack as a failed lookup, not an unknown pub", () => {
    expect(ukBaseRestoreFailureNotice("unavailable")).toBe("lookup-failed");
  });
});

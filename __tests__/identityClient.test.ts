import { describe, expect, it } from "vitest";

import { identityHandleForOwner } from "@/lib/identityClient";

describe("identity handle events", () => {
  it("accepts handle changes only for the current account", () => {
    const detail = { ownerId: "user-a", handle: "alice" };

    expect(identityHandleForOwner(detail, "user-a")).toBe("alice");
    expect(identityHandleForOwner(detail, "user-b")).toBeNull();
    expect(identityHandleForOwner(detail, null)).toBeNull();
  });

  it("rejects legacy unscoped handle events", () => {
    expect(identityHandleForOwner({ handle: "alice" }, "user-a")).toBeNull();
  });
});

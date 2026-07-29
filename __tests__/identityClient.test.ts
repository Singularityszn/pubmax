import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitIdentityHandleChanged,
  identityHandleForOwner,
} from "@/lib/identityClient";

const ROOT = process.cwd();

describe("identity handle events", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts handle changes only for the current account", () => {
    const detail = { ownerId: "user-a", handle: "alice" };

    expect(identityHandleForOwner(detail, "user-a")).toBe("alice");
    expect(identityHandleForOwner(detail, "user-b")).toBeNull();
    expect(identityHandleForOwner(detail, null)).toBeNull();
  });

  it("rejects legacy unscoped handle events", () => {
    expect(identityHandleForOwner({ handle: "alice" }, "user-a")).toBeNull();
  });

  it("keeps AuthProvider handles scoped to their owning account", () => {
    const source = readFileSync(
      join(ROOT, "components/auth/AuthProvider.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /useState<IdentityHandleChangedDetail \| null>\(null\)/,
    );
    expect(source).toMatch(
      /handle:\s*identityHandleForOwner\(\s*canonicalIdentity,\s*user\?\.id \?\? null,\s*\)/,
    );
    expect(source).not.toContain("handle: canonicalHandle");
  });

  it("invalidates matching anonymous Round identity when claimed", () => {
    const values = new Map<string, string>([
      [
        "pubmax_round_anonymous_identity_v1",
        JSON.stringify({ owner: "anonymous", handle: "bob" }),
      ],
    ]);
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    vi.stubGlobal("window", {
      localStorage,
      dispatchEvent: vi.fn(),
    });

    emitIdentityHandleChanged({ ownerId: "user-bob", handle: "@Bob" });

    expect(values.has("pubmax_round_anonymous_identity_v1")).toBe(false);
  });

  it("preserves an unrelated anonymous Round identity after a claim", () => {
    const stored = JSON.stringify({ owner: "anonymous", handle: "alice" });
    const values = new Map<string, string>([
      ["pubmax_round_anonymous_identity_v1", stored],
    ]);
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    vi.stubGlobal("window", {
      localStorage,
      dispatchEvent: vi.fn(),
    });

    emitIdentityHandleChanged({ ownerId: "user-bob", handle: "bob" });

    expect(values.get("pubmax_round_anonymous_identity_v1")).toBe(stored);
  });
});

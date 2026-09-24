import { afterEach, describe, expect, it } from "vitest";

import {
  __resetMemoryAccountEnforcement,
  __setMemoryAccountEnforcement,
  profilePublicPresence,
} from "@/lib/accountPublicAccess.server";

describe("account public access", () => {
  afterEach(() => {
    __resetMemoryAccountEnforcement();
  });

  it("treats a banned or suspended owner as withdrawn", async () => {
    __setMemoryAccountEnforcement("user-banned", {
      authBanned: true,
      socialSuspended: false,
    });
    await expect(
      profilePublicPresence({ userId: "user-banned", tombstonedAt: undefined }),
    ).resolves.toBe("withdrawn");
  });

  it("keeps tombstoned accounts on the gone lane", async () => {
    await expect(
      profilePublicPresence({
        userId: "user-gone",
        tombstonedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).resolves.toBe("gone");
  });
});

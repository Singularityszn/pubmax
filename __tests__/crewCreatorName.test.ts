import { describe, expect, it } from "vitest";

import { creatorNameFromAccount } from "@/lib/crew";

// Battle test L05: this name is the PUBLIC host name on the plan, the share
// card and the unfurler. It used to default to the account's email local part,
// so a link that reached a whole group announced "pentest.alice is planning a
// night out".
describe("creatorNameFromAccount", () => {
  it("prefers the public handle over a provider display name", () => {
    expect(creatorNameFromAccount({
      handle: "karansznx",
      user: { user_metadata: { full_name: "Karan M", name: "ignored" } },
    })).toBe("karansznx");
  });

  it("falls back to a volunteered display name when there is no handle", () => {
    expect(creatorNameFromAccount({
      handle: null,
      user: { user_metadata: { full_name: "Karan M" } },
    })).toBe("Karan M");
    expect(creatorNameFromAccount({
      handle: null,
      user: { user_metadata: { name: "Karan" } },
    })).toBe("Karan");
  });

  it("never reaches for the email address", () => {
    expect(creatorNameFromAccount({
      handle: null,
      user: {
        user_metadata: {},
        // The shape the old rule read from, kept here so a reader who puts it
        // back sees this test fail rather than a stranger's inbox name.
        ...({ email: "pentest.alice@example.com" } as Record<string, unknown>),
      },
    })).toBe("");
    expect(creatorNameFromAccount({ handle: null, user: null })).toBe("");
  });

  it("cleans the name it hands back", () => {
    expect(creatorNameFromAccount({
      handle: "  karansznx  ",
      user: null,
    })).toBe("karansznx");
  });
});

import { describe, expect, it } from "vitest";

import {
  errorMessageFrom,
  findYourLotInviteFailureMessage,
  INVITE_LINK_FALLBACK_MESSAGE,
  OFFLINE_RETRY_MESSAGE,
  offlineOrMessage,
} from "@/lib/apiErrorMessage";

describe("errorMessageFrom", () => {
  it("returns a non-empty string error", () => {
    expect(errorMessageFrom({ error: "Could not save that." }, "fallback")).toBe(
      "Could not save that.",
    );
  });

  it("returns a legacy nested error message", () => {
    expect(
      errorMessageFrom({ error: { code: "FAILED", message: "Try again." } }, "fallback"),
    ).toBe("Try again.");
  });

  it("uses fallback for an object error without a message", () => {
    expect(errorMessageFrom({ error: { code: "FAILED" } }, "fallback")).toBe("fallback");
  });

  it("uses fallback for a null body", () => {
    expect(errorMessageFrom(null, "fallback")).toBe("fallback");
  });

  it("uses fallback for an empty string error", () => {
    expect(errorMessageFrom({ error: "" }, "fallback")).toBe("fallback");
  });

  it("uses fallback when an HTML response cannot be parsed as JSON", async () => {
    const body = await new Response("<html>gateway failure</html>").json().catch(() => null);

    expect(body).toBeNull();
    expect(errorMessageFrom(body, "fallback")).toBe("fallback");
  });
});

describe("offlineOrMessage", () => {
  it("returns offline copy when the browser is offline", () => {
    const online = navigator.onLine;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    try {
      expect(offlineOrMessage("Could not copy link. Try again.")).toBe(
        OFFLINE_RETRY_MESSAGE,
      );
    } finally {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: online,
      });
    }
  });

  it("returns the online message when the browser is online", () => {
    expect(offlineOrMessage("Could not copy link. Try again.")).toBe(
      "Could not copy link. Try again.",
    );
  });
});

describe("FindYourLot invite failure copy", () => {
  it("uses fallback for a structured error without leaking object coercion", () => {
    const message = findYourLotInviteFailureMessage(
      { error: { code: "X" } },
      true,
    );

    expect(message).toBe(INVITE_LINK_FALLBACK_MESSAGE);
    expect(message).not.toContain("[object Object]");
  });

  it("prefers offline copy when the browser is offline", () => {
    expect(findYourLotInviteFailureMessage({ error: "Server error" }, false)).toBe(
      OFFLINE_RETRY_MESSAGE,
    );
  });
});

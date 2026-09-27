import { afterEach, describe, expect, it, vi } from "vitest";

const trackEvent = vi.fn();

vi.mock("@/lib/analytics", () => ({
  trackEvent,
}));

describe("trackErrorShown", () => {
  afterEach(() => {
    trackEvent.mockClear();
    vi.resetModules();
  });

  it("forwards closed surface and kind enums", async () => {
    const { trackErrorShown } = await import("@/lib/analyticsErrorShown");
    trackErrorShown("plan", "server");
    expect(trackEvent).toHaveBeenCalledWith("error_shown", { surface: "plan", kind: "server" });
  });

  it("drops unknown surfaces", async () => {
    const { trackErrorShown } = await import("@/lib/analyticsErrorShown");
    trackErrorShown("admin" as "plan", "server");
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("derives the error kind from the failed request's status", async () => {
    const { errorShownKindFromStatus } = await import("@/lib/analyticsErrorShown");
    expect(errorShownKindFromStatus(null)).toBe("network");
    expect(errorShownKindFromStatus(401)).toBe("auth");
    expect(errorShownKindFromStatus(403)).toBe("auth");
    expect(errorShownKindFromStatus(400)).toBe("validation");
    expect(errorShownKindFromStatus(429)).toBe("validation");
    expect(errorShownKindFromStatus(500)).toBe("server");
    expect(errorShownKindFromStatus(503)).toBe("server");
    expect(errorShownKindFromStatus(200)).toBe("unknown");
  });
});

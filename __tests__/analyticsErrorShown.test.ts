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
});

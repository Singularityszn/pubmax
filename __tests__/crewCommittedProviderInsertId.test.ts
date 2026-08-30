import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.PLAN_IDEMPOTENCY_SECRET;
  delete process.env.RATE_LIMIT_SALT;
  delete process.env.CREW_DELIVERY_SIGNING_SECRET;
});

describe("crew commitment provider insert id", () => {
  it("stays private and stable when crew delivery signing rotates", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
    process.env.RATE_LIMIT_SALT = "stable-provider-insert-root-0123456789abcdef";
    process.env.CREW_DELIVERY_SIGNING_SECRET = "crew-delivery-before-rotation-0123456789abcdef";
    const analytics = await import("@/lib/verifiedAnalytics.server");
    const derive = (analytics as typeof analytics & {
      crewCommittedProviderInsertId?: (eventId: string) => string;
    }).crewCommittedProviderInsertId;

    expect(derive).toEqual(expect.any(Function));
    const eventId = "33333333-3333-4333-8333-333333333333";
    const before = derive!(eventId);
    process.env.CREW_DELIVERY_SIGNING_SECRET = "crew-delivery-after-rotation-0123456789abcdef";
    const after = derive!(eventId);

    expect(before).toBe("97861be4b137484431c24973acb7af5876d7defaef7d1ba5b4f03379ad332b70");
    expect(after).toBe(before);
    expect(before).not.toContain(eventId);
  });
});

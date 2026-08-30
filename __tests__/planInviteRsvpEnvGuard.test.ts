import { beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ assertServerEnv: vi.fn() }));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: guard.assertServerEnv }));

describe("invite RSVP route environment guard", () => {
  beforeEach(() => {
    guard.assertServerEnv.mockReset();
    vi.resetModules();
  });

  it("guards both durable RSVP route modules at import", async () => {
    await import("@/app/api/invite/[token]/rsvp/route");
    await import("@/app/api/plans/[id]/invite-rsvp/route");

    expect(guard.assertServerEnv).toHaveBeenCalledTimes(2);
  });
});

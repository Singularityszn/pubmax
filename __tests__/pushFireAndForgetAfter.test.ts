import { afterEach, describe, expect, it, vi } from "vitest";

// A push sent after the response must be handed to after(), or Vercel can
// freeze the function before it leaves (database audit, 18 Oct 2026).
const { afterMock } = vi.hoisted(() => ({ afterMock: vi.fn() }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));

import { fireAndForgetPush } from "@/lib/pushSender";

afterEach(() => {
  afterMock.mockReset();
  vi.restoreAllMocks();
});

describe("fireAndForgetPush", () => {
  it("hands the send to after() and never blocks the caller", async () => {
    const run = vi.fn(async () => "sent");
    fireAndForgetPush(run);
    expect(afterMock).toHaveBeenCalledTimes(1);
    await afterMock.mock.calls[0]?.[0];
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed send and still runs it with no request scope", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    afterMock.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
    const run = vi.fn(async () => {
      throw new Error("provider down");
    });
    expect(() => fireAndForgetPush(run)).not.toThrow();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });
});

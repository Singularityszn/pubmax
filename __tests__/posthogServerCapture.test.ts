import { afterEach, describe, expect, it, vi } from "vitest";

const nextServer = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock("next/server", () => ({ after: nextServer.after }));

import { capturePosthogServerEvent } from "@/lib/posthogServer";
import { defined } from "@/__tests__/helpers/defined";

describe("server-side PostHog capture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    nextServer.after.mockReset();
    delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  });

  it("keeps the request alive until the send settles", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    let land!: (value: unknown) => void;
    const fetchMock = vi.fn(() => new Promise((resolve) => { land = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    capturePosthogServerEvent({ event: "$ai_generation", distinctId: "server", properties: {} });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(nextServer.after).toHaveBeenCalledOnce();
    const held = defined(nextServer.after.mock.calls[0])[0] as Promise<unknown>;
    let settled = false;
    void held.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    land({ ok: true });
    await held;
    expect(settled).toBe(true);
  });

  it("still sends outside a request scope and never rejects", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    nextServer.after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    expect(() => capturePosthogServerEvent({
      event: "$exception",
      distinctId: "server",
      properties: {},
    })).not.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends nothing without a project token", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    capturePosthogServerEvent({ event: "$exception", distinctId: "server", properties: {} });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nextServer.after).not.toHaveBeenCalled();
  });
});

import { afterEach, expect, it, vi } from "vitest";

import { isPalLocalThreadId, isPubPalConversationId, newPalLocalThreadId } from "@/lib/pubPalConversationId";
import { providerCallSeconds } from "@/lib/pubPalVoiceProviderDuration.server";

afterEach(() => { vi.unstubAllGlobals(); });

it("mints local threads the stores accept and no ElevenLabs id can match", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newPalLocalThreadId()));
  expect(ids.size).toBe(200);
  for (const id of ids) {
    // The durable store's check constraint (migration 0169) is this same shape.
    expect(isPubPalConversationId(id)).toBe(true);
    expect(isPalLocalThreadId(id)).toBe(true);
  }
  expect(isPalLocalThreadId("conv_01jabcdefghjkmnpqrstvwxyz0")).toBe(false);
  expect(isPalLocalThreadId("conv_palshort")).toBe(false);
});

it("never asks the provider how long a local thread lasted", async () => {
  const fetcher = vi.fn(() => { throw new Error("No provider request permitted"); });
  vi.stubGlobal("fetch", fetcher);
  expect(await providerCallSeconds(newPalLocalThreadId(), "offline-test-key")).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

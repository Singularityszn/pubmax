import { afterEach, expect, it, vi } from "vitest";

vi.mock("@typesafe-ai/sdk", () => ({ TypeSafeClient: vi.fn() }));

import { TypeSafeClient } from "@typesafe-ai/sdk";
import { systemOneOutcome } from "@/lib/ai/typesafe.server";

afterEach(() => vi.unstubAllEnvs());

it("refuses a zero TypeSafe ceiling before constructing the provider client", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-key");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_TYPESAFE", "0");
  const result = await systemOneOutcome(
    { message: "hello" },
    { q: { type: "noul", instructions: "test?" } },
    { lane: "typesafe" },
  );
  expect(result).toEqual({ status: "skipped", reason: "budget" });
  expect(TypeSafeClient).not.toHaveBeenCalled();
});

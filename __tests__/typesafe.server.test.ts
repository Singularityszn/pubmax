import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: vi.fn(),
}));

vi.mock("@/lib/paidSpendBudget.server", () => ({
  paidSpendBudgetRefusal: vi.fn(async () => null),
}));

import { TypeSafeClient } from "@typesafe-ai/sdk";

import { systemOne } from "@/lib/ai/typesafe.server";

describe("systemOne", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(TypeSafeClient).mockReset();
  });

  it("returns null without calling the SDK when the API key is unset", async () => {
    delete process.env.TYPESAFE_API_KEY;
    const result = await systemOne(
      { message: "hello" },
      { q: { type: "noul", instructions: "test?" } },
      { lane: "typesafe" },
    );
    expect(result).toBeNull();
    expect(TypeSafeClient).not.toHaveBeenCalled();
  });
});

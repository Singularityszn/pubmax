import { afterEach, expect, it, vi } from "vitest";

vi.mock("@typesafe-ai/sdk", () => ({ TypeSafeClient: vi.fn() }));

import { TypeSafeClient } from "@typesafe-ai/sdk";
import { systemOneOutcome } from "@/lib/ai/typesafe.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import { withPaidSpendOwner, withPaidSpendRequest } from "@/lib/paidSpendBudget.server";

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

it("keeps one caller within its share of the TypeSafe budget", async () => {
  __resetPintDrops();
  vi.stubEnv("TYPESAFE_API_KEY", "fake");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_TYPESAFE", "4");
  const request = new Request("http://localhost", { headers: { "x-real-ip": "203.0.113.10" } });
  const options = { lane: "typesafe" as const, request };
  const call = () => systemOneOutcome({ message: "hello" }, { q: { type: "noul", instructions: "test?" } }, options);
  await call();
  await call();
  expect(await call()).toEqual({ status: "skipped", reason: "budget" });
});

it("keeps the caller context across concurrent model calls", async () => {
  __resetPintDrops();
  vi.stubEnv("TYPESAFE_API_KEY", "fake");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_TYPESAFE", "10");
  const call = (address: string) => withPaidSpendRequest(new Request("http://localhost", { headers: { "x-real-ip": address } }), () =>
    systemOneOutcome({ message: "hello" }, { q: { type: "noul", instructions: "test?" } }, { lane: "typesafe" }));
  const results = await Promise.all(Array.from({ length: 6 }, () => call("203.0.113.10")));
  expect(results.filter((result) => result.status === "skipped")).toHaveLength(1);
  expect((await call("203.0.113.11")).status).toBe("failed");
});

it("shares admission across conversations owned by the same account", async () => {
  __resetPintDrops();
  vi.stubEnv("TYPESAFE_API_KEY", "fake");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_TYPESAFE", "4");
  const call = (ownerId: string) => withPaidSpendOwner(ownerId, () =>
    systemOneOutcome({ message: "hello" }, { q: { type: "noul", instructions: "test?" } }, { lane: "typesafe" }));
  await call("owner-one");
  await call("owner-one");
  expect(await call("owner-one")).toEqual({ status: "skipped", reason: "budget" });
  expect((await call("owner-two")).status).toBe("failed");
});

import { describe, expect, it } from "vitest";
import { createMemoryPaydayStore } from "@/lib/paydayPintStore";

describe("payday pint consent", () => {
  it("requires confirmation and keeps an unsubscribe effective against older confirmations", async () => {
    const store = createMemoryPaydayStore();
    const base = { email: "person@example.test", station: "Oxford Circus", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe-a" };
    await store.request({ ...base, confirmationHash: "first", createdAt: "2026-11-01T00:00:00.000Z" });
    expect(await store.active()).toEqual([]);
    expect(await store.confirm("first", "2026-11-01T01:00:00.000Z")).toBe(true);
    await store.request({ ...base, confirmationHash: "older", unsubscribeToken: "unsubscribe-b", createdAt: "2026-11-02T00:00:00.000Z" });
    await store.unsubscribe("unsubscribe-a", "2026-11-03T00:00:00.000Z");
    expect(await store.confirm("older", "2026-11-04T00:00:00.000Z")).toBe(false);
    expect(await store.active()).toEqual([]);
    await store.request({ ...base, confirmationHash: "new", unsubscribeToken: "unsubscribe-c", createdAt: "2026-11-05T00:00:00.000Z" });
    expect(await store.confirm("new", "2026-11-05T01:00:00.000Z")).toBe(true);
    expect(await store.active()).toHaveLength(1);
    expect(await store.confirm("new", "2026-11-05T02:00:00.000Z")).toBe(false);
  });

  it("rejects a confirmation after its expiry", async () => {
    const store = createMemoryPaydayStore();
    await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe", confirmationHash: "expired", createdAt: "2026-11-01T00:00:00.000Z" });
    expect(await store.confirm("expired", "2026-11-04T00:00:00.000Z")).toBe(false);
    expect(await store.active()).toEqual([]);
  });
});

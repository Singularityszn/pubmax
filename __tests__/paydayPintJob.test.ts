import { expect, it, vi } from "vitest";
import { createMemoryPaydayStore } from "@/lib/paydayPintStore";
import { runPaydayPintJob } from "@/lib/paydayPintJob.server";

it("never delivers when disabled, and only delivers once per Friday to a confirmed subscriber", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe", confirmationHash: "new", createdAt: "2026-11-19T00:00:00.000Z" });
  await store.confirm("new", "2026-11-19T01:00:00.000Z");
  const send = vi.fn(async (messages: readonly { to: string }[]) => messages.map(({ to }) => ({ to, status: "sent" as const })));
  const args = { enabled: false, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [{ id: "a", name: "A pub", lat: 51.5, lng: -0.1, fairPint: [500, "https://example.com", "2026-11-19"] }], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") };
  expect(await runPaydayPintJob(args)).toEqual({ status: "disabled", sent: 0, skipped: 0 });
  expect(send).not.toHaveBeenCalled();
  expect(await runPaydayPintJob({ ...args, enabled: true })).toEqual({ status: "completed", sent: 1, skipped: 0 });
  expect(await runPaydayPintJob({ ...args, enabled: true })).toEqual({ status: "completed", sent: 0, skipped: 1 });
  expect(send).toHaveBeenCalledTimes(1);
});

it("does not deliver after a recipient unsubscribes before dispatch", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe", confirmationHash: "new", createdAt: "2026-11-19T00:00:00.000Z" });
  await store.confirm("new", "2026-11-19T01:00:00.000Z");
  const claim = store.claim;
  store.claim = async (id, week) => { const result = await claim(id, week); await store.unsubscribe("unsubscribe", "2026-11-20T08:59:00.000Z"); return result; };
  const send = vi.fn(async () => []);
  const result = await runPaydayPintJob({ enabled: true, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [{ id: "a", name: "A pub", lat: 51.5, lng: -0.1, fairPint: [500, "https://example.com", "2026-11-19"] }], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") });
  expect(result).toEqual({ status: "completed", sent: 0, skipped: 1 });
  expect(send).not.toHaveBeenCalled();
});

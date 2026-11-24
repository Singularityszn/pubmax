import { expect, it, vi } from "vitest";
import { createMemoryPaydayStore } from "@/lib/paydayPintStore";
import { runPaydayPintJob } from "@/lib/paydayPintJob.server";

it("retries a provider failure in the same week with the same idempotency key", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe", confirmationHash: "new", createdAt: "2026-11-19T00:00:00.000Z" });
  await store.confirm("new", "2026-11-19T01:00:00.000Z");
  const send = vi.fn()
    .mockResolvedValueOnce([{ to: "person@example.test", status: "error" }])
    .mockResolvedValue([{ to: "person@example.test", status: "sent" }]);
  const args = { enabled: true, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") };
  await runPaydayPintJob(args);
  await runPaydayPintJob(args);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]![0][0].idempotencyKey).toBe(send.mock.calls[1]![0][0].idempotencyKey);
});

it("limits retries and checks consent again before each attempt", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe", confirmationHash: "new", createdAt: "2026-11-19T00:00:00.000Z" });
  await store.confirm("new", "2026-11-19T01:00:00.000Z");
  const send = vi.fn().mockResolvedValue([{ to: "person@example.test", status: "error" }]);
  const isActive = vi.spyOn(store, "isActive");
  const args = { enabled: true, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") };
  for (let i = 0; i < 4; i++) await runPaydayPintJob(args);
  expect(send).toHaveBeenCalledTimes(3);
  expect(isActive).toHaveBeenCalledTimes(3);
});

it("never delivers when disabled, and only delivers once per Friday to a confirmed subscriber", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe", confirmationHash: "new", createdAt: "2026-11-19T00:00:00.000Z" });
  await store.confirm("new", "2026-11-19T01:00:00.000Z");
  const send = vi.fn(async (messages: readonly { to: string; html: string; text: string }[]) => messages.map(({ to }) => ({ to, status: "sent" as const })));
  const args = { enabled: false, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [
    { id: "old", name: "Old menu pub", lat: 51.5, lng: -0.1, fairPint: [400, "https://example.com/old", "2026-11-01"] },
    { id: "a", name: "A pub", lat: 51.5, lng: -0.1, fairPint: [500, "https://example.com", "2027-11-01"] },
  ], postalAddress: "Example sender", now: new Date("2027-11-05T09:00:00Z") };
  expect(await runPaydayPintJob(args)).toEqual({ status: "disabled", sent: 0, skipped: 0, retryable: 0, failed: 0 });
  expect(send).not.toHaveBeenCalled();
  expect(await runPaydayPintJob({ ...args, enabled: true })).toEqual({ status: "completed", sent: 1, skipped: 0, retryable: 0, failed: 0 });
  expect(await runPaydayPintJob({ ...args, enabled: true })).toEqual({ status: "completed", sent: 0, skipped: 1, retryable: 0, failed: 0 });
  expect(send).toHaveBeenCalledTimes(1);
  const message = send.mock.calls[0]![0][0]!;
  for (const body of [message.html, message.text]) {
    expect(body).toContain("£5.00");
    expect(body).not.toContain("Old menu pub");
  }
});

it("does not deliver after a recipient unsubscribes before dispatch", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe", confirmationHash: "new", createdAt: "2026-11-19T00:00:00.000Z" });
  await store.confirm("new", "2026-11-19T01:00:00.000Z");
  const claim = store.claim;
  store.claim = async (id, week, token, now) => { const result = await claim(id, week, token, now); await store.unsubscribe("unsubscribe", "2026-11-20T08:59:00.000Z"); return result; };
  const send = vi.fn(async () => []);
  const result = await runPaydayPintJob({ enabled: true, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [{ id: "a", name: "A pub", lat: 51.5, lng: -0.1, fairPint: [500, "https://example.com", "2026-11-19"] }], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") });
  expect(result).toEqual({ status: "completed", sent: 0, skipped: 1, retryable: 0, failed: 0 });
  expect(send).not.toHaveBeenCalled();
});

it("does not send a previous station after a new station is confirmed", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "first", confirmationHash: "first", createdAt: "2026-11-19T00:00:00.000Z" });
  await store.confirm("first", "2026-11-19T01:00:00.000Z");
  const claim = store.claim;
  store.claim = async (id, week, token, now) => {
    const result = await claim(id, week, token, now);
    await store.request({ email: "person@example.test", station: "Oxford Circus", consentText: "Weekly payday pint email", unsubscribeToken: "second", confirmationHash: "second", createdAt: "2026-11-20T08:00:00.000Z" });
    await store.confirm("second", "2026-11-20T08:01:00.000Z");
    return result;
  };
  const send = vi.fn(async () => []);
  await runPaydayPintJob({ enabled: true, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [{ id: "a", name: "A pub", lat: 51.5, lng: -0.1, fairPint: [500, "https://example.com", "2026-11-19"] }], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") });
  expect(send).not.toHaveBeenCalled();
});

it("sends an honest empty email when a station has no sourced pint prices", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe", confirmationHash: "new", createdAt: "2026-11-19T00:00:00.000Z" });
  await store.confirm("new", "2026-11-19T01:00:00.000Z");
  const send = vi.fn(async (messages: readonly { to: string; text: string }[]) => messages.map(({ to }) => ({ to, status: "sent" as const })));
  const result = await runPaydayPintJob({ enabled: true, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") });
  expect(result.sent).toBe(1);
  expect(send.mock.calls[0]![0][0]!.text).toContain("could not find a sourced pint price");
});

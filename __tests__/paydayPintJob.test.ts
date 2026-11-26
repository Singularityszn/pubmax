import { expect, it, vi } from "vitest";
import { createMemoryPaydayStore } from "@/lib/paydayPintStore";
import { runPaydayPintJob } from "@/lib/paydayPintJob.server";
import { createResendEmailProvider } from "@/lib/emailProvider";

it.each(["claim", "prepareDelivery", "isActive", "finish"] as const)("settles a temporary %s failure and continues with other subscribers", async (operation) => {
  const store = createMemoryPaydayStore();
  for (const name of ["first", "second"]) {
    await store.request({ email: `${name}@example.test`, station: "Bank", consentText: "weekly", unsubscribeToken: name, confirmationHash: name, createdAt: "2026-11-19T00:00:00Z" });
    await store.confirm(name, "2026-11-19T01:00:00Z");
  }
  vi.spyOn(store, operation).mockRejectedValueOnce(new Error("temporary store error"));
  const send = vi.fn(async (messages: readonly { to: string }[]) => messages.map(({ to }) => ({ to, status: "sent" as const })));
  const args = { enabled: true, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") };
  expect(await runPaydayPintJob(args)).toMatchObject(operation === "finish"
    ? { sent: 2, retryable: 0, failed: 0 }
    : { sent: 1, retryable: 1, failed: 0 });
  expect(send).toHaveBeenCalledTimes(operation === "finish" ? 2 : 1);
  expect(await runPaydayPintJob(args)).toMatchObject(operation === "finish"
    ? { sent: 0, skipped: 2, retryable: 0, failed: 0 }
    : { sent: 1, skipped: 1, retryable: 0, failed: 0 });
  expect(send).toHaveBeenCalledTimes(2);
});

it.each([
  { operation: "prepareDelivery", outcome: "error", sent: 1, skipped: 0, failed: 1 },
  { operation: "isActive", outcome: "error", sent: 1, skipped: 0, failed: 1 },
  { operation: "finish", outcome: "error", sent: 1, skipped: 0, failed: 1 },
  { operation: "finish", outcome: "sent", sent: 2, skipped: 0, failed: 0 },
  { operation: "finish", outcome: "invalid", sent: 1, skipped: 1, failed: 0 },
] as const)("settles final-attempt $operation failures after $outcome without losing the next subscriber", async ({ operation, outcome, sent, skipped, failed }) => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "first@example.test", station: "Bank", consentText: "weekly", unsubscribeToken: "first", confirmationHash: "first", createdAt: "2026-11-19T00:00:00Z" });
  await store.confirm("first", "2026-11-19T01:00:00Z");
  const send = vi.fn(async (messages: readonly { to: string }[]) => messages.map(({ to }) => ({ to, status: "error" as "error" | "sent" | "invalid" })));
  const args = { enabled: true, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") };
  expect(await runPaydayPintJob(args)).toMatchObject({ retryable: 1, failed: 0 });
  expect(await runPaydayPintJob(args)).toMatchObject({ retryable: 1, failed: 0 });
  await store.request({ email: "second@example.test", station: "Bank", consentText: "weekly", unsubscribeToken: "second", confirmationHash: "second", createdAt: "2026-11-19T00:00:00Z" });
  await store.confirm("second", "2026-11-19T01:00:00Z");
  send.mockImplementation(async (messages) => messages.map(({ to }) => ({ to, status: to === "first@example.test" ? outcome : "sent" })));
  vi.spyOn(store, operation).mockRejectedValueOnce(new Error("temporary store error"));

  expect(await runPaydayPintJob(args)).toEqual({ status: "completed", sent, skipped, retryable: 0, failed });
  const sends = send.mock.calls.length;
  expect(await runPaydayPintJob(args)).toMatchObject({ sent: 0, skipped: 2, retryable: 0, failed: 0 });
  expect(send).toHaveBeenCalledTimes(sends);
});

it("keeps unresolved storage failures separate from exhausted deliveries", async () => {
  const store = createMemoryPaydayStore();
  for (const name of ["first", "second"]) {
    await store.request({ email: `${name}@example.test`, station: "Bank", consentText: "weekly", unsubscribeToken: name, confirmationHash: name, createdAt: "2026-11-19T00:00:00Z" });
    await store.confirm(name, "2026-11-19T01:00:00Z");
  }
  const [first] = await store.active();
  const finish = store.finish;
  vi.spyOn(store, "finish").mockImplementation((id, week, claim, state) => {
    if (id === first!.id) return Promise.reject(new Error("store unavailable"));
    return finish(id, week, claim, state);
  });
  const send = vi.fn(async (messages: readonly { to: string }[]) => messages.map(({ to }) => ({ to, status: "sent" as const })));
  expect(await runPaydayPintJob({ enabled: true, store, provider: { send }, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [], postalAddress: "Example sender", now: new Date("2026-11-20T09:00:00Z") }))
    .toMatchObject({ sent: 1, retryable: 1, failed: 0 });
});

it("replays the exact provider request after station, price and sender changes", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "weekly", unsubscribeToken: "unsubscribe", confirmationHash: "first", createdAt: "2026-11-19T00:00:00Z" });
  await store.confirm("first", "2026-11-19T01:00:00Z");
  const requests: { body: string; key: string | null }[] = [];
  vi.stubEnv("EMAIL_FROM", "original@example.test");
  try {
    const provider = createResendEmailProvider({
      config: () => ({ apiKey: "test-key", from: process.env.EMAIL_FROM! }),
      fetch: async (_url, init) => {
        requests.push({ body: String(init.body), key: new Headers(init.headers).get("Idempotency-Key") });
        if (requests.length === 1) throw new Error("response lost after acceptance");
        return new Response(JSON.stringify({ id: "accepted" }), { status: 200 });
      },
    });
    const args = { enabled: true, store, provider, stations: [{ name: "Bank", lat: 51.5, lng: -0.1 }], venues: [{ id: "a", name: "A pub", lat: 51.5, lng: -0.1, fairPint: [500, "https://example.test/menu", "2026-11-19"] }], postalAddress: "Original address", now: new Date("2026-11-20T09:00:00Z") };
    expect((await runPaydayPintJob(args)).retryable).toBe(1);
    await store.request({ email: "person@example.test", station: "Oxford Circus", consentText: "weekly", unsubscribeToken: "new", confirmationHash: "second", createdAt: "2026-11-20T09:01:00Z" });
    await store.confirm("second", "2026-11-20T09:02:00Z");
    vi.stubEnv("EMAIL_FROM", "changed@example.test");
    expect((await runPaydayPintJob({ ...args, stations: [], venues: [], postalAddress: "Changed address", now: new Date("2026-11-20T09:03:00Z") })).sent).toBe(1);
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ from: "original@example.test", to: ["person@example.test"], text: expect.stringContaining("£5.00") });
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1]!.key).toMatch(/^payday-.*-2026-11-20$/);
  } finally { vi.unstubAllEnvs(); }
});

it("keeps a prepared request when a stale sending claim is reclaimed", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "weekly", unsubscribeToken: "unsubscribe", confirmationHash: "first", createdAt: "2026-11-19T00:00:00Z" });
  await store.confirm("first", "2026-11-19T01:00:00Z");
  const [subscriber] = await store.active();
  const original = { from: "sender@example.test", to: "person@example.test", subject: "Original", html: "<p>Original</p>", text: "Original", idempotencyKey: "payday-original" };
  expect(await store.claim(subscriber!.id, "2026-11-20", "first", "2026-11-20T09:00:00Z")).toBe(true);
  expect(await store.prepareDelivery(subscriber!.id, "2026-11-20", "first", original)).toEqual(original);
  expect(await store.claim(subscriber!.id, "2026-11-20", "second", "2026-11-20T09:05:00Z")).toBe(true);
  await expect(store.prepareDelivery(subscriber!.id, "2026-11-20", "first", { ...original, text: "Changed" })).rejects.toThrow("claim was lost");
  expect(await store.prepareDelivery(subscriber!.id, "2026-11-20", "second", { ...original, text: "Changed" })).toEqual(original);
  await store.finish(subscriber!.id, "2026-11-20", "second", "delivered");
  expect(await store.claim(subscriber!.id, "2026-11-27", "third", "2026-11-27T09:00:00Z")).toBe(true);
  expect(await store.prepareDelivery(subscriber!.id, "2026-11-27", "third", { ...original, idempotencyKey: "next-week", text: "Next week" })).toMatchObject({ idempotencyKey: "next-week", text: "Next week" });
});

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
  expect(await runPaydayPintJob(args)).toMatchObject({ retryable: 1, failed: 0 });
  expect(await runPaydayPintJob(args)).toMatchObject({ retryable: 1, failed: 0 });
  expect(await runPaydayPintJob(args)).toMatchObject({ retryable: 0, failed: 1 });
  await runPaydayPintJob(args);
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

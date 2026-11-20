import { describe, expect, it } from "vitest";
import { createMemoryPaydayStore } from "@/lib/paydayPintStore";
import { transitionPaydayConsent } from "@/lib/paydayPintConsent";
import { paydayConsentCases } from "./helpers/paydayConsentCases";

it.each(paydayConsentCases)("consent policy: $name", ({ state, event, expected, accepted }) => {
  const next = transitionPaydayConsent(state, event);
  expect(next).toEqual(expected);
  if (!accepted) expect(next).toBe(state);
});

describe("payday pint consent", () => {
  it("orders consent by the instant rather than the timestamp spelling", async () => {
    const store = createMemoryPaydayStore();
    const base = { email: "person@example.test", station: "Bank", consentText: "weekly", unsubscribeToken: "original-link" };
    await store.request({ ...base, confirmationHash: "first", createdAt: "2026-11-01T00:30:00.000Z" });
    expect(await store.confirm("first", "2026-11-01T01:00:00.000Z")).toBe(true);
    await store.request({ ...base, station: "Oxford Circus", unsubscribeToken: "new-link", confirmationHash: "older", createdAt: "2026-11-01T02:00:00+02:00" });
    expect(await store.confirm("older", "2026-11-01T03:00:00.000Z")).toBe(false);
    expect((await store.active())[0]?.station).toBe("Bank");
  });

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

  it("keeps the latest repeated withdrawal effective until a later signup", async () => {
    const store = createMemoryPaydayStore();
    const base = { email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "original-link" };
    await store.request({ ...base, confirmationHash: "first", createdAt: "2026-11-01T00:00:00.000Z" });
    expect(await store.confirm("first", "2026-11-01T01:00:00.000Z")).toBe(true);
    const [subscriber] = await store.active();
    await store.unsubscribe("original-link", "2026-11-01T02:00:00.000Z");
    await store.request({ ...base, confirmationHash: "pending", createdAt: "2026-11-01T03:00:00.000Z" });
    await store.unsubscribe("original-link", "2026-11-01T04:00:00.000Z");
    await store.unsubscribe("original-link", "2026-11-01T02:00:00.000Z");
    expect(await store.confirm("pending", "2026-11-01T05:00:00.000Z")).toBe(false);
    expect(await store.active()).toEqual([]);
    expect(await store.claim(subscriber!.id, "2026-11-06")).toBe(false);
    expect(await store.isActive(subscriber!.id, "original-link", subscriber!.consentAt)).toBe(false);
    await store.request({ ...base, confirmationHash: "renewed", createdAt: "2026-11-01T06:00:00.000Z" });
    expect(await store.confirm("renewed", "2026-11-01T07:00:00.000Z")).toBe(true);
    expect(await store.active()).toHaveLength(1);
  });
});

it("does not claim a week twice or claim an unsubscribed recipient", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "unsubscribe", confirmationHash: "new", createdAt: "2026-11-01T00:00:00.000Z" });
  await store.confirm("new", "2026-11-01T01:00:00.000Z");
  const [subscriber] = await store.active();
  expect(await store.claim(subscriber!.id, "2026-11-06")).toBe(true);
  expect(await store.claim(subscriber!.id, "2026-11-06")).toBe(false);
  await store.unsubscribe("unsubscribe", "2026-11-07T00:00:00.000Z");
  expect(await store.claim(subscriber!.id, "2026-11-13")).toBe(false);
  expect(await store.isActive(subscriber!.id, "unsubscribe", subscriber!.consentAt)).toBe(false);
});

it("keeps older unsubscribe links valid after a confirmed station change", async () => {
  const store = createMemoryPaydayStore();
  await store.request({ email: "person@example.test", station: "Bank", consentText: "Weekly payday pint email", unsubscribeToken: "original-link", confirmationHash: "first", createdAt: "2026-11-01T00:00:00.000Z" });
  await store.confirm("first", "2026-11-01T01:00:00.000Z");
  await store.request({ email: "person@example.test", station: "Oxford Circus", consentText: "Weekly payday pint email", unsubscribeToken: "new-link", confirmationHash: "second", createdAt: "2026-11-02T00:00:00.000Z" });
  expect(await store.confirm("second", "2026-11-02T01:00:00.000Z")).toBe(true);
  await store.unsubscribe("original-link", "2026-11-02T02:00:00.000Z");
  expect(await store.active()).toEqual([]);
});

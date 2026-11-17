import { expect } from "vitest";

export const PRESENCE_OWNER = "a0000000-0000-4000-8000-000000000001";
export const PRESENCE_SESSION = "d0000000-0000-4000-8000-000000000001";
const PRESENCE_THREAD = "b0000000-0000-4000-8000-000000000001";

type Scope = "owner" | "other-user" | "other-session" | "other-device" | "wrong-secret";
export type PresenceVectorStore = {
  start(scope?: Scope): Promise<number | null>;
  write(conversation: string | null, activity: number, revision: number, scope?: Scope): Promise<void>;
  suppressed(): Promise<boolean>;
};

// Oracle: a visible current lifetime suppresses alerts. A clear allows them.
// An older lifetime, older revision, or different binding must change neither result.
export async function exercisePresenceOrdering(store: PresenceVectorStore): Promise<void> {
  const first = (await store.start())!;
  expect(first).toBeGreaterThan(0);
  await store.write(PRESENCE_THREAD, first, 1);
  expect(await store.suppressed()).toBe(true);
  const current = (await store.start())!;
  expect(current).toBeGreaterThan(first);
  expect(await store.suppressed()).toBe(true);
  await store.write(PRESENCE_THREAD, current, 1);
  for (const [conversation, activity, revision, expected] of [
    [null, first, 9, true],
    [null, current, 3, false],
    [PRESENCE_THREAD, current, 2, false],
    [PRESENCE_THREAD, first, 99, false],
    [PRESENCE_THREAD, current, 4, true],
    [null, current, 3, true],
    [null, current + 1000, 1, true],
  ] as const) {
    await store.write(conversation, activity, revision);
    expect(await store.suppressed()).toBe(expected);
  }
  for (const scope of ["other-user", "other-session", "other-device", "wrong-secret"] as const) {
    expect(await store.start(scope)).toBeNull();
    await store.write(null, current, 100, scope);
    expect(await store.suppressed()).toBe(true);
  }
  const [left, right] = await Promise.all([store.start(), store.start()]);
  expect(new Set([left, right]).size).toBe(2);
  expect(left).toBeGreaterThan(current);
  expect(right).toBeGreaterThan(current);
  const newer = Math.max(left!, right!);
  const older = Math.min(left!, right!);
  await store.write(PRESENCE_THREAD, newer, 1);
  await store.write(null, older, 9);
  expect(await store.suppressed()).toBe(true);
  // An unused reservation, even one completed late, must not erase current presence.
  await store.start();
  await store.write(PRESENCE_THREAD, newer, 2);
  expect(await store.suppressed()).toBe(true);
}

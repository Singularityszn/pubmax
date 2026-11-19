// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

class NavigationTiming implements PerformanceEntry {
  name = "https://pubmaxxing.com/map";
  entryType = "navigation";
  startTime = 0;
  duration = 0;
  type = "reload";
  toJSON() { return {}; }
}

const navigation = new NavigationTiming();
const reload = vi.fn();
let voice: typeof import("@/lib/palVoiceHost");

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  reload.mockClear();
  navigation.type = "reload";
  vi.stubGlobal("location", { href: navigation.name, reload });
  vi.stubGlobal("PerformanceNavigationTiming", NavigationTiming);
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([navigation]);
  voice = await import("@/lib/palVoiceHost");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function retryAndReload() {
  voice.requestPalVoiceStart("account-a", { palName: "Robin" });
  voice.palVoiceLoadFailed();
  voice.requestPalVoiceStart("account-a", { palName: "Robin" });
  expect(reload).toHaveBeenCalledOnce();
  voice.cancelPalVoiceStart("/map", "account-a", true);
  vi.resetModules();
  voice = await import("@/lib/palVoiceHost");
}

it("resumes one explicit voice retry after its account reloads the same page", async () => {
  await retryAndReload();
  voice.cancelPalVoiceStart("/map", undefined);
  voice.cancelPalVoiceStart("/map", "account-a");
  voice.resumePalVoiceStart("account-a", { palName: "Robin" });
  expect(voice.readPalVoiceHost()).toMatchObject({ startPending: true, startOwner: "account-a" });
  voice.setPalVoiceEngaged(true);
  voice.resumePalVoiceStart("account-a", { palName: "Robin" });
  expect(voice.readPalVoiceHost().startPending).toBe(false);
});

it("does not resume a revoked retry", async () => {
  await retryAndReload();
  voice.revokePalVoiceCall();
  voice.resumePalVoiceStart("account-a", { palName: "Robin" });
  expect(voice.readPalVoiceHost().startPending).toBe(false);
});

it.each([
  ["leaving the map", "/plan", "account-a", false],
  ["opening Pal", "/pal", "account-a", false],
  ["changing maps", "/map/manchester", "account-a", false],
  ["switching accounts", "/map", "account-b", false],
  ["signing out", "/map", null, false],
  ["hiding the page", "/map", "account-a", true],
] as const)("cancels a reloaded retry after %s and returning before eligibility resolves", async (_change, pathname, ownerId, hidden) => {
  await retryAndReload();
  voice.cancelPalVoiceStart("/map", "account-a");
  voice.cancelPalVoiceStart(pathname, ownerId, hidden);
  voice.cancelPalVoiceStart("/map", "account-a");
  voice.resumePalVoiceStart("account-a", { palName: "Robin" });
  expect(voice.readPalVoiceHost().startPending).toBe(false);
});

it.each(["another account", "another page", "later visit", "navigation", "hidden page"])(
  "does not reopen the microphone for %s",
  async (change) => {
    const now = Date.now();
    await retryAndReload();
    if (change === "another page") location.href = "https://pubmaxxing.com/map?city=bristol";
    if (change === "later visit") vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    if (change === "navigation") navigation.type = "navigate";
    if (change === "hidden page") vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    voice.resumePalVoiceStart(change === "another account" ? "account-b" : "account-a", {});
    expect(voice.readPalVoiceHost().startPending).toBe(false);
    expect(sessionStorage.length).toBe(0);
  },
);

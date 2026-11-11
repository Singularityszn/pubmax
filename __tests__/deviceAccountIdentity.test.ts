import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bindDeviceAccountOwner,
  clearDeviceAccountArtifacts,
  clearDeviceAccountSessionArtifacts,
  deviceAccountOwner,
  DEVICE_ACCOUNT_OWNER_KEY,
  DEVICE_IDENTITY_CHANGED_EVENT,
  DEVICE_IDENTITY_LOCAL_KEYS,
  DEVICE_IDENTITY_SESSION_KEYS,
  liveAccountDeparted,
  releaseDeviceAccountOwner,
  readDeviceAccountSessionRevision,
  subscribeDeviceAccountSession,
  subscribeDeviceIdentity,
} from "@/lib/deviceAccountIdentity";
import { LOCAL_PAL_KEY } from "@/lib/localPal";
import { OPTIMISTIC_SPILL_STORAGE_KEY } from "@/lib/optimisticSpillPost";
import { NIGHT_PROFILE_DEVICE_KEY } from "@/lib/nightProfileDeviceProvenance";
import { readLegRouteOnMap, showLegRouteOnMap } from "@/lib/legRouteOnMap";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function sweepableStorage(initial: Record<string, string> = {}) {
  const storage = fakeStorage(initial);
  return {
    ...storage,
    get length() {
      return storage.values.size;
    },
    key: (index: number) => [...storage.values.keys()][index] ?? null,
  };
}

/** What account A leaves behind on a device it was signed into. */
function deviceAfterAccountA() {
  const local = fakeStorage({
    pubmax_handle: "karan",
    "pubmax:comment:handle": "karan",
    pubmax_round_anonymous_identity_v1: JSON.stringify({
      owner: "anonymous",
      handle: "karan",
    }),
    "pubmax:identityNudge:pending:v1": "plan",
    "pubmax:identityNudge:pendingAt:v1": "1",
    "pubmax:identityNudge:dismissedAt:v1": "1",
    "pubmax-badge-event-opt-ins": "some-event",
    [DEVICE_ACCOUNT_OWNER_KEY]: "user-a",
  });
  const session = fakeStorage({
    "pubmax:referral-follow-handle": "karan",
    "pubmax:arrival-welcome:v1": '{"intent":"signin","at":1}',
  });
  return { local, session };
}

describe("device account identity", () => {
  let device: ReturnType<typeof deviceAfterAccountA>;

  beforeEach(() => {
    device = deviceAfterAccountA();
  });

  it("names every artifact it is responsible for", () => {
    // A key added to either list without a home here would be cleared without
    // anyone knowing why, and a key MISSING from them is the whole defect.
    expect(DEVICE_IDENTITY_LOCAL_KEYS).toContain("pubmax_handle");
    expect(new Set(DEVICE_IDENTITY_LOCAL_KEYS).size).toBe(
      DEVICE_IDENTITY_LOCAL_KEYS.length,
    );
    expect(new Set(DEVICE_IDENTITY_SESSION_KEYS).size).toBe(
      DEVICE_IDENTITY_SESSION_KEYS.length,
    );
    expect(DEVICE_IDENTITY_LOCAL_KEYS).not.toContain(DEVICE_ACCOUNT_OWNER_KEY);
  });

  it.each(["owner-change", "unstamped", "tab-departure", "sign-out"])(
    "clears all private drafts and dismissals on %s",
    (transition) => {
      const drafts = {
        "pubmax_pint_drop_draft:venue-1": '{"version":2}',
        "pubmax_pint_drop_draft:venue-2": '{"version":2}',
        "pubmaxx:price-mission-dismiss:v1": '["venue-1"]',
        "pubmax:ask-plan-draft:v1": '{"query":"soho"}',
      };
      const session = sweepableStorage({ ...drafts, "pubmax:unrelated": "keep" });
      const local = fakeStorage(transition === "unstamped" ? {} : { [DEVICE_ACCOUNT_OWNER_KEY]: "user-a" });
      bindDeviceAccountOwner(transition === "unstamped" ? "user-b" : "user-a", local, session);
      if (transition !== "unstamped") {
        for (const [key, value] of Object.entries(drafts)) expect(session.getItem(key)).toBe(value);
        if (transition === "sign-out") releaseDeviceAccountOwner(local, session);
        else if (transition === "tab-departure") clearDeviceAccountSessionArtifacts(session);
        else bindDeviceAccountOwner("user-b", local, session);
      }
      for (const key of Object.keys(drafts)) expect(session.getItem(key)).toBeNull();
      expect(session.getItem("pubmax:unrelated")).toBe("keep");
    },
  );

  it("invalidates mounted session readers only after the private artifacts are cleared", () => {
    const session = sweepableStorage({
      "pubmax_pint_drop_draft:venue-1": "private note",
      "pubmaxx:price-mission-dismiss:v1": "private skip",
      "pubmax:ask-plan-draft:v1": "private plan",
    });
    const revision = readDeviceAccountSessionRevision();
    const notice = vi.fn(() => {
      expect(session.values.size).toBe(0);
      expect(readDeviceAccountSessionRevision()).toBeGreaterThan(revision);
    });
    const unsubscribe = subscribeDeviceAccountSession(notice);
    try {
      bindDeviceAccountOwner("user-a", device.local, session);
      expect(notice).not.toHaveBeenCalled();
      releaseDeviceAccountOwner(device.local, session);
      expect(notice).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("clears the previous account's whole set when a second account signs in", () => {
    expect(bindDeviceAccountOwner("user-b", device.local, device.session)).toBe(
      true,
    );
    for (const key of DEVICE_IDENTITY_LOCAL_KEYS) {
      expect(device.local.getItem(key)).toBeNull();
    }
    for (const key of DEVICE_IDENTITY_SESSION_KEYS) {
      expect(device.session.getItem(key)).toBeNull();
    }
    expect(deviceAccountOwner(device.local)).toBe("user-b");
  });

  it("clears private Round turn orders on an account switch, but preserves an ordinary same-account return", () => {
    const key = "pubmax:wild-round-rota:v1";
    device.session.setItem(key, JSON.stringify({ ownerId: "user-a", names: ["Sam"] }));
    bindDeviceAccountOwner("user-a", device.local, device.session);
    expect(device.session.getItem(key)).not.toBeNull();
    bindDeviceAccountOwner("user-b", device.local, device.session);
    expect(device.session.getItem(key)).toBeNull();
  });

  it("leaves the set alone when the same account signs in again", () => {
    expect(bindDeviceAccountOwner("user-a", device.local, device.session)).toBe(
      false,
    );
    expect(device.local.getItem("pubmax_handle")).toBe("karan");
  });

  it.each(["switch", "sign-out"])("retires personal Plan drafts after %s", (transition) => {
    const localKeys = ["pubmaxx:plan-route-draft:v1", "pubmax:plan-route-draft:v2", "pubmax:plan-intake:v1"];
    const sessionKeys = ["pubmaxx:plan-draft:v1", "pubmax:plan-draft:v2"];
    const personalDraft = JSON.stringify({ conciergeQuery: "A's private outing", accessibilityNeeds: ["step-free"] });
    for (const key of localKeys) device.local.setItem(key, personalDraft);
    for (const key of sessionKeys) device.session.setItem(key, personalDraft);
    bindDeviceAccountOwner("user-a", device.local, device.session);
    for (const key of localKeys) expect(device.local.getItem(key)).toBe(personalDraft);
    for (const key of sessionKeys) expect(device.session.getItem(key)).toBe(personalDraft);
    if (transition === "switch") bindDeviceAccountOwner("user-b", device.local, device.session);
    else releaseDeviceAccountOwner(device.local, device.session);
    for (const key of localKeys) expect(device.local.getItem(key)).toBeNull();
    for (const key of sessionKeys) expect(device.session.getItem(key)).toBeNull();
  });

  it("preserves a chosen way for the same owner and retires it for the next owner", () => {
    showLegRouteOnMap({ legKey: "venue-a>venue-b", option: {
      id: "walk", kind: "walk", minutes: 6, farePence: 0, parts: [],
      estimate: false, fastest: true, cheapest: true,
    } });
    bindDeviceAccountOwner("user-a", device.local, device.session);
    expect(readLegRouteOnMap()?.legKey).toBe("venue-a>venue-b");
    bindDeviceAccountOwner("user-b", device.local, device.session);
    expect(readLegRouteOnMap()).toBeNull();
  });

  it("treats an unstamped device as somebody else's", () => {
    // The live browser on the day this ships: a cached handle nobody vouched
    // for. It may not act as this account; the canonical read re-establishes it.
    const local = fakeStorage({ pubmax_handle: "karan" });
    expect(bindDeviceAccountOwner("user-b", local)).toBe(true);
    expect(local.getItem("pubmax_handle")).toBeNull();
    expect(deviceAccountOwner(local)).toBe("user-b");
  });

  it("takes a MIRRORED Night Profile with the account, and leaves a typed one", () => {
    const mirrored = fakeStorage({
      [NIGHT_PROFILE_DEVICE_KEY]: JSON.stringify({
        version: 1,
        profile: {},
        source: "account",
      }),
    });
    clearDeviceAccountArtifacts(mirrored);
    expect(mirrored.getItem(NIGHT_PROFILE_DEVICE_KEY)).toBeNull();

    const typedHere = fakeStorage({
      [NIGHT_PROFILE_DEVICE_KEY]: JSON.stringify({
        version: 1,
        profile: {},
        source: "device",
      }),
    });
    clearDeviceAccountArtifacts(typedHere);
    expect(typedHere.getItem(NIGHT_PROFILE_DEVICE_KEY)).not.toBeNull();

    // "Saved on this device" predates the stamp: it stays device-scoped.
    const legacy = fakeStorage({
      [NIGHT_PROFILE_DEVICE_KEY]: JSON.stringify({ version: 1, profile: {} }),
    });
    clearDeviceAccountArtifacts(legacy);
    expect(legacy.getItem(NIGHT_PROFILE_DEVICE_KEY)).not.toBeNull();
  });

  it("takes the unconfirmed Pint Drops with the account, on a switch and on sign-out", () => {
    // A failed or still-confirming drop of account A must not show in account
    // B's feed, and Feed's Retry must not post it under B's name.
    expect(DEVICE_IDENTITY_LOCAL_KEYS).toContain(OPTIMISTIC_SPILL_STORAGE_KEY);
    const spills = JSON.stringify([{ clientRequestId: "a-1", drop: { id: "optimistic-a-1" } }]);
    const switched = fakeStorage({ [DEVICE_ACCOUNT_OWNER_KEY]: "user-a", [OPTIMISTIC_SPILL_STORAGE_KEY]: spills });
    expect(bindDeviceAccountOwner("user-b", switched)).toBe(true);
    expect(switched.getItem(OPTIMISTIC_SPILL_STORAGE_KEY)).toBeNull();

    const signedOut = fakeStorage({ [DEVICE_ACCOUNT_OWNER_KEY]: "user-a", [OPTIMISTIC_SPILL_STORAGE_KEY]: spills });
    releaseDeviceAccountOwner(signedOut);
    expect(signedOut.getItem(OPTIMISTIC_SPILL_STORAGE_KEY)).toBeNull();
  });

  it("takes the stored Pub Pal with the account, on a switch and on sign-out", () => {
    // The dock, the map and the recap postcard wear this Pal's name and face,
    // so a second account on the same browser must never inherit it.
    expect(DEVICE_IDENTITY_LOCAL_KEYS).toContain(LOCAL_PAL_KEY);
    const pal = JSON.stringify({ id: "pal-a", ownerId: "user-a", name: "Ripley" });
    const switched = fakeStorage({ [DEVICE_ACCOUNT_OWNER_KEY]: "user-a", [LOCAL_PAL_KEY]: pal });
    expect(bindDeviceAccountOwner("user-b", switched)).toBe(true);
    expect(switched.getItem(LOCAL_PAL_KEY)).toBeNull();

    const signedOut = fakeStorage({ [DEVICE_ACCOUNT_OWNER_KEY]: "user-a", [LOCAL_PAL_KEY]: pal });
    releaseDeviceAccountOwner(signedOut);
    expect(signedOut.getItem(LOCAL_PAL_KEY)).toBeNull();
  });

  it("sign-out drops the set AND the claim that anyone owns it", () => {
    releaseDeviceAccountOwner(device.local, device.session);
    expect(device.local.getItem("pubmax_handle")).toBeNull();
    expect(deviceAccountOwner(device.local)).toBeNull();
    // A sign-out followed by a fresh sign-in must not re-clear on a clean slate
    // and must stamp the arriving account.
    expect(bindDeviceAccountOwner("user-b", device.local, device.session)).toBe(
      true,
    );
    expect(deviceAccountOwner(device.local)).toBe("user-b");
  });

  it("survives blocked storage without throwing", () => {
    const blocked = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => bindDeviceAccountOwner("user-b", blocked)).not.toThrow();
    expect(() => releaseDeviceAccountOwner(blocked)).not.toThrow();
    expect(deviceAccountOwner(blocked)).toBeNull();
    expect(bindDeviceAccountOwner("", fakeStorage())).toBe(false);
  });
});

describe("subscribeDeviceIdentity", () => {
  function storageEvent(key: string | null): Event {
    return Object.assign(new Event("storage"), { key });
  }

  let target: EventTarget;
  beforeEach(() => {
    target = new EventTarget();
    vi.stubGlobal("window", target);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores another tab's writes outside the identity set", () => {
    // A second /social tab writes the auth token, the auth lock and the device
    // session list. None of them is an identity change, and re-reading on them
    // closed the first tab's open composer.
    const onChange = vi.fn();
    const unsubscribe = subscribeDeviceIdentity(onChange);
    for (const key of [
      "sb-pubmaxx-e2e-auth-token",
      "lswt-0.1",
      "pubmax_device_sessions_v1",
      "pubmax-tour-v1-done",
    ]) {
      target.dispatchEvent(storageEvent(key));
    }
    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("re-reads on another tab's identity write, owner stamp or clear", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeDeviceIdentity(onChange);
    target.dispatchEvent(storageEvent("pubmax_handle"));
    target.dispatchEvent(storageEvent(DEVICE_ACCOUNT_OWNER_KEY));
    target.dispatchEvent(storageEvent(null));
    target.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
    expect(onChange).toHaveBeenCalledTimes(4);
    unsubscribe();
    target.dispatchEvent(storageEvent("pubmax_handle"));
    target.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});

describe("liveAccountDeparted", () => {
  it("is true when a signed-in account leaves for another account or for nobody", () => {
    expect(liveAccountDeparted("account-a", "account-b")).toBe(true);
    expect(liveAccountDeparted("account-a", null)).toBe(true);
  });

  it("is false for the same account and for a sign-in from signed out", () => {
    expect(liveAccountDeparted("account-a", "account-a")).toBe(false);
    expect(liveAccountDeparted(null, "account-a")).toBe(false);
    expect(liveAccountDeparted(null, null)).toBe(false);
  });
});

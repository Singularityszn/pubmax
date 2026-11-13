import { describe, expect, it } from "vitest";

import {
  ADD_LINK_AUTO_PARAM,
  addLinkAwareDestination,
  ADD_LINK_COPY,
  ADD_LINK_RECEIPT_BODY,
  ADD_LINK_SURFACE,
  addLinkCreateCta,
  addLinkDoors,
  addLinkLanded,
  addLinkNextSteps,
  addLinkReceiptTitle,
  addLinkReturnTo,
  ADD_LINK_DOOR_TTL_MS,
  consumeAddLinkDoorTaken,
  markAddLinkDoorTaken,
  parseAddLinkAuto,
  shouldAutoAdd,
  type AddLinkAddOutcome,
  type AddLinkDoorOutcome,
} from "@/lib/addLink";
import { ANALYTICS_EVENTS, sanitizeEvent } from "@/lib/analyticsEvents";
import { HANDLE_CLAIM_NEXT } from "@/lib/authRedirect";
import { accountClaimReturnToFromUrl } from "@/lib/accountClaimReturnTo";
import { inviteReturnToFromUrl } from "@/lib/inviteReturnTo";

/** The login page's own call, so this walks the shipped thread. */
function loginDestination(intent: "signin" | "signup", from: string | null): string {
  return addLinkAwareDestination(intent, from, HANDLE_CLAIM_NEXT);
}

function fromParam(href: string): string | null {
  return new URL(href, "https://pubmaxxing.com").searchParams.get("from");
}

describe("add-link doors", () => {
  it("sends both doors back to the add page with the add already chosen", () => {
    const doors = addLinkDoors("karan");
    expect(doors).not.toBeNull();
    expect(doors?.createHref).toBe("/login?mode=signup&from=%2Fadd%2Fkaran%3Fauto%3D1");
    expect(doors?.signInHref).toBe("/login?mode=signin&from=%2Fadd%2Fkaran%3Fauto%3D1");
  });

  it("normalises the handle it was given", () => {
    expect(addLinkReturnTo("@Karan")).toBe("/add/karan?auto=1");
    expect(addLinkReturnTo("  ")).toBeNull();
    expect(addLinkDoors("!!")).toBeNull();
  });

  it("reads only an explicit auto=1", () => {
    expect(ADD_LINK_AUTO_PARAM).toBe("auto");
    expect(parseAddLinkAuto("1")).toBe(true);
    expect(parseAddLinkAuto("0")).toBe(false);
    expect(parseAddLinkAuto(null)).toBe(false);
    expect(parseAddLinkAuto("true")).toBe(false);
  });
});

describe("the add link survives account creation", () => {
  it("returns a sign-in straight to the add page", () => {
    const from = fromParam(addLinkDoors("karan")!.signInHref);
    expect(loginDestination("signin", from)).toBe("/add/karan?auto=1");
  });

  it("routes a sign-up through the claim surface and back out again", () => {
    const from = fromParam(addLinkDoors("karan")!.createHref);
    // A new account has no handle, so the claim surface owns the next step -
    // and it hands the person back to the add link when it is done.
    const destination = loginDestination("signup", from);
    expect(destination).toBe("/u/you?returnTo=%2Fadd%2Fkaran%3Fauto%3D1");
    expect(
      inviteReturnToFromUrl(`https://pubmaxxing.com${destination}`),
    ).toBe("/add/karan?auto=1");
  });

  it("routes a sign-up from the Pint Drop composer back to the pub and price", () => {
    // The composer's "Sign in to post" opens the sign-in door, and a stranger
    // reads "New here" as theirs. Both doors must end on the same composer.
    const door = "/map?sel=venue-12ino21&log=1&price=5.20";
    expect(loginDestination("signin", door)).toBe(door);
    const destination = loginDestination("signup", door);
    expect(destination).toBe(`/u/you?returnTo=${encodeURIComponent(door)}`);
    expect(accountClaimReturnToFromUrl(`https://pubmaxxing.com${destination}`)).toBe(door);
  });

  it("routes a sign-up from a tapped one-pub night back to that night", () => {
    const door = "/social/crews/50000000-0000-4000-8000-000000000001?there=1";
    expect(loginDestination("signin", door)).toBe(door);
    const destination = loginDestination("signup", door);
    expect(destination).toBe(`/u/you?returnTo=${encodeURIComponent(door)}`);
    expect(accountClaimReturnToFromUrl(`https://pubmaxxing.com${destination}`)).toBe(door);
  });

  it("leaves an ordinary login untouched", () => {
    expect(loginDestination("signup", "/map")).toBe("/u/you");
    expect(loginDestination("signin", "/map")).toBe("/map");
    expect(loginDestination("signin", null)).toBe("/u/you");
  });
});

describe("the add on arrival happens once", () => {
  const base = {
    auto: true,
    accountId: "account-a",
    identityResolved: true,
    viewerHandle: "newdrinker",
    target: "karan",
    attemptedAccountIds: new Set<string>(),
  };

  it("adds when the viewer has landed back with an account", () => {
    expect(shouldAutoAdd({ ...base, doorTaken: true })).toBe(true);
  });

  it("refuses a crafted auto=1 that never took a door in this tab", () => {
    expect(shouldAutoAdd({ ...base, doorTaken: false })).toBe(false);
    expect(shouldAutoAdd(base)).toBe(false);
  });

  it("never runs twice", () => {
    expect(
      shouldAutoAdd({
        ...base,
        attemptedAccountIds: new Set(["account-a"]),
      }),
    ).toBe(false);
  });

  it("keeps the attempt guard scoped to its account", () => {
    const attemptedAccountIds = new Set(["account-a"]);
    expect(shouldAutoAdd({ ...base, doorTaken: true, attemptedAccountIds })).toBe(false);
    expect(
      shouldAutoAdd({
        ...base,
        doorTaken: true,
        accountId: "account-b",
        attemptedAccountIds,
      }),
    ).toBe(true);
  });

  it("waits for the live session rather than a device cache", () => {
    expect(shouldAutoAdd({ ...base, identityResolved: false })).toBe(false);
    expect(shouldAutoAdd({ ...base, viewerHandle: null })).toBe(false);
  });

  it("refuses a signed-out viewer carrying a cached handle", () => {
    expect(shouldAutoAdd({ ...base, accountId: null })).toBe(false);
  });

  it("refuses without the flag, and refuses your own link", () => {
    expect(shouldAutoAdd({ ...base, auto: false })).toBe(false);
    expect(shouldAutoAdd({ ...base, viewerHandle: "karan" })).toBe(false);
    expect(shouldAutoAdd({ ...base, viewerHandle: "@Karan" })).toBe(false);
  });
});

describe("what the add surface says and reports", () => {
  it("names the friend in the one primary action and in the receipt", () => {
    expect(addLinkCreateCta("karan", "Karan M")).toBe("Create account and add Karan M");
    expect(addLinkReceiptTitle("karan", "Karan M")).toBe("Karan M is in your lot.");
    expect(addLinkCreateCta("karan", "  ")).toBe("Create account and add @karan");
    expect(addLinkReceiptTitle("karan")).toBe("@karan is in your lot.");
  });

  it("offers a way onward from the receipt, including the friend", () => {
    const steps = addLinkNextSteps("karan");
    expect(steps.map((step) => step.href)).toEqual(["/map", "/near", "/u/karan"]);
    expect(steps.every((step) => step.label.trim().length > 0)).toBe(true);
  });

  // THE PROMISE THE ADD LINK MAKES HAS TO BE ONE THE PRODUCT KEEPS. The copy
  // used to say adding somebody put "their nights, drops and check-ins" into
  // Your lot. That list is not reachable: the lot feed tab lived on /feed, which
  // `next.config.mjs` answers with a permanent redirect to /social, and /social
  // carries a posts tab and a discover tab and no activity lane. The roadmap's
  // activity-history layer is what would make the old sentence true, and it is
  // sequenced after this wave.
  it("promises no feed of a friend's nights, on the offer or on the receipt", () => {
    const lines = [...Object.values(ADD_LINK_COPY), ADD_LINK_RECEIPT_BODY];
    for (const line of lines) {
      expect(line).not.toMatch(/land in Your lot/i);
      expect(line).not.toMatch(/show up in Your lot/i);
      expect(line).not.toMatch(/nights, drops and check-ins/i);
    }
  });

  it("says out loud that there is no such feed, and what a lot does open", () => {
    expect(ADD_LINK_COPY.lotMeans).toMatch(/no feed of everybody's nights/i);
    expect(ADD_LINK_COPY.lotMeans).toMatch(/private/i);
    expect(ADD_LINK_COPY.signedIn).toMatch(/mutual/i);
    expect(ADD_LINK_RECEIPT_BODY).toMatch(/each other's lot/i);
  });

  it("lands the add as mates only when they had already added the viewer", () => {
    // A tap on somebody who added the viewer first completes the pair.
    expect(addLinkLanded(true, "follows_you")).toBe("mates");
    expect(addLinkLanded(true, "mates")).toBe("mates");
    expect(addLinkLanded(true, "none")).toBe("following");
    expect(addLinkLanded(true, null)).toBe("following");
    // No tap: the two may already stand that way when the link opens.
    expect(addLinkLanded(false, "mates")).toBe("mates");
    expect(addLinkLanded(false, "following")).toBe("following");
    expect(addLinkLanded(false, "follows_you")).toBeNull();
    expect(addLinkLanded(false, "none")).toBeNull();
    expect(addLinkLanded(false, null)).toBeNull();
  });

  it("keeps the house voice: no em dash, no exclamation", () => {
    const lines = [
      ...Object.values(ADD_LINK_COPY),
      ADD_LINK_RECEIPT_BODY,
      addLinkCreateCta("karan", "Karan M"),
      addLinkReceiptTitle("karan", "Karan M"),
      ...addLinkNextSteps("karan").map((step) => step.label),
    ];
    for (const line of lines) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("!");
    }
  });

  it("registers three events that carry no handle", () => {
    expect(ANALYTICS_EVENTS.add_link_viewed).toEqual(["surface"]);
    expect(ANALYTICS_EVENTS.add_link_signup_started).toEqual(["surface", "outcome"]);
    expect(ANALYTICS_EVENTS.add_link_added).toEqual(["surface", "outcome"]);
    expect(ADD_LINK_SURFACE).toBe("add-link");
  });

  it("carries every outcome the surface reports through the rail", () => {
    // A dropped `outcome` reads in the funnel as an event that lost its prop,
    // so the refusal has to survive `sanitizeEvent` beside the other two.
    const outcomes: AddLinkAddOutcome[] = ["added", "failed", "unavailable"];
    for (const outcome of outcomes) {
      expect(
        sanitizeEvent("add_link_added", { surface: ADD_LINK_SURFACE, outcome }),
      ).toEqual({ name: "add_link_added", props: { surface: ADD_LINK_SURFACE, outcome } });
    }

    const doors: AddLinkDoorOutcome[] = ["create", "signin"];
    for (const outcome of doors) {
      expect(
        sanitizeEvent("add_link_signup_started", { surface: ADD_LINK_SURFACE, outcome }),
      ).toEqual({
        name: "add_link_signup_started",
        props: { surface: ADD_LINK_SURFACE, outcome },
      });
    }
  });

  it("still drops a handle, whatever the outcome says", () => {
    expect(
      sanitizeEvent("add_link_added", {
        surface: ADD_LINK_SURFACE,
        outcome: "added",
        handle: "karan",
      }),
    ).toEqual({
      name: "add_link_added",
      props: { surface: ADD_LINK_SURFACE, outcome: "added" },
    });
  });
});

describe("the add-link door marker", () => {
  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  }

  it("is one-shot: a door writes it, the add consumes it, a stranger cannot reuse it", () => {
    const storage = memoryStorage();
    const now = 1_000;
    expect(consumeAddLinkDoorTaken(storage, now, "karan")).toBe(false);
    markAddLinkDoorTaken(storage, now, "karan");
    expect(consumeAddLinkDoorTaken(storage, now + 1_000, "karan")).toBe(true);
    expect(consumeAddLinkDoorTaken(storage, now + 2_000, "karan")).toBe(false);
  });

  it("counts only for the handle the door was taken for", () => {
    const storage = memoryStorage();
    const now = 1_000;
    markAddLinkDoorTaken(storage, now, "karan");

    // A crafted /add/<anyone>?auto=1 on the same device took no door of its own.
    expect(consumeAddLinkDoorTaken(storage, now, "stranger")).toBe(false);
    expect(consumeAddLinkDoorTaken(storage, now, "@Karan")).toBe(true);
  });

  it("goes stale, so a leftover marker cannot auto-follow tomorrow", () => {
    const storage = memoryStorage();
    markAddLinkDoorTaken(storage, 1_000, "karan");

    expect(consumeAddLinkDoorTaken(storage, 1_000 + ADD_LINK_DOOR_TTL_MS, "karan")).toBe(
      false,
    );
  });
});

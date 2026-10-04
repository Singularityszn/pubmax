import { describe, expect, it } from "vitest";

import {
  LOGIN_FIRST_TIME_LEAD,
  LOGIN_FIRST_TIME_TITLE,
  loginPageGate,
  loginPageHasSessionHint,
  loginPageHeadCopy,
  loginPageShowsSkeleton,
} from "@/lib/loginPageFraming";

const SIGNIN_DOOR = {
  title: "Welcome back",
  lead: "Your prices, plans and nights are on your account. Pick up where you left off.",
};

const SIGNUP_DOOR = {
  title: "Let's get you in",
  lead: "Log a pint price, plan a crawl, keep your nights. Takes a handle and a minute.",
};

describe("login page framing", () => {
  it("stays on the first-time line until the session is known", () => {
    expect(
      loginPageHeadCopy({
        sessionKnown: false,
        adding: false,
        signedIn: false,
        returning: false,
        intent: "signin",
        door: SIGNIN_DOOR,
      }),
    ).toEqual({
      title: LOGIN_FIRST_TIME_TITLE,
      lead: LOGIN_FIRST_TIME_LEAD,
    });
  });

  it("does not greet a known first-timer as if they had been here", () => {
    expect(
      loginPageHeadCopy({
        sessionKnown: true,
        adding: false,
        signedIn: false,
        returning: false,
        intent: "signin",
        door: SIGNIN_DOOR,
      }).title,
    ).toBe(LOGIN_FIRST_TIME_TITLE);
  });

  it("keeps the new-account door once the session is known", () => {
    expect(
      loginPageHeadCopy({
        sessionKnown: true,
        adding: false,
        signedIn: false,
        returning: false,
        intent: "signup",
        door: SIGNUP_DOOR,
      }),
    ).toEqual(SIGNUP_DOOR);
  });

  it("stands the card's shape up only for a hinted reader a card can arrive for", () => {
    expect(
      loginPageShowsSkeleton({
        sessionKnown: false,
        hasAuthSurface: true,
        hasSessionHint: true,
      }),
    ).toBe(true);
    // No hint: the email door is the first paint, not a skeleton.
    expect(
      loginPageShowsSkeleton({
        sessionKnown: false,
        hasAuthSurface: true,
        hasSessionHint: false,
      }),
    ).toBe(false);
    // Keyless build: the notice is the whole answer, so nothing may promise a
    // form that is never coming.
    expect(
      loginPageShowsSkeleton({
        sessionKnown: false,
        hasAuthSurface: false,
        hasSessionHint: true,
      }),
    ).toBe(false);
    expect(
      loginPageShowsSkeleton({
        sessionKnown: true,
        hasAuthSurface: true,
        hasSessionHint: true,
      }),
    ).toBe(false);
  });

  const GATE_BASE = {
    sessionKnown: false,
    signedIn: false,
    addAccount: false,
    sessionHinted: false,
    hasAuthSurface: true,
    returning: false,
  };

  it("paints the email door and its settled head at once for an unhinted reader", () => {
    expect(loginPageGate(GATE_BASE)).toEqual({
      adding: false,
      showSignedIn: false,
      headSessionKnown: true,
      showSkeleton: false,
      showForm: true,
    });
    // A session that then appears swaps the form for the signed-in card.
    expect(
      loginPageGate({ ...GATE_BASE, sessionKnown: true, signedIn: true }),
    ).toMatchObject({ showSignedIn: true, showForm: false, showSkeleton: false });
  });

  it("holds a hinted reader on the skeleton until the session answers", () => {
    expect(loginPageGate({ ...GATE_BASE, sessionHinted: true })).toEqual({
      adding: false,
      showSignedIn: false,
      headSessionKnown: false,
      showSkeleton: true,
      showForm: false,
    });
    // The hint was stale: the session answered signed out, so the form shows.
    expect(
      loginPageGate({ ...GATE_BASE, sessionHinted: true, sessionKnown: true }),
    ).toMatchObject({ showSkeleton: false, showForm: true });
  });

  it("never lets a hint hide the form a reader asked for to add an account", () => {
    expect(
      loginPageGate({ ...GATE_BASE, addAccount: true, sessionHinted: true }),
    ).toEqual({
      adding: true,
      showSignedIn: false,
      headSessionKnown: true,
      showSkeleton: false,
      showForm: true,
    });
    expect(
      loginPageGate({
        ...GATE_BASE,
        addAccount: true,
        sessionKnown: true,
        signedIn: true,
      }),
    ).toMatchObject({ adding: true, showSignedIn: false, showForm: true });
    // Nobody to add beside: a plain sign-in, not the add-account head.
    expect(
      loginPageGate({ ...GATE_BASE, addAccount: true, sessionKnown: true }),
    ).toMatchObject({ adding: false, showForm: true });
  });

  it("keeps the form under a welcome-back card only until the session is known", () => {
    expect(loginPageGate({ ...GATE_BASE, returning: true })).toMatchObject({
      showForm: true,
    });
    expect(
      loginPageGate({ ...GATE_BASE, returning: true, sessionKnown: true }),
    ).toMatchObject({ showForm: false });
  });

  it("paints neither form nor skeleton in a keyless build", () => {
    expect(
      loginPageGate({ ...GATE_BASE, hasAuthSurface: false, sessionHinted: true }),
    ).toMatchObject({ showSkeleton: false, showForm: false });
  });

  it("treats the resume cookie, a callback landing or a stored session as a hint", () => {
    expect(loginPageHasSessionHint({ resumeCookie: "present" })).toBe(true);
    expect(loginPageHasSessionHint({ resumeCookie: "" })).toBe(false);
    // A provider just sent this reader back with the session in the fragment.
    expect(loginPageHasSessionHint({ authCallback: "1" })).toBe(true);
    // A failed callback carries no session: the form is the answer.
    expect(
      loginPageHasSessionHint({ authCallback: "1", authError: "1" }),
    ).toBe(false);
    expect(loginPageHasSessionHint({ authCallback: "0" })).toBe(false);
    expect(
      loginPageHasSessionHint({ storageKeys: ["sb-example-auth-token"] }),
    ).toBe(true);
    // The PKCE verifier is not a session.
    expect(
      loginPageHasSessionHint({
        storageKeys: ["sb-example-auth-token-code-verifier"],
      }),
    ).toBe(false);
    expect(loginPageHasSessionHint()).toBe(false);
  });

  it("keeps Welcome back for a returning resume", () => {
    expect(
      loginPageHeadCopy({
        sessionKnown: true,
        adding: false,
        signedIn: false,
        returning: true,
        intent: "signin",
        door: SIGNIN_DOOR,
      }),
    ).toEqual(SIGNIN_DOOR);
  });
});

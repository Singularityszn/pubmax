/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ current: false }));

vi.mock("@/components/auth/AuthProvider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/auth/AuthProvider")>();
  return {
    ...original,
    useAuth: () => signedIn.current
      ? { ...original.useAuth(), identityResolved: true, user: { id: "account-a" } }
      : original.useAuth(),
  };
});

vi.mock("@/lib/authedFetch", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/authedFetch")>();
  return {
    ...original,
    authedFetch: (...args: Parameters<typeof original.authedFetch>) => signedIn.current
      ? Promise.resolve(new Response(JSON.stringify({
        wanteds: [{ id: "wanted-a", status: "open", venueKind: "curated", venueName: "The Wanted Arms" }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      : original.authedFetch(...args),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({
    prefetch: () => Promise.resolve(),
    push: () => undefined,
    replace: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

import PlanComposer from "@/components/plan/PlanComposer";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";

// PlanComposer paints its form on the server and, when hydration finds a
// draft or an ask to recover, MOUNTS IT AGAIN so the state initialisers read
// them. Whatever the server-painted form held is then thrown away. On a slow
// load the night-mode browser spec typed its query into that form, lost it at
// the remount and tapped Plan it on an empty field (5 Oct 2026). That form now
// takes no input until it is live.

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  signedIn.current = false;
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  return [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  )!;
}

function field(): HTMLInputElement {
  return host!.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
}

async function render(
  ready: boolean | undefined,
  onSubmit: (query: string) => void,
  onGuideMeInstead: () => void = () => undefined,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(PlanDescribeFirst, {
      onSubmit,
      onGuideMeInstead,
      initialQuery: "Quiet in Clapham for 4, not pricey",
      ...(ready === undefined ? {} : { ready }),
    }));
  });
  return { field: field(), sortIt: button("Plan it") };
}

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the describe-first field on the form PlanComposer replaces", () => {
  it("reads only and offers no action until the real form mounts", async () => {
    const onSubmit = vi.fn();
    const onGuideMeInstead = vi.fn();
    signedIn.current = true;
    const { field, sortIt } = await render(false, onSubmit, onGuideMeInstead);
    const wantedChip = button("The Wanted Arms");
    const exampleChip = host!.querySelector<HTMLButtonElement>(".planDescribeFirst__chip:not(.planDescribeFirst__chip--culture)")!;
    const cultureChip = host!.querySelector<HTMLButtonElement>(".planDescribeFirst__chip--culture")!;
    const stopCount = button("2");
    const guideMe = button("Step by step");

    expect(field.readOnly).toBe(true);
    for (const action of [sortIt, exampleChip, cultureChip, wantedChip, stopCount, guideMe]) {
      expect(action.getAttribute("aria-disabled")).toBe("true");
      await act(async () => action.click());
    }
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onGuideMeInstead).not.toHaveBeenCalled();
    expect(button("2").getAttribute("aria-pressed")).toBe("false");
  });

  it("takes input and submits on the mounted form", async () => {
    const onSubmit = vi.fn();
    const { field, sortIt } = await render(undefined, onSubmit);

    expect(field.readOnly).toBe(false);
    expect(sortIt.hasAttribute("aria-disabled")).toBe(false);
    await act(async () => sortIt.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toBe("Quiet in Clapham for 4, not pricey");
  });

  it("is painted read-only by the server and takes a query once PlanComposer hydrates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "offline" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    host.innerHTML = renderToString(createElement(PlanComposer));
    document.body.append(host);

    expect(field().readOnly).toBe(true);
    expect(button("Plan it").getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      root = hydrateRoot(host!, createElement(PlanComposer));
    });

    expect(field().readOnly).toBe(false);
    expect(button("Plan it").hasAttribute("aria-disabled")).toBe(false);
    await act(async () => typeInto(field(), "Quiet in Clapham for 4"));
    await act(async () => button("Plan it").click());

    const generate = fetchMock.mock.calls.find(([url]) => String(url) === "/api/plans/generate");
    expect(generate).toBeDefined();
    expect(String(generate![1]?.body)).toContain("Quiet in Clapham for 4");
  });
});

// A remount rebuilds every node of the composer, which a phone pays for twice:
// a second full render, and a fresh paint the browser scores as the page's
// largest. With nothing to recover the server's form is the form a remount
// would build, so it is kept and goes live where it stands.
describe("PlanComposer's hydration remount", () => {
  async function hydrateAt(search: string) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 })));
    window.history.replaceState(null, "", `/plan${search}`);
    // Drafts an earlier test left behind are exactly what a remount recovers.
    window.localStorage.clear();
    window.sessionStorage.clear();
    host = document.createElement("div");
    host.innerHTML = renderToString(createElement(PlanComposer));
    document.body.append(host);
    const painted = host.querySelector("#plan-composer");
    await act(async () => {
      root = hydrateRoot(host!, createElement(PlanComposer));
    });
    return { painted, live: host.querySelector("#plan-composer") };
  }

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("keeps the server-painted form when there is nothing to recover", async () => {
    const { painted, live } = await hydrateAt("");

    expect(painted).not.toBeNull();
    expect(live).toBe(painted);
    expect(field().readOnly).toBe(false);
  });

  it("still mounts the form again when the address carries an ask", async () => {
    const { painted, live } = await hydrateAt("?query=Quiet%20in%20Clapham%20for%204");

    expect(painted).not.toBeNull();
    expect(live).not.toBe(painted);
  });
});

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

// PlanComposer paints its form on the server and MOUNTS IT AGAIN once
// hydrated, so the state initialisers read the recovered drafts. Whatever the
// server-painted form held is thrown away. On a slow load the night-mode
// browser spec typed its query into that form, lost it at the remount and
// tapped Sort it on an empty field (5 Oct 2026). That form now takes no input.

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
  return { field: field(), sortIt: button("Sort it") };
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
    const guideMe = button("Guide me instead");

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
    expect(button("Sort it").getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      root = hydrateRoot(host!, createElement(PlanComposer));
    });

    expect(field().readOnly).toBe(false);
    expect(button("Sort it").hasAttribute("aria-disabled")).toBe(false);
    await act(async () => typeInto(field(), "Quiet in Clapham for 4"));
    await act(async () => button("Sort it").click());

    const generate = fetchMock.mock.calls.find(([url]) => String(url) === "/api/plans/generate");
    expect(generate).toBeDefined();
    expect(String(generate![1]?.body)).toContain("Quiet in Clapham for 4");
  });
});

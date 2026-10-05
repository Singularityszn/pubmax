/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  vi.unstubAllGlobals();
});

async function render(ready: boolean | undefined, onSubmit: (query: string) => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(PlanDescribeFirst, {
      onSubmit,
      onGuideMeInstead: () => undefined,
      initialQuery: "Quiet in Clapham for 4, not pricey",
      ...(ready === undefined ? {} : { ready }),
    }));
  });
  const field = host.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
  const sortIt = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Sort it",
  )!;
  return { field, sortIt };
}

describe("the describe-first field on the form PlanComposer replaces", () => {
  it("reads only and offers no Sort it until the real form mounts", async () => {
    const onSubmit = vi.fn();
    const { field, sortIt } = await render(false, onSubmit);

    expect(field.readOnly).toBe(true);
    expect(sortIt.getAttribute("aria-disabled")).toBe("true");
    await act(async () => sortIt.click());
    expect(onSubmit).not.toHaveBeenCalled();
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

  it("is ready exactly when the composer can persist, which is after the remount", () => {
    const source = readFileSync(join(process.cwd(), "components/plan/PlanComposer.tsx"), "utf8");
    expect(source).toContain('key={hydrated ? "hydrated" : "server"}');
    expect(source).toContain("canPersist={hydrated}");
    expect(source).toMatch(/<PlanDescribeFirst\s+ready=\{canPersist\}/);
  });
});

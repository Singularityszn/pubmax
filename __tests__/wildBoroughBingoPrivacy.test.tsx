// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ preview: false }));
vi.mock("@/lib/useWildNightPreview", () => ({ useWildNightPreview: () => flags.preview }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: () => Promise.resolve({ ok: false }) }));
vi.mock("@/components/wild/BoroughBingoGate", () => ({ default: () => createElement("div", { "data-preview": "" }, "Preview") }));
import BoroughBingo from "@/components/profile/BoroughBingo";

afterEach(() => { flags.preview = false; });

it("replaces the normal board only for an owner who selects the preview", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (isOwner: boolean, isMutual = false) => act(() => root.render(createElement(BoroughBingo, { handle: "karan", boroughs: ["Camden"], isOwner, isMutual })));
  render(true);
  expect(host.querySelector("#borough-bingo")).not.toBeNull();
  expect(host.querySelector("[data-preview]")).toBeNull();
  flags.preview = true;
  render(true);
  expect(host.querySelector("#borough-bingo")).toBeNull();
  expect(host.querySelector("[data-preview]")).not.toBeNull();
  render(false, true);
  expect(host.querySelector("[data-preview]")).toBeNull();
  expect(host.textContent).toContain("1 of 33 boroughs");
  render(false);
  expect(host.textContent).toBe("");
  flags.preview = false;
  render(true);
  expect(host.querySelector("#borough-bingo")).not.toBeNull();
  expect(host.querySelector("[data-preview]")).toBeNull();
  act(() => root.unmount());
});

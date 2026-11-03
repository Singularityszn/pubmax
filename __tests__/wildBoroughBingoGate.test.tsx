// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({ access: "shared" as "shared" | "full" }));
vi.mock("@/components/profile/PassportData", () => ({ usePassportRead: () => ({ access: read.access, venues: [] }) }));
vi.mock("next/dynamic", () => ({ default: () => () => createElement("div", { "data-card": "" }, "Card") }));
import BoroughBingoGate from "@/components/wild/BoroughBingoGate";

afterEach(() => { read.access = "shared"; });

it("mounts the card only after a full Been read", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(BoroughBingoGate, { handle: "karan" })));
  expect(host.querySelector("[data-card]")).toBeNull();
  read.access = "full";
  act(() => root.render(createElement(BoroughBingoGate, { handle: "karan" })));
  expect(host.querySelector("[data-card]")).not.toBeNull();
  read.access = "shared";
  act(() => root.render(createElement(BoroughBingoGate, { handle: "karan" })));
  expect(host.querySelector("[data-card]")).toBeNull();
  act(() => root.unmount());
});

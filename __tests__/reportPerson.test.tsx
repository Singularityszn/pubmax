// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "Report this person" (launch plan P0 item 6). The control sends one report
// for one person through the Social interactions route, names the person by
// handle, never offers the viewer themselves, and shows nothing signed out.

const auth = vi.hoisted(() => ({ value: { user: { id: "user-a" } as unknown, handle: "alice" as string | null } }));
const authedActionFetch = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch }));

import ReportPerson from "@/components/social/ReportPerson";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function render(handles: string[]): Promise<void> {
  await act(async () => root.render(createElement(ReportPerson, { handles })));
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!found) throw new Error(`No button "${label}" in: ${host.textContent}`);
  return found;
}

async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}

beforeEach(() => {
  auth.value = { user: { id: "user-a" }, handle: "alice" };
  authedActionFetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ report: {} }), { status: 202 }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Report this person", () => {
  it("reports one person by handle with the chosen reason", async () => {
    await render(["bob"]);
    expect(host.querySelector("summary")?.textContent).toBe("Report @bob");
    await click("A threat");

    expect(authedActionFetch).toHaveBeenCalledTimes(1);
    const [url, init] = authedActionFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/social/interactions");
    expect(JSON.parse(String(init.body))).toEqual({
      action: "report",
      kind: "profile",
      targetHandle: "bob",
      reason: "threat",
    });
    expect(host.textContent).toContain("Reported. A moderator reads every report.");
  });

  it("asks who first on a crew, and never offers the viewer", async () => {
    await render(["alice", "bob", "@Carol"]);
    expect(host.querySelector("summary")?.textContent).toBe("Report someone");
    expect(() => button("@alice")).toThrow();
    await click("@carol");
    await click("Spam");
    expect(JSON.parse(String((authedActionFetch.mock.calls[0] as [string, RequestInit])[1].body)).targetHandle).toBe("carol");
  });

  it("says so when the report did not send", async () => {
    authedActionFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Account not found." }), { status: 404 }));
    await render(["bob"]);
    await click("Spam");
    expect(host.querySelector("[role=alert]")?.textContent).toBe("Account not found.");
  });

  it("shows nothing signed out, or when the only person is the viewer", async () => {
    await render(["alice"]);
    expect(host.innerHTML).toBe("");
    auth.value = { user: null, handle: null };
    await render(["bob"]);
    expect(host.innerHTML).toBe("");
  });
});

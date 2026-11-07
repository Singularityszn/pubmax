// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SocialSafetyModeration from "@/app/admin/SocialSafetyModeration";
import type { FlaggedMessageItem, SafetyReportItem } from "@/lib/socialSafetyModeration";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let reports: SafetyReportItem[];
let messages: FlaggedMessageItem[];
let reloadFails: boolean;
let decisionFails: boolean;

function id(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

async function render(): Promise<void> {
  await act(async () => root.render(createElement(SocialSafetyModeration)));
}

async function decide(label: string): Promise<void> {
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!button) throw new Error(`Missing decision: ${label}`);
  await act(async () => button.click());
}

beforeEach(() => {
  reloadFails = false;
  decisionFails = false;
  reports = Array.from({ length: 51 }, (_, index): SafetyReportItem => ({
    reportId: id(index + 1),
    kind: "profile",
    contentId: id(100),
    reason: "harassment",
    createdAt: "2026-11-07T18:00:00.000Z",
    reporterHandle: "reporter",
    targetProfileId: null,
    targetHandle: null,
    targetAccountState: null,
    excerpt: `Incident ${index + 1}`,
  }));
  messages = Array.from({ length: 51 }, (_, index): FlaggedMessageItem => ({
    messageId: id(index + 101),
    conversationId: id(200),
    body: `Message ${index + 1}`,
    senderHandle: "sender",
    senderProfileId: null,
    senderAccountState: null,
    flaggedBy: "reporter",
    flaggedAt: "2026-11-07T18:00:00.000Z",
    sentAt: "2026-11-07T17:00:00.000Z",
  }));
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (decisionFails) return Response.json({ error: "Decision unavailable" }, { status: 503 });
      const action = JSON.parse(String(init.body));
      if (action.action === "resolve_report") reports = reports.filter((row) => row.reportId !== action.reportId);
      if (action.action === "review_message") messages = messages.filter((row) => row.messageId !== action.messageId);
      return Response.json({ ok: true });
    }
    if (reloadFails) return Response.json({ error: "Unavailable" }, { status: 503 });
    return Response.json({ reports: reports.slice(0, 50), flaggedMessages: messages.slice(0, 50) });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("bounded moderation queues", () => {
  it.each([
    ["Close report", "Incident 51"],
    ["Mark reviewed", "Message 51"],
  ])("reveals the next entry after %s succeeds", async (label, next) => {
    await render();
    expect(host.querySelectorAll("article")).toHaveLength(100);
    expect(host.textContent).not.toContain(next);
    await decide(label);
    expect(host.textContent).toContain(next);
    expect(host.querySelectorAll("article")).toHaveLength(100);
  });

  it.each(["Close report", "Mark reviewed"])("shows a reload failure after %s instead of an empty queue", async (label) => {
    await render();
    reloadFails = true;
    await decide(label);
    expect(host.querySelector("[role=alert]")).not.toBeNull();
    expect(host.querySelectorAll("article")).toHaveLength(0);
    expect(host.textContent).not.toContain("No open reports");
    expect(host.textContent).not.toContain("No flagged DMs to review");
    reloadFails = false;
    await decide("Try again");
    expect(host.textContent).toContain(label === "Close report" ? "Incident 51" : "Message 51");
  });

  it.each(["Close report", "Mark reviewed"])("keeps the queue when %s fails", async (label) => {
    await render();
    decisionFails = true;
    await decide(label);
    expect(host.querySelector("[role=alert]")?.textContent).toBe("Decision unavailable");
    expect(host.querySelectorAll("article")).toHaveLength(100);
    expect(reports).toHaveLength(51);
    expect(messages).toHaveLength(51);
    expect(host.textContent).not.toContain("Incident 51");
    expect(host.textContent).not.toContain("Message 51");
  });
});

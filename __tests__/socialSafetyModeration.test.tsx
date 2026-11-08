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
    hasAttachment: false,
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
      if (action.action === "view_message_evidence") return Response.json({ evidence: {
        kind: "poll", question: "Who should we threaten?", options: ["Alice", "Bob"],
      } });
      if (action.action === "view_report_evidence") {
        const report = reports.find((row) => row.reportId === action.reportId);
        if (!report) return Response.json({}, { status: 404 });
        return Response.json({ evidence: {
          reportId: report.reportId, kind: report.kind, contentId: report.contentId,
          body: `Full reported ${report.kind}. `.repeat(30),
          media: report.kind === "post" ? [
            { kind: "photo", url: "https://storage.example/signed-photo" },
            { kind: "photo", url: "https://storage.example/signed-second" },
            { kind: "photo", url: "https://storage.example/signed-third" },
            { kind: "photo", url: "https://storage.example/signed-fourth" },
            { kind: "video", url: "https://storage.example/signed-video" },
          ] : [],
        } });
      }
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

describe("moderation of returning senders and attachments", () => {
  it("loads the reported post's full text, four carousel photos and video only on demand", async () => {
    reports = [{ ...reports[0]!, kind: "post", excerpt: "" }];
    messages = [];
    await render();
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("video")).toBeNull();
    await decide("View reported post");
    expect(host.querySelector('[aria-label="Reported post evidence"] p')?.textContent).toBe("Full reported post. ".repeat(30));
    expect([...host.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([
      "https://storage.example/signed-photo", "https://storage.example/signed-second",
      "https://storage.example/signed-third", "https://storage.example/signed-fourth",
    ]);
    expect(host.querySelector("video")?.getAttribute("src")).toBe("https://storage.example/signed-video");
    await decide("View reported post");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    decisionFails = true;
    await decide("View reported post");
    expect(host.querySelector('[aria-label="Reported post evidence"]')).toBeNull();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
  });

  it.each(["comment", "quote"] as const)("loads the reported %s in full without its parent or siblings", async (kind) => {
    reports = [{ ...reports[0]!, kind, excerpt: "A harmless prefix" }];
    messages = [];
    await render();
    expect(host.textContent).not.toContain(`Full reported ${kind}. `);
    await decide(`View reported ${kind}`);
    expect(host.querySelector(`[aria-label="Reported ${kind} evidence"] p`)?.textContent)
      .toBe(`Full reported ${kind}. `.repeat(30));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("video")).toBeNull();
    await decide(`View reported ${kind}`);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    decisionFails = true;
    await decide(`View reported ${kind}`);
    expect(host.querySelector(`[aria-label="Reported ${kind} evidence"]`)).toBeNull();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
  });

  it.each(["report", "message"])("suspends a linked person without a Social account from a %s", async (kind) => {
    reports = [{ ...reports[0]!, targetProfileId: id(100), targetHandle: "returning", targetAccountState: null }];
    messages = [{ ...messages[0]!, senderProfileId: id(100), senderHandle: "returning", senderAccountState: null }];
    await render();
    const suspendButtons = [...host.querySelectorAll("button")].filter((node) => node.textContent === "Suspend @returning");
    expect(suspendButtons).toHaveLength(2);
    await act(async () => suspendButtons[kind === "report" ? 0 : 1]!.click());
    const form = host.querySelector("form");
    if (!form) throw new Error("Suspension form missing");
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({ action: "suspend", profileId: id(100), reportId: kind === "report" ? reports[0]!.reportId : null });
  });

  it("loads a reported poll on demand without exposing evidence in the queue", async () => {
    reports = [];
    messages = [{ ...messages[0]!, hasAttachment: true }];
    await render();
    expect(host.textContent).not.toContain("Who should we threaten?");
    await decide("View reported attachment");
    expect(host.textContent).toContain("Who should we threaten?");
    expect([...host.querySelectorAll("li")].map((row) => row.textContent)).toEqual(["Alice", "Bob"]);
    await decide("View reported attachment");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
});

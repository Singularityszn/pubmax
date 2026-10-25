// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import FeedbackPage from "@/app/feedback/page";
import AccountLegalRow from "@/components/profile/AccountLegalRow";
import { CONTACT_EMAIL } from "@/lib/siteContact";

describe("feedback inside the app", () => {
  it("offers a named feedback link without requiring an account", () => {
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(createElement(AccountLegalRow));

    const feedback = [...page.querySelectorAll("a")].find(
      (link) => link.textContent === "Send feedback",
    );
    expect(feedback?.getAttribute("href")).toBe("/feedback");
  });

  it("prepares only the monitored recipient and a feedback subject", () => {
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(createElement(FeedbackPage));

    const email = [...page.querySelectorAll("a")].find(
      (link) => link.textContent === "Open email draft",
    );
    const target = new URL(email!.getAttribute("href")!);
    expect(target.protocol).toBe("mailto:");
    expect(target.pathname).toBe(CONTACT_EMAIL);
    expect([...target.searchParams]).toEqual([["subject", "PUBMAXX feedback"]]);
    expect(target.hash).toBe("");
    expect(page.querySelector("form")).toBeNull();
  });
});

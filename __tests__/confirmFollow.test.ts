import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, ...rest }, children),
}));

vi.mock("@/components/profile/HandleAvatar", () => ({
  default: () => createElement("span", null, "avatar"),
}));

import ConfirmFollow from "@/components/social/ConfirmFollow";

describe("ConfirmFollow", () => {
  it("offers the existing claim flow when viewer has no handle", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmFollow, { targetHandle: "karan" }),
    );

    expect(html).toContain("Claim a handle to add them");
    expect(html).toContain('href="/u/you?returnTo=%2Fadd%2Fkaran"');
    expect(html).toContain("You need a handle first");
    expect(html).not.toContain("Choose a handle in your account first.");
  });
});

// @vitest-environment jsdom
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import FirstActionsRow from "@/components/profile/FirstActionsRow";
import { SocialFriendsLaunchProvider } from "@/lib/useSocialFriendsLaunch";
import { defined } from "@/__tests__/helpers/defined";

// Social is not a dock tab, so the signed-in You hub's first actions are its
// door on a phone. The link is named for the launch state, the same name the
// desktop More menu uses.
function render(friendsLaunchEnabled: boolean): HTMLElement {
  const LaunchProvider = SocialFriendsLaunchProvider as ComponentType<{
    value: boolean;
  }>;
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(
      LaunchProvider,
      { value: friendsLaunchEnabled },
      createElement(FirstActionsRow),
    ),
  );
  return host;
}

describe("the You hub's first actions", () => {
  it.each([
    [true, "Social"],
    [false, "Social preview"],
  ])("link to /social when the friends launch is %s, named %s", (enabled, label) => {
    const links = Array.from(render(enabled).querySelectorAll<HTMLAnchorElement>("a"));
    const social = links.filter((link) => link.getAttribute("href") === "/social");
    expect(social).toHaveLength(1);
    expect(defined(social[0]).textContent).toBe(label);
  });

  it("keeps the loop's actions ahead of Social", () => {
    const hrefs = Array.from(render(true).querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/map", "/map?log=1", "/plan", "/social"]);
  });
});

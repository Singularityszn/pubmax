// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import ProfileSectionNav from "@/components/profile/ProfileSectionNav";

it("marks the section opened by a link and follows browser history", async () => {
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/u/karan");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(ProfileSectionNav)));
    expect(host.querySelector('[aria-current="location"]')?.textContent).toBe("Moments");
    await act(async () => {
      window.location.hash = "#saved-pubs";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(host.querySelector('[aria-current="location"]')?.textContent).toBe("Saved");
    expect(host.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
    await act(async () => {
      window.history.replaceState(null, "", "#passport");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(host.querySelector('[aria-current="location"]')?.textContent).toBe("Passport");
    expect(host.querySelector('a[href="#posts"]')).toBeNull();
    await act(async () => root.render(createElement(ProfileSectionNav, { showPosts: true })));
    expect(host.querySelector('a[href="#posts"]')?.textContent).toBe("Posts");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    window.history.replaceState(null, "", "/");
    environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

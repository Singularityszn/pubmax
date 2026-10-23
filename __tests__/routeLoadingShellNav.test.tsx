// The held frame a primary tab paints while its route arrives.
//
// It is the SAME frame the route itself paints, so the top bar is part of it.
// Without the bar the shell was a page with no chrome, and the moment it stood
// in for a route the site nav left the screen: /out, /social and /feed own a
// `loading.tsx`, so their whole page - the nav and the PUBMAXX wordmark inside
// it - sits in a Suspense boundary. React hands a boundary back to its fallback
// whenever a sync update lands before that boundary has hydrated, and the root
// of this app settles several on every load, so a route that had already
// painted could drop back to a bar-less skeleton and take the wordmark with it.
// Measured on /today at 390px on the evening clock: one load in four. With the
// bar in the shell, none.
//
// The bar therefore stays put whichever half is on screen, and a cold tab tap
// paints chrome straight away instead of a page that grows a header.
//
// A PRERENDERED ROUTE OWNS NO SHELL. /today and /tonight are force-static, so
// their whole page is already in the document, but it runs past React's
// 12,800-byte limit for an inline boundary. React therefore streamed it into a
// hidden div behind the shell and revealed it up to 300ms after the first
// paint. A root update in that window made hydration render the route again
// on the client: the shell came back, the page remounted, and for a moment
// the document held two Today screens. The browser suite failed on both
// (5 Oct 2026). Without the shell the page is in the first paint. On a cold
// tab tap over slow 4G the shell had painted at about 850ms and the page at
// about 1250ms, the same moment the page now paints without it.
//
// The tree is read rather than rendered: SiteNav is a client component that
// asks the app's auth and command-palette contexts for its own children, and a
// stub of those would only prove the stub.

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import RouteLoadingShell from "@/components/nav/RouteLoadingShell";
import SiteNav from "@/components/nav/SiteNav";

function flatten(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element, ...flatten(element.props.children)];
}

function shellTree(label = "Today"): ReactElement[] {
  return flatten(RouteLoadingShell({ label }));
}

describe("RouteLoadingShell", () => {
  it("carries the site nav, so a loading route never loses its top bar", () => {
    expect(shellTree().some((element) => element.type === SiteNav)).toBe(true);
  });

  it("still says which route is loading, and says it politely", () => {
    const shell = shellTree("Tonight")[0] as ReactElement<Record<string, unknown>>;
    expect(shell.props["aria-busy"]).toBe("true");
    expect(shell.props["aria-live"]).toBe("polite");
    expect(shell.props["aria-label"]).toBe("Loading Tonight");
    expect(shell.props.className).toBe("routeLoadingShell");
  });

  // On a document load React streams the page's own <main> into a hidden
  // segment while this frame is on screen, so a <main> here made two in one
  // document until the swap (e2e/social-loop.spec.ts, /discover).
  it("is a named region, so the page it stands in for owns the one <main>", () => {
    const tree = shellTree();
    expect(tree[0]?.type).toBe("section");
    expect(tree.some((element) => element.type === "main")).toBe(false);
  });
});

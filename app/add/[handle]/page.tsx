// Share-link confirm-follow surface (Social Loop v1). A friend shares their link
// — /add/<handle> — at the table; opening it lands here and confirms adding them
// to your lot. Server component: resolve the handle from the route param, then
// hand off to the client confirm sheet. No forced login — the client reads the
// viewer's handle from localStorage.
//
// D1.5: AddPageShell centres the confirm card on wide viewports and maps Escape
// to dismiss (back to feed), matching the "Not now" ghost link.

import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";
import ConfirmFollow from "@/components/social/ConfirmFollow";
import { normalizeHandle } from "@/lib/profiles";

import AddPageShell from "./AddPageShell";
import "./add.css";

export const metadata: Metadata = {
  title: "Add to your lot · PUBMAXX",
  description: "Add a friend to your lot on PUBMAXX.",
  robots: { index: false, follow: false },
};

export default async function AddHandlePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const handle = normalizeHandle((await params).handle);
  return (
    <main className="addShell">
      <SiteNav active="feed" />
      <AddPageShell>
        <ConfirmFollow targetHandle={handle} />
      </AddPageShell>
    </main>
  );
}

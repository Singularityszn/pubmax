import type { Metadata } from "next";

import AdminClient from "./AdminClient";

// Server shell for /admin so the route carries real metadata (the client
// component can't export it). This is the token-gated moderator console, so it
// is noindex, follow:false — it must never surface in search.
export const metadata: Metadata = {
  title: "Admin",
  description: "Moderator console for PUBMAXX.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminClient />;
}

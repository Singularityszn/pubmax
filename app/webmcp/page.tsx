import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";
import WebMcpNightBoard from "@/components/webmcp/WebMcpNightBoard";

import "./webmcp.css";

// A challenge demo surface, not a crawlable family: nothing in the app links
// here and it is absent from the sitemap, so leaving it indexable would put a
// demo page in front of a brand query. Same shape as /out, which is noindex and
// follow for its own reason (captain decision 2026-08-15).
export const metadata: Metadata = {
  title: "Agent Night Board · PUBMAXX",
  description: "Plan one London pub crawl from checked prices, with a person and a browser agent.",
  alternates: { canonical: "/webmcp" },
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
};

export default function WebMcpPage() {
  return (
    <main id="main" className="webmcpPage">
      <SiteNav />
      <WebMcpNightBoard />
    </main>
  );
}

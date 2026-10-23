import type { Metadata } from "next";
import SiteNav from "@/components/nav/SiteNav";
import PalExperience from "@/components/pal/PalExperience";
import "./pal.css";

// THIS DOCUMENT IS PRERENDERED (product decision 17 Oct 2026, recorded in
// proxy.ts beside the other CDN-cached documents): it drops the per-request
// CSP nonce so the Vercel CDN can hold it. Nothing per-request may be read
// here and nothing personal may reach it, because one copy is handed to every
// stranger; the Pal, its memories and the session are
// read in the browser, after load.
export const dynamic = "force-static";
// Every input is bundled and changes only on deploy, so an hour is a quiet
// ceiling rather than a refresh the page needs.
export const revalidate = 3600;

const title = "Plan your night with Pub Pal";
const description = "Find a pub or plan a route with Pub Pal. Choose its look, voice and what it can remember.";
const image = "/pal/circuit-robin-512.png";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/pal" },
  openGraph: {
    title,
    description,
    type: "website",
    url: "/pal",
    images: [{ url: image, width: 512, height: 512, alt: "Your Pub Pal, the Circuit Robin" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
  },
};

export default function PalPage() {
  // The shared top nav, like every other route: /pal at 1440 had none, so the
  // Pal read as a microsite outside the app. The nav reads the session in the
  // browser, so this document stays the same for every stranger.
  return (
    <>
      <SiteNav />
      <PalExperience />
    </>
  );
}

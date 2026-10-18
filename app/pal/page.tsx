import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Meet your Pub Pal",
  description: "Meet, shape and control your private companion for a night out.",
};

export default function PalPage() {
  return <PalExperience />;
}

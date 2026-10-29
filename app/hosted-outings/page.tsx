import type { Metadata } from "next";
import SiteNav from "@/components/nav/SiteNav";
import HostedOutingsClient from "./HostedOutingsClient";

export const metadata: Metadata = {
  title: "Hosted outings | PUBMAXX",
  description: "Find hosted adult outings. Enrollment opens after the venue and host are confirmed.",
  robots: { index: false, follow: false },
};
export default function HostedOutingsPage() {
  return <><SiteNav active="social" /><HostedOutingsClient /></>;
}

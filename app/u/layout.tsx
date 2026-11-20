import type { Metadata } from "next";

export const metadata: Metadata = { robots: null };

export default function ProfilesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
